import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { type BrokerListingDoc, isLive, toPublicBrokerListing } from "@/lib/broker-listings";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { rateLimit } from "@/lib/rate-limit";
import { BrokerListing } from "@/models/BrokerListing";
import { BrokerProfile } from "@/models/BrokerProfile";

/** One public broker listing (404 unless approved and unexpired). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 60 });
  if (limit instanceof NextResponse) return limit;
  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await connectToDatabase();
  const doc = (await BrokerListing.findById(id).lean()) as BrokerListingDoc | null;
  if (!doc || !isLive(doc)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const profile = (await BrokerProfile.findOne({ userId: doc.brokerUserId })
    .select("agencyName")
    .lean()) as {
    agencyName?: string;
  } | null;
  return NextResponse.json({ data: toPublicBrokerListing(doc, { agency: profile?.agencyName }) });
}
