import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import {
  guardWrite,
  listingActor,
  loadOwnListing,
  requireVerifiedBroker,
} from "@/lib/broker-listing-access";
import {
  type BrokerListingDoc,
  brokerListingInput,
  toPrivateBrokerListing,
} from "@/lib/broker-listings";
import { BrokerListing } from "@/models/BrokerListing";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await listingActor(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const doc = await loadOwnListing(actor, id);
  if (doc instanceof NextResponse) return doc;
  return NextResponse.json({ data: toPrivateBrokerListing(doc) });
}

/**
 * Edits a listing. Changing an approved (or submitted) listing sends it back
 * for review and takes it off the marketplace until approved again — details
 * changed, so the system-admin must check them (client decision).
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardWrite(request);
  if (guard) return guard;
  const actor = await listingActor(request);
  if (actor instanceof NextResponse) return actor;
  const denied = await requireVerifiedBroker(actor);
  if (denied) return denied;
  const { id } = await context.params;
  const doc = await loadOwnListing(actor, id);
  if (doc instanceof NextResponse) return doc;
  if (doc.status === "withdrawn") {
    return NextResponse.json(
      { error: "This listing was withdrawn; create a new one" },
      { status: 409 },
    );
  }

  const parsed = brokerListingInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the listing details", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const needsReview =
    doc.status === "approved" || doc.status === "submitted" || doc.status === "expired";
  const set: Record<string, unknown> = { ...parsed.data };
  if (needsReview) {
    Object.assign(set, { status: "draft", approvedAt: null, expiresAt: null, submittedAt: null });
  }
  await BrokerListing.updateOne({ _id: id, brokerUserId: doc.brokerUserId }, { $set: set });
  const fresh = (await BrokerListing.findById(id).lean()) as BrokerListingDoc;
  return NextResponse.json({
    data: toPrivateBrokerListing(fresh),
    ...(needsReview ? { notice: "Changes saved. Submit the listing again for approval." } : {}),
  });
}

/** Withdraws the listing from the marketplace (kept for history). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardWrite(request);
  if (guard) return guard;
  const actor = await listingActor(request);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "broker") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const doc = await loadOwnListing(actor, id);
  if (doc instanceof NextResponse) return doc;
  await BrokerListing.updateOne({ _id: id }, { $set: { status: "withdrawn", expiresAt: null } });
  return NextResponse.json({ data: { id } });
}
