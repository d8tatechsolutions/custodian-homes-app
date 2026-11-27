import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

/**
 * Perceptual fingerprint (64-bit difference hash, as 16 hex chars) of a
 * listing photo, used to spot the same photos reused on another property.
 */
const mediaFingerprintSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    hash: { type: String, required: true, trim: true },
    listingId: { type: String, required: true, trim: true },
    propertyId: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

mediaFingerprintSchema.index({ listingId: 1, url: 1 }, { unique: true });
mediaFingerprintSchema.index({ propertyId: 1 });

export type MediaFingerprintDocument = InferSchemaType<typeof mediaFingerprintSchema>;

export const MediaFingerprint =
  mongoose.models.MediaFingerprint ||
  model<MediaFingerprintDocument>("MediaFingerprint", mediaFingerprintSchema);
