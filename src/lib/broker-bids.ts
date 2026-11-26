import {
  authorizeBroker,
  createBrokerListingPublisher,
  createCommissionAgreement,
} from "@/lib/brokers";
import { resolveCostApprover } from "@/lib/maintenance/approver";
import type { Role } from "@/lib/permissions";
import { BrokerAuthorization } from "@/models/BrokerAuthorization";
import { BrokerBid, type BrokerBidStatus, OPEN_BID_STATUSES } from "@/models/BrokerBid";
import { BrokerProfile } from "@/models/BrokerProfile";
import { CommissionAgreement } from "@/models/CommissionAgreement";
import { Listing } from "@/models/Listing";
import { ListingPublisher } from "@/models/ListingPublisher";
import { Property } from "@/models/Property";
import { User } from "@/models/User";

export const BID_EXPIRY_DAYS = 14;

export class BidError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type CommissionBasis = "first_month_rent" | "percentage_of_rent" | "fixed";

export interface BidTerms {
  basis: CommissionBasis;
  /** Basis points for percentage bases (1000 = 10%). */
  rateBps: number;
  /** Minor units for the fixed basis. */
  fixedAmountMinor: number;
  currency: "KES" | "USD";
  message?: string;
}

export interface BidOffer extends BidTerms {
  by: "broker" | "owner";
  byUserId: string;
  at: Date;
}

