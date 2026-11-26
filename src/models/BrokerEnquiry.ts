import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

/**
 * A visitor's enquiry on a broker's own listing. It reaches the broker
 * through the platform; the broker's phone is never shown publicly.
 */
const brokerEnquirySchema = new Schema(
  {
    brokerListingId: { type: String, required: true, trim: true },
    brokerUserId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 32 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: "" },
    message: { type: String, trim: true, maxlength: 2000, default: "" },
    status: { type: String, enum: ["new", "contacted", "closed"], default: "new" },
  },
  { timestamps: true },
);

brokerEnquirySchema.index({ brokerUserId: 1, createdAt: -1 });
brokerEnquirySchema.index({ brokerListingId: 1, createdAt: -1 });

export type BrokerEnquiryDocument = InferSchemaType<typeof brokerEnquirySchema>;

export const BrokerEnquiry =
  mongoose.models.BrokerEnquiry ||
  model<BrokerEnquiryDocument>("BrokerEnquiry", brokerEnquirySchema);
