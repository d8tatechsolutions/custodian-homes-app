import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

export const BROKER_BID_STATUSES = [
  "pending",
  "countered",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
] as const;
export type BrokerBidStatus = (typeof BROKER_BID_STATUSES)[number];

/** Statuses where the bid is still waiting on someone. */
export const OPEN_BID_STATUSES: readonly BrokerBidStatus[] = ["pending", "countered"];

const offerSchema = new Schema(
  {
    by: { type: String, enum: ["broker", "owner"], required: true },
    byUserId: { type: String, required: true },
    basis: {
      type: String,
      enum: ["first_month_rent", "percentage_of_rent", "fixed"],
      required: true,
    },
    rateBps: { type: Number, min: 0, max: 10000, default: 0 },
    fixedAmountMinor: { type: Number, min: 0, default: 0 },
    /** Percentage bases are on KES rent; only fixed amounts may be USD. */
    currency: { type: String, enum: ["KES", "USD"], default: "KES" },
    message: { type: String, trim: true, maxlength: 1000, default: "" },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

/**
 * A broker's request to list (market) a live listing, with the commission
 * they propose. The property's approver approves, rejects or counters; the
 * broker accepts or declines a counter. Several brokers can be approved on
 * one listing. On acceptance the existing BrokerAuthorization,
 * CommissionAgreement and ListingPublisher records are created, so commission
 * and attribution logic is unchanged.
 */
const brokerBidSchema = new Schema(
  {
    listingId: { type: String, required: true, trim: true },
    unitId: { type: String, required: true, trim: true },
    propertyId: { type: String, required: true, trim: true },
    ownerId: { type: String, required: true, trim: true },
    brokerUserId: { type: String, required: true, trim: true },
    offers: { type: [offerSchema], default: [] },
    status: { type: String, enum: [...BROKER_BID_STATUSES], default: "pending" },
    /** Who may decide for the owner (owner with account, else custodian, else admin). */
    approverUserId: { type: String, required: true, trim: true },
    decidedByUserId: { type: String, default: "" },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, maxlength: 1000, default: "" },
    result: {
      authorizationId: { type: String, default: "" },
      agreementId: { type: String, default: "" },
      publisherId: { type: String, default: "" },
      shareCode: { type: String, default: "" },
    },
    /** Unanswered bids lapse 14 days after the last offer (client decision O5). */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One open bid per broker per listing.
brokerBidSchema.index(
  { brokerUserId: 1, listingId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "countered"] } } },
);
brokerBidSchema.index({ listingId: 1, status: 1 });
brokerBidSchema.index({ approverUserId: 1, status: 1 });
brokerBidSchema.index({ status: 1, expiresAt: 1 });

export type BrokerBidDocument = InferSchemaType<typeof brokerBidSchema>;

export const BrokerBid =
  mongoose.models.BrokerBid || model<BrokerBidDocument>("BrokerBid", brokerBidSchema);
