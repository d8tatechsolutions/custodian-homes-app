import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  guardWrite,
  listingActor,
  loadOwnListing,
  requireVerifiedBroker,
} from "@/lib/broker-listing-access";
import {
  type BrokerListingDoc,
  expiryFromNow,
  toPrivateBrokerListing,
} from "@/lib/broker-listings";
import { BrokerListing } from "@/models/BrokerListing";

/**
 * Renews an approved (or lapsed) listing for another 60 days. No re-approval
 * is needed because nothing changed — edits always send it back for review.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardWrite(request, 10);
  if (guard) return guard;
  const actor = await listingActor(request);
  if (actor instanceof NextResponse) return actor;
  const denied = await requireVerifiedBroker(actor);
  if (denied) return denied;
  const { id } = await context.params;
  const doc = await loadOwnListing(actor, id);
  if (doc instanceof NextResponse) return doc;
  if (doc.status !== "approved" && doc.status !== "expired") {
    return NextResponse.json({ error: "Only an approved listing can be renewed" }, { status: 409 });
  }
  await BrokerListing.updateOne(
    { _id: id },
    { $set: { status: "approved", expiresAt: expiryFromNow() }, $inc: { renewals: 1 } },
  );
  const fresh = (await BrokerListing.findById(id).lean()) as BrokerListingDoc;
  return NextResponse.json({ data: toPrivateBrokerListing(fresh) });
}
