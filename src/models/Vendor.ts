import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import { softDeletePlugin } from "@/lib/mongoose-soft-delete";

/**
 * A contractor or in-house worker who can be assigned tasks. Vendors never log
 * in. Each admin (`ownerId`) keeps their own list and picks which of their
 * properties each vendor serves (`propertyIds`; empty = none yet).
 */
const vendorSchema = new Schema(
  {
    ownerId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 32 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: "" },
    trades: { type: [String], default: [] },
    /** "external" = outside company / fundi, "staff" = own worker. */
    kind: { type: String, enum: ["external", "staff"], default: "external" },
    propertyIds: { type: [String], default: [] },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

softDeletePlugin(vendorSchema);
vendorSchema.index({ ownerId: 1, isActive: 1, name: 1 });
vendorSchema.index({ propertyIds: 1 });

export type VendorDocument = InferSchemaType<typeof vendorSchema>;

export const Vendor = mongoose.models.Vendor || model<VendorDocument>("Vendor", vendorSchema);
