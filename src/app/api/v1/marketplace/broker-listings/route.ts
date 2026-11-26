import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { type BrokerListingDoc, toPublicBrokerListing } from "@/lib/broker-listings";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { rateLimit } from "@/lib/rate-limit";
import { BrokerListing } from "@/models/BrokerListing";
import { BrokerProfile } from "@/models/BrokerProfile";

/**
 * Public, approved and unexpired broker listings for the marketplace.
 * Filters: `purpose` (rent|sale), `county`, `maxPrice`. Never exposes owner
 * contact, exact address or the mandate.
 */
export async function GET(request: NextRequest) {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ data: [] });
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 60 });
  if (limit instanceof NextResponse) return limit;
  await connectToDatabase();

  const params = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { status: "approved", expiresAt: { $gt: new Date() } };
  const purpose = params.get("purpose");
  if (purpose === "rent" || purpose === "sale") filter.purpose = purpose;
  const county = params.get("county")?.trim();
  if (county) filter.county = new RegExp(`^${county.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const maxPrice = Number(params.get("maxPrice"));
  if (Number.isFinite(maxPrice) && maxPrice > 0) filter.price = { $lte: maxPrice };

  const rows = (await BrokerListing.find(filter)
    .sort({ approvedAt: -1 })
    .limit(100)
    .lean()) as BrokerListingDoc[];
  const profiles = (await BrokerProfile.find({ userId: { $in: rows.map((r) => r.brokerUserId) } })
    .select("userId agencyName")
    .lean()) as { userId: string; agencyName?: string }[];
  const agency = new Map(profiles.map((p) => [p.userId, p.agencyName ?? ""]));
  return NextResponse.json(
    { data: rows.map((r) => toPublicBrokerListing(r, { agency: agency.get(r.brokerUserId) })) },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
