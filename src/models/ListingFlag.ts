import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

/**
 * A possible duplicate listing for the system-admin to review: a photo on
 * `listingId` looks the same as one on `matchedListingId` (another property).
 */
const listingFlagSchema = new Schema(
  {
    kind: { type: String, enum: ["duplicate_photo"], default: "duplicate_photo" },
    listingId: { type: String, required: true, trim: true },
    propertyId: { type: String, required: true, trim: true },
    matchedListingId: { type: String, required: true, trim: true },
    matchedPropertyId: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    matchedUrl: { type: String, required: true, trim: true },
    /** Hamming distance between the two fingerprints (0 = identical). */
    distance: { type: Number, required: true, min: 0, max: 64 },
    status: { type: String, enum: ["open", "dismissed", "actioned"], default: "open" },
    resolvedByUserId: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    note: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true },
);

listingFlagSchema.index({ status: 1, createdAt: -1 });
listingFlagSchema.index({ listingId: 1, matchedListingId: 1, url: 1 }, { unique: true });

export type ListingFlagDocument = InferSchemaType<typeof listingFlagSchema>;

export const ListingFlag =
  mongoose.models.ListingFlag || model<ListingFlagDocument>("ListingFlag", listingFlagSchema);
