import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateSession } from "@/lib/auth-scope";
import type { BrokerListingDoc } from "@/lib/broker-listings";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { BrokerListing } from "@/models/BrokerListing";
import { BrokerProfile } from "@/models/BrokerProfile";
import { User } from "@/models/User";

export interface ListingActor {
  userId: string;
  role: string;
}

/** Flag + auth + DB-checked active account. */
export async function listingActor(request: NextRequest): Promise<ListingActor | NextResponse> {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await connectToDatabase();
  const auth = await authenticateSession(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = (await User.findById(auth.userId).select("role isActive").lean()) as {
    role?: string;
    isActive?: boolean;
  } | null;
  if (!user?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return { userId: auth.userId, role: String(user.role) };
}

export async function guardWrite(request: NextRequest, limit = 20): Promise<NextResponse | null> {
  const limited = await rateLimit(request, { windowMs: 60_000, limit });
  if (limited instanceof NextResponse) return limited;
  return checkSameOrigin(request);
}

/** Brokers must be verified to list; suspended brokers cannot add or change listings. */
export async function requireVerifiedBroker(actor: ListingActor): Promise<NextResponse | null> {
  if (actor.role !== "broker") {
    return NextResponse.json(
      { error: "Only brokers can manage their own listings" },
      { status: 403 },
    );
  }
  const profile = (await BrokerProfile.findOne({ userId: actor.userId })
    .select("status")
    .lean()) as {
    status?: string;
  } | null;
  if (profile?.status !== "verified") {
    return NextResponse.json({ error: "Your broker profile is not verified" }, { status: 403 });
  }
  return null;
}

/** Loads a listing the caller owns (broker) or reviews (system-admin). */
export async function loadOwnListing(
  actor: ListingActor,
  id: string,
): Promise<BrokerListingDoc | NextResponse> {
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid listing id" }, { status: 400 });
  const doc = (await BrokerListing.findById(id).lean()) as BrokerListingDoc | null;
  if (!doc || (actor.role !== "system-admin" && doc.brokerUserId !== actor.userId)) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  return doc;
}
