import { propertyTitleMap } from "@/app/api/v1/_helpers";
import { awaiting, type BidDoc, isOpen, latestOffer } from "@/lib/broker-bids";
import { Attribution } from "@/models/Attribution";
import { BrokerProfile } from "@/models/BrokerProfile";
import { Listing } from "@/models/Listing";
import { User } from "@/models/User";

export interface BidView {
  _id: string;
  listingId: string;
  listingHeadline: string;
  askingRent: number;
  propertyId: string;
  property: string;
  unitId: string;
  status: string;
  awaiting: "owner" | "broker" | null;
  expiresAt: string;
  createdAt: string;
  offers: BidDoc["offers"];
  decisionNote: string;
  shareCode: string;
  broker: { id: string; name: string; agency: string; tenantsBrought: number };
}

/**
 * Bids enriched for the UI. Brokers see their own bids; owners see the
 * broker's name, agency and how many tenants they have brought before (to
 * compare competing bids). No contact details or payout data are exposed.
 */
export async function viewBids(bids: BidDoc[], now = new Date()): Promise<BidView[]> {
  if (bids.length === 0) return [];
  const listingIds = [...new Set(bids.map((b) => b.listingId))];
  const brokerIds = [...new Set(bids.map((b) => b.brokerUserId))];

  const [listings, titles, users, profiles, brought] = await Promise.all([
    Listing.find({ _id: { $in: listingIds } })
      .select("headline askingRent")
      .lean() as Promise<{ _id: unknown; headline: string; askingRent: number }[]>,
    propertyTitleMap([...new Set(bids.map((b) => b.propertyId))]),
    User.find({ _id: { $in: brokerIds } })
      .select("name")
      .lean() as Promise<{ _id: unknown; name?: string }[]>,
    BrokerProfile.find({ userId: { $in: brokerIds } })
      .select("userId agencyName")
      .lean() as Promise<{ userId: string; agencyName?: string }[]>,
    Attribution.aggregate([
      { $match: { brokerUserId: { $in: brokerIds }, status: "confirmed" } },
      { $group: { _id: "$brokerUserId", n: { $sum: 1 } } },
    ]) as Promise<{ _id: string; n: number }[]>,
  ]);
  const listingById = new Map(listings.map((l) => [String(l._id), l]));
  const nameById = new Map(users.map((u) => [String(u._id), u.name ?? ""]));
  const agencyById = new Map(profiles.map((p) => [p.userId, p.agencyName ?? ""]));
  const broughtById = new Map(brought.map((b) => [String(b._id), b.n]));

  return bids.map((b) => {
    const listing = listingById.get(b.listingId);
    const lapsed = (b.status === "pending" || b.status === "countered") && !isOpen(b, now);
    return {
      _id: String(b._id),
      listingId: b.listingId,
      listingHeadline: listing?.headline ?? "Listing",
      askingRent: listing?.askingRent ?? 0,
      propertyId: b.propertyId,
      property: titles.get(b.propertyId) ?? "",
      unitId: b.unitId,
      status: lapsed ? "expired" : b.status,
      awaiting: lapsed ? null : awaiting(b),
      expiresAt: new Date(b.expiresAt).toISOString(),
      createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : "",
      offers: b.offers,
      decisionNote: b.decisionNote ?? "",
      shareCode: b.result?.shareCode ?? "",
      broker: {
        id: b.brokerUserId,
        name: nameById.get(b.brokerUserId) ?? "",
        agency: agencyById.get(b.brokerUserId) ?? "",
        tenantsBrought: broughtById.get(b.brokerUserId) ?? 0,
      },
    };
  });
}

export function latestTerms(view: Pick<BidView, "offers">) {
  return latestOffer(view);
}