export interface BidDoc {
  _id: unknown;
  listingId: string;
  unitId: string;
  propertyId: string;
  ownerId: string;
  brokerUserId: string;
  offers: BidOffer[];
  status: BrokerBidStatus;
  approverUserId: string;
  decidedByUserId?: string;
  decidedAt?: Date | null;
  decisionNote?: string;
  result?: {
    authorizationId?: string;
    agreementId?: string;
    publisherId?: string;
    shareCode?: string;
  };
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + BID_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Percentage bases are on KES rent, so only fixed amounts carry a currency. */
export function normaliseTerms(terms: BidTerms): BidTerms {
  if (terms.basis === "fixed") return { ...terms, rateBps: 0 };
  return { ...terms, fixedAmountMinor: 0, currency: "KES" };
}

export function latestOffer(bid: Pick<BidDoc, "offers">): BidOffer | undefined {
  return bid.offers[bid.offers.length - 1];
}

/** A bid still waiting on someone and not past its expiry. */
export function isOpen(bid: Pick<BidDoc, "status" | "expiresAt">, now = new Date()): boolean {
  return (
    OPEN_BID_STATUSES.includes(bid.status) && new Date(bid.expiresAt).getTime() > now.getTime()
  );
}

/** Whose turn it is: the owner's side after a broker offer, the broker's after a counter. */
export function awaiting(bid: Pick<BidDoc, "status">): "owner" | "broker" | null {
  if (bid.status === "pending") return "owner";
  if (bid.status === "countered") return "broker";
  return null;
}

async function loadListingForBid(listingId: string) {
  const listing = (await Listing.findById(listingId).lean()) as {
    _id: unknown;
    propertyId: string;
    unitId: string;
    state: string;
    visibility?: string;
    deletedAt?: Date | null;
  } | null;
  if (
    !listing ||
    listing.deletedAt ||
    listing.state !== "active" ||
    listing.visibility === "unlisted"
  ) {
    throw new BidError("This listing is not open on the marketplace", 404);
  }
  const property = (await Property.findById(listing.propertyId).select("ownerId").lean()) as {
    ownerId?: string;
  } | null;
  const ownerId = String(property?.ownerId ?? "");
  if (!ownerId) throw new BidError("This listing has no owner", 409);
  return { listing, ownerId };
}

/** A verified broker requests to list a live listing with proposed terms. */
export async function placeBid(
  brokerUserId: string,
  listingId: string,
  terms: BidTerms,
  now = new Date(),
) {
  const profile = (await BrokerProfile.findOne({ userId: brokerUserId })
    .select("status")
    .lean()) as {
    status?: string;
  } | null;
  if (profile?.status !== "verified") {
    throw new BidError("Only verified brokers can request to list properties", 403);
  }
  const { listing, ownerId } = await loadListingForBid(listingId);

  const alreadyListing = await ListingPublisher.exists({
    listingId,
    publisherUserId: brokerUserId,
    publisherRole: "broker",
    state: "active",
  });
  if (alreadyListing) throw new BidError("You are already approved to list this property", 409);

  const open = await BrokerBid.exists({
    brokerUserId,
    listingId,
    status: { $in: [...OPEN_BID_STATUSES] },
    expiresAt: { $gt: now },
  });
  if (open) throw new BidError("You already have an open request on this listing", 409);
  // A lapsed request may still hold the "one open bid" slot until the sweep runs.
  await BrokerBid.updateMany(
    { brokerUserId, listingId, status: { $in: [...OPEN_BID_STATUSES] }, expiresAt: { $lte: now } },
    { $set: { status: "expired" } },
  );

  const approver = await resolveCostApprover(listing.propertyId, ownerId);
  if (!approver) throw new BidError("This property has no one who can approve brokers", 409);

  const clean = normaliseTerms(terms);
  return BrokerBid.create({
    listingId,
    unitId: listing.unitId,
    propertyId: listing.propertyId,
    ownerId,
    brokerUserId,
    offers: [{ ...clean, by: "broker", byUserId: brokerUserId, at: now }],
    status: "pending",
    approverUserId: approver.userId,
    expiresAt: expiryFrom(now),
  });
}

export function canDecideFor(
  actor: { userId: string; role: Role },
  bid: Pick<BidDoc, "approverUserId">,
): boolean {
  return actor.role === "system-admin" || bid.approverUserId === actor.userId;
}

/**
 * Creates the records an approved broker needs, through the existing broker
 * services (same checks and audit as a manual authorisation): a unit-scope
 * authorisation, an active commission agreement with the agreed terms, and
 * the broker's share link. `granter` is the owner-side person who agreed.
 */
async function finalise(bid: BidDoc, granter: { userId: string; role: Role }, terms: BidTerms) {
  const authorization = await authorizeBroker(granter, {
    brokerId: bid.brokerUserId,
    scopeType: "unit",
    scopeId: bid.unitId,
    propertyId: bid.propertyId,
    notes: `Approved broker request ${String(bid._id)}`,
  });

  const existingAgreement = (await CommissionAgreement.findOne({
    brokerId: bid.brokerUserId,
    scopeType: "unit",
    scopeId: bid.unitId,
    status: "active",
  }).lean()) as { _id: unknown } | null;
  const agreement =
    existingAgreement ??
    (await createCommissionAgreement(granter, {
      brokerId: bid.brokerUserId,
      scopeType: "unit",
      scopeId: bid.unitId,
      propertyId: bid.propertyId,
      basis: terms.basis,
      rateBps: terms.rateBps,
      fixedAmountMinor: terms.fixedAmountMinor,
      currency: terms.currency,
      autoActivate: true,
    }));
  await CommissionAgreement.updateOne({ _id: agreement._id }, { $set: { bidId: String(bid._id) } });

  const publisher = (await createBrokerListingPublisher(bid.brokerUserId, bid.listingId)) as {
    _id: unknown;
    shareCode: string;
  };
  return {
    authorizationId: String((authorization as { _id: unknown })._id),
    agreementId: String(agreement._id),
    publisherId: String(publisher._id),
    shareCode: publisher.shareCode,
  };
}

async function roleOf(userId: string): Promise<Role> {
  const user = (await User.findById(userId).select("role").lean()) as { role?: Role } | null;
  return (user?.role ?? "admin") as Role;
}

/** Owner side: approve the broker's terms, reject, or counter with new terms. */
export async function decideBid(
  actor: { userId: string; role: Role },
  bidId: string,
  decision: { action: "approve" | "reject" | "counter"; note?: string; terms?: BidTerms },
  now = new Date(),
): Promise<BidDoc> {
  const bid = (await BrokerBid.findById(bidId).lean()) as BidDoc | null;
  if (!bid || !canDecideFor(actor, bid)) throw new BidError("Request not found", 404);
  if (!isOpen(bid, now)) throw new BidError("This request is no longer open", 409);
  if (awaiting(bid) !== "owner")
    throw new BidError("Waiting for the broker to answer your counter-offer", 409);

  if (decision.action === "reject") {
    if (!decision.note?.trim()) throw new BidError("Add a short reason when rejecting", 400);
    const res = await BrokerBid.updateOne(
      { _id: bid._id, status: "pending" },
      {
        $set: {
          status: "rejected",
          decidedByUserId: actor.userId,
          decidedAt: now,
          decisionNote: decision.note,
        },
      },
    );
    if (res.modifiedCount === 0) throw new BidError("This request changed meanwhile", 409);
  } else if (decision.action === "counter") {
    if (!decision.terms) throw new BidError("Enter the commission you propose", 400);
    const offer = {
      ...normaliseTerms(decision.terms),
      by: "owner",
      byUserId: actor.userId,
      at: now,
    };
    const res = await BrokerBid.updateOne(
      { _id: bid._id, status: "pending" },
      { $push: { offers: offer }, $set: { status: "countered", expiresAt: expiryFrom(now) } },
    );
    if (res.modifiedCount === 0) throw new BidError("This request changed meanwhile", 409);
  } else {
    // Claim the bid first so two approvals cannot both create records.
    const claimed = await BrokerBid.findOneAndUpdate(
      { _id: bid._id, status: "pending" },
      {
        $set: {
          status: "accepted",
          decidedByUserId: actor.userId,
          decidedAt: now,
          decisionNote: decision.note ?? "",
        },
      },
      { new: true },
    ).lean();
    if (!claimed) throw new BidError("This request changed meanwhile", 409);
    try {
      const offer = latestOffer(bid);
      if (!offer) throw new BidError("This request has no terms", 409);
      const result = await finalise(bid, actor, offer);
      await BrokerBid.updateOne({ _id: bid._id }, { $set: { result } });
    } catch (error) {
      // Re-open so the approver can retry; nothing half-done is left marked accepted.
      await BrokerBid.updateOne(
        { _id: bid._id },
        { $set: { status: "pending", decidedByUserId: "", decidedAt: null } },
      );
      if (error instanceof BidError) throw error;
      throw new BidError(
        error instanceof Error ? error.message : "Could not approve the broker",
        403,
      );
    }
  }
  return (await BrokerBid.findById(bid._id).lean()) as BidDoc;
}

/** Broker side: accept or decline a counter-offer, or withdraw their own request. */
export async function respondToBid(
  brokerUserId: string,
  bidId: string,
  action: "accept" | "decline" | "withdraw",
  now = new Date(),
): Promise<BidDoc> {
  const bid = (await BrokerBid.findById(bidId).lean()) as BidDoc | null;
  if (!bid || bid.brokerUserId !== brokerUserId) throw new BidError("Request not found", 404);
  if (!isOpen(bid, now)) throw new BidError("This request is no longer open", 409);

  if (action === "withdraw") {
    await BrokerBid.updateOne(
      { _id: bid._id, status: { $in: [...OPEN_BID_STATUSES] } },
      { $set: { status: "withdrawn", decidedAt: now } },
    );
  } else {
    if (bid.status !== "countered") throw new BidError("There is no counter-offer to answer", 409);
    if (action === "decline") {
      await BrokerBid.updateOne(
        { _id: bid._id, status: "countered" },
        {
          $set: {
            status: "rejected",
            decidedAt: now,
            decisionNote: "Broker declined the counter-offer",
          },
        },
      );
    } else {
      const counter = latestOffer(bid);
      if (counter?.by !== "owner") throw new BidError("There is no counter-offer to accept", 409);
      const claimed = await BrokerBid.findOneAndUpdate(
        { _id: bid._id, status: "countered" },
        { $set: { status: "accepted", decidedAt: now } },
        { new: true },
      ).lean();
      if (!claimed) throw new BidError("This request changed meanwhile", 409);
      try {
        const granter = { userId: counter.byUserId, role: await roleOf(counter.byUserId) };
        const result = await finalise(bid, granter, counter);
        await BrokerBid.updateOne(
          { _id: bid._id },
          { $set: { result, decidedByUserId: counter.byUserId } },
        );
      } catch (error) {
        await BrokerBid.updateOne(
          { _id: bid._id },
          { $set: { status: "countered", decidedAt: null } },
        );
        throw new BidError(
          error instanceof Error ? error.message : "Could not complete the approval",
          409,
        );
      }
    }
  }
  return (await BrokerBid.findById(bid._id).lean()) as BidDoc;
}

/** Daily-job step: mark lapsed requests expired. */
export async function expireBids(now = new Date()): Promise<{ expired: number }> {
  const res = await BrokerBid.updateMany(
    { status: { $in: [...OPEN_BID_STATUSES] }, expiresAt: { $lte: now } },
    { $set: { status: "expired" } },
  );
  return { expired: res.modifiedCount ?? 0 };
}

/** True when the broker already has an active authorisation on the unit (used to hide "Request"). */
export async function brokerAuthorizedOnUnit(
  brokerUserId: string,
  unitId: string,
): Promise<boolean> {
  return Boolean(
    await BrokerAuthorization.exists({
      brokerId: brokerUserId,
      scopeType: "unit",
      scopeId: unitId,
      status: "active",
    }),
  );
}
