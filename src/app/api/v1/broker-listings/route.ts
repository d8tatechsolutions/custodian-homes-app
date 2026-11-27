import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { guardWrite, listingActor, requireVerifiedBroker } from "@/lib/broker-listing-access";
import {
  type BrokerListingDoc,
  brokerListingInput,
  toPrivateBrokerListing,
} from "@/lib/broker-listings";
import { BrokerListing } from "@/models/BrokerListing";

/** The broker's own listings, newest first. */
export async function GET(request: NextRequest) {
  const actor = await listingActor(request);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "broker") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = (await BrokerListing.find({ brokerUserId: actor.userId })
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean()) as BrokerListingDoc[];
  return NextResponse.json({ data: rows.map((r) => toPrivateBrokerListing(r)) });
}

/** Creates a draft. Submission for review is a separate step. */
export async function POST(request: NextRequest) {
  const guard = await guardWrite(request, 10);
  if (guard) return guard;
  const actor = await listingActor(request);
  if (actor instanceof NextResponse) return actor;
  const denied = await requireVerifiedBroker(actor);
  if (denied) return denied;

  const parsed = brokerListingInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the listing details", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const doc = await BrokerListing.create({
    ...parsed.data,
    brokerUserId: actor.userId,
    status: "draft",
  });
  return NextResponse.json(
    { data: toPrivateBrokerListing(doc.toObject() as BrokerListingDoc) },
    { status: 201 },
  );
}
