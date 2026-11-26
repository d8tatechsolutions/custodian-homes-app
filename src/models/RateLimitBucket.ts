import mongoose, { model, Schema } from "mongoose";

/**
 * One fixed-window request counter (`_id` = "<key>:<window index>").
 * MongoDB removes buckets automatically once `expireAt` passes.
 */
const rateLimitBucketSchema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expireAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateLimitBucketSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitBucket =
  mongoose.models.RateLimitBucket || model("RateLimitBucket", rateLimitBucketSchema);
