import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { type BrokerListingDoc, isLive } from "@/lib/broker-listings";
import { durableRateLimit } from "@/lib/durable-rate-limit";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { isValidE164 } from "@/lib/phone";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { BrokerEnquiry } from "@/models/BrokerEnquiry";
import { BrokerListing } from "@/models/BrokerListing";

const input = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  phone: z.string().trim().max(32).refine(isValidE164, "Enter your phone with its country code"),
  email: z
    .union([z.string().trim().email().max(200), z.literal("")])
    .optional()
    .default(""),
  message: z.string().trim().max(2000).optional().default(""),
  /** Honeypot: hidden in the form; bots fill it, people don't. */
  website: z.string().max(200).optional().default(""),
});

/**
 * A visitor's enquiry on a broker's own listing; it lands in the broker's
 * Enquiries. Tightly rate-limited and bot-filtered because it is public.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limit = await rateLimit(request, { windowMs: 10 * 60_000, limit: 5 });
  if (limit instanceof NextResponse) return limit;
  const originError = checkSameOrigin(request);
  if (originError) return originError;
  const durable = await durableRateLimit(request, {
    key: "broker-enquiry",
    windowMs: 60 * 60_000,
    limit: 10,
  });
  if (durable) return durable;

  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check your details" },
      { status: 400 },
    );
  }
  // Pretend success to bots so they don't retry with a different payload.
  if (parsed.data.website) return NextResponse.json({ data: { ok: true } }, { status: 201 });

  await connectToDatabase();
  const listing = (await BrokerListing.findById(id)
    .select("status expiresAt brokerUserId")
    .lean()) as Pick<BrokerListingDoc, "status" | "expiresAt" | "brokerUserId"> | null;
  if (!listing || !isLive(listing))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await BrokerEnquiry.create({
    brokerListingId: id,
    brokerUserId: listing.brokerUserId,
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email,
    message: parsed.data.message,
  });
  return NextResponse.json({ data: { ok: true } }, { status: 201 });
}
