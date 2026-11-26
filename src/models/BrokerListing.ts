import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

export const BROKER_LISTING_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "expired",
  "withdrawn",
] as const;
export type BrokerListingStatus = (typeof BROKER_LISTING_STATUSES)[number];

/** Approved listings stay live this long and can be renewed (client decision). */
export const BROKER_LISTING_LIFETIME_DAYS = 60;
export const MIN_BROKER_LISTING_PHOTOS = 3;

const photoSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    key: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

/**
 * A property a broker markets that is NOT managed on the platform (client
 * decision 2026-11-26). Rent or sale. The system-admin must approve it before
 * it appears on the marketplace, after the automatic duplicate-photo check.
 *
 * Fraud evidence (owner mandate, owner contact, exact location) is visible to
 * the broker and the system-admin only — never on the public marketplace.
 */
const brokerListingSchema = new Schema(
  {
    brokerUserId: { type: String, required: true, trim: true },
    purpose: { type: String, enum: ["rent", "sale"], required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 5000, default: "" },
    propertyType: { type: String, trim: true, maxlength: 60, default: "" },
    /** Public, coarse location. */
    county: { type: String, trim: true, maxlength: 80, required: true },
    area: { type: String, trim: true, maxlength: 120, required: true },
    /** KES. Monthly rent for rentals, asking price for sales. */
    price: { type: Number, required: true, min: 1 },
    serviceCharge: { type: Number, min: 0, default: 0 },
    depositMonths: { type: Number, min: 0, max: 24, default: 0 },
    bedrooms: { type: Number, min: 0, max: 100, default: 0 },
    bathrooms: { type: Number, min: 0, max: 100, default: 0 },
    sizeSqm: { type: Number, min: 0, default: 0 },
    amenities: { type: [String], default: [] },
    photos: { type: [photoSchema], default: [] },
    // ── Private (broker + system-admin only) ──
    exactLocation: {
      address: { type: String, trim: true, maxlength: 300, default: "" },
      latitude: { type: Number, min: -90, max: 90, default: null },
      longitude: { type: Number, min: -180, max: 180, default: null },
    },
    mandateDocument: {
      url: { type: String, trim: true, default: "" },
      key: { type: String, trim: true, default: "" },
      name: { type: String, trim: true, default: "" },
    },
    ownerContact: {
      name: { type: String, trim: true, maxlength: 120, default: "" },
      phone: { type: String, trim: true, maxlength: 32, default: "" },
    },
    // ── Review ──
    status: { type: String, enum: [...BROKER_LISTING_STATUSES], default: "draft" },
    submittedAt: { type: Date, default: null },
    reviewedByUserId: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 1000, default: "" },
    approvedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    renewals: { type: Number, min: 0, default: 0 },
    /** Open duplicate-photo flags found at submission (shown to the reviewer). */
    duplicateFlags: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

brokerListingSchema.index({ brokerUserId: 1, status: 1, updatedAt: -1 });
brokerListingSchema.index({ status: 1, expiresAt: 1 });
brokerListingSchema.index({ status: 1, purpose: 1, county: 1 });

export type BrokerListingDocument = InferSchemaType<typeof brokerListingSchema>;

export const BrokerListing =
  mongoose.models.BrokerListing ||
  model<BrokerListingDocument>("BrokerListing", brokerListingSchema);
