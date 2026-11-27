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
  submissionProblems,
  toPrivateBrokerListing,
} from "@/lib/broker-listings";
import { notifyBrokerListingSubmitted } from "@/lib/broker-notify";
import { checkListingPhotos } from "@/lib/listing-fingerprint";
import { BrokerListing } from "@/models/BrokerListing";
import { ListingFlag } from "@/models/ListingFlag";

/**
 * Sends a draft (or a rejected listing after fixes) for system-admin review.
 * Required evidence is checked first, then the automatic duplicate-photo
 * check runs and its result is attached for the reviewer.
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
  if (doc.status !== "draft" && doc.status !== "rejected") {
    return NextResponse.json({ error: "Only a draft can be submitted" }, { status: 409 });
  }
  const problems = submissionProblems(doc);
  if (problems.length > 0) {
    return NextResponse.json({ error: problems[0], problems }, { status: 400 });
  }

  // Broker listings use a namespaced id so they never collide with platform listings.
  const key = `bl:${id}`;
  await checkListingPhotos({ listingId: key, propertyId: key, urls: doc.photos.map((p) => p.url) });
  const duplicateFlags = await ListingFlag.countDocuments({ listingId: key, status: "open" });

  await BrokerListing.updateOne(
    { _id: id, status: { $in: ["draft", "rejected"] } },
    { $set: { status: "submitted", submittedAt: new Date(), duplicateFlags, reviewNote: "" } },
  );
  const fresh = (await BrokerListing.findById(id).lean()) as BrokerListingDoc;
  await notifyBrokerListingSubmitted(fresh);
  return NextResponse.json({ data: toPrivateBrokerListing(fresh) });
}
