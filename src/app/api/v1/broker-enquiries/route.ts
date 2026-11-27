import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { guardWrite, listingActor } from "@/lib/broker-listing-access";
import { BrokerEnquiry } from "@/models/BrokerEnquiry";
import { BrokerListing } from "@/models/BrokerListing";

/** Enquiries on the broker's own listings, newest first. */
export async function GET(request: NextRequest) {
  const actor = await listingActor(request);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "broker") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = (await BrokerEnquiry.find({ brokerUserId: actor.userId })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean()) as { _id: unknown; brokerListingId: string }[];
  const listings = (await BrokerListing.find({
    _id: { $in: [...new Set(rows.map((r) => r.brokerListingId))] },
  })
    .select("title")
    .lean()) as { _id: unknown; title: string }[];
  const titles = new Map(listings.map((l) => [String(l._id), l.title]));
  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      _id: String(r._id),
      listingTitle: titles.get(r.brokerListingId) ?? "",
    })),
  });
}

const update = z.object({
  id: z.string().trim().min(1),
  status: z.enum(["new", "contacted", "closed"]),
});

/** Marks an enquiry contacted / closed. */
export async function PATCH(request: NextRequest) {
  const guard = await guardWrite(request);
  if (guard) return guard;
  const actor = await listingActor(request);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "broker") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = update.safeParse(await readJsonBody(request));
  if (!parsed.success || !isValidObjectId(parsed.data.id)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const res = await BrokerEnquiry.updateOne(
    { _id: parsed.data.id, brokerUserId: actor.userId },
    { $set: { status: parsed.data.status } },
  );
  if (res.matchedCount === 0)
    return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
  return NextResponse.json({ data: { id: parsed.data.id, status: parsed.data.status } });
}
