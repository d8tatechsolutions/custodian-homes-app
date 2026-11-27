import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { authenticateSession } from "@/lib/auth-scope";
import { type BidDoc, BidError, placeBid } from "@/lib/broker-bids";
import { viewBids } from "@/lib/broker-bids-view";
import { notifyBidEvent } from "@/lib/broker-notify";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { bidCreateInput, toBidTerms } from "@/lib/schemas/broker-bids";
import { BrokerBid } from "@/models/BrokerBid";
import { User } from "@/models/User";

async function currentUser(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth) return null;
  const user = (await User.findById(auth.userId).select("role isActive").lean()) as {
    role?: string;
    isActive?: boolean;
  } | null;
  if (!user?.isActive) return null;
  return { userId: auth.userId, role: String(user.role) };
}

/**
 * Brokers: their own requests. Owners, custodians and admins: requests they
 * decide on (`approverUserId`). System-admin: all. `?listingId=` narrows.
 */
export async function GET(request: NextRequest) {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await connectToDatabase();
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filter: Record<string, unknown> = {};
  if (user.role === "broker") filter.brokerUserId = user.userId;
  else if (user.role !== "system-admin") filter.approverUserId = user.userId;
  const listingId = request.nextUrl.searchParams.get("listingId");
  if (listingId) filter.listingId = listingId;

  const bids = (await BrokerBid.find(filter).sort({ updatedAt: -1 }).limit(300).lean()) as BidDoc[];
  return NextResponse.json({ data: await viewBids(bids) });
}

/** A verified broker requests to list a live listing with their proposed commission. */
export async function POST(request: NextRequest) {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 10 });
  if (limit instanceof NextResponse) return limit;
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  await connectToDatabase();
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "broker") {
    return NextResponse.json({ error: "Only brokers can request to list" }, { status: 403 });
  }

  const parsed = bidCreateInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const bid = await placeBid(user.userId, parsed.data.listingId, toBidTerms(parsed.data.terms));
    const doc = bid.toObject() as BidDoc;
    const [view] = await viewBids([doc]);
    await notifyBidEvent(view, doc.approverUserId, "placed");
    return NextResponse.json({ data: view }, { status: 201 });
  } catch (error) {
    if (error instanceof BidError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
