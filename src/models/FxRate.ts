import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

/**
 * Daily exchange-rate snapshot: 1 `base` = `rate` `quote` (e.g. 1 USD = 129.25 KES).
 * One row per base/quote/day so history is kept and reports can convert a
 * payment at the rate of the day it was made.
 */
const fxRateSchema = new Schema(
  {
    base: { type: String, required: true, uppercase: true, trim: true },
    quote: { type: String, required: true, uppercase: true, trim: true },
    rate: { type: Number, required: true, min: 0 },
    source: { type: String, required: true, trim: true },
    /** Calendar day the provider published the rate for (YYYY-MM-DD, UTC). */
    effectiveDate: { type: String, required: true, trim: true },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

fxRateSchema.index({ base: 1, quote: 1, effectiveDate: 1 }, { unique: true });
fxRateSchema.index({ base: 1, quote: 1, fetchedAt: -1 });

export type FxRateDocument = InferSchemaType<typeof fxRateSchema>;

export const FxRate = mongoose.models.FxRate || model<FxRateDocument>("FxRate", fxRateSchema);
