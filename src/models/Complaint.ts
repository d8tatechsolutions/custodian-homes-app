import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  type ComplaintCategory,
  type ComplaintPriority,
  type ComplaintStatus,
} from "@/lib/domain-enums";

export type { ComplaintCategory, ComplaintPriority, ComplaintStatus };
export { COMPLAINT_CATEGORIES, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES };

export interface IComplaint {
  tenantId: string;
  propertyId: string;
  ownerId: string;
  unitId: string;
  subject: string;
  category: ComplaintCategory;
  message: string;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  resolution?: string;
  updatedById?: string;
  updatedByRole?: string;
  /** Tasks raised for this complaint (Tasks & Maintenance v2). */
  taskIds?: string[];
  /** Tenant feedback once the work is done: "fixed" or "not_fixed" (reopens it). */
  tenantConfirmation?: {
    status: "none" | "fixed" | "not_fixed";
    at?: Date | null;
    note?: string;
  };
  reopenedCount?: number;
}

const complaintSchema = new Schema<IComplaint>(
  {
    tenantId: { type: String, required: true },
    propertyId: { type: String, required: true },
    ownerId: { type: String, required: true },
    unitId: { type: String, default: "" },
    subject: { type: String, required: true, maxlength: 200 },
    category: { type: String, enum: [...COMPLAINT_CATEGORIES], required: true },
    message: { type: String, required: true },
    status: { type: String, enum: [...COMPLAINT_STATUSES], default: "open" },
    priority: { type: String, enum: [...COMPLAINT_PRIORITIES], default: "medium" },
    resolution: { type: String },
    updatedById: { type: String },
    updatedByRole: { type: String },
    taskIds: { type: [String], default: [] },
    tenantConfirmation: {
      status: { type: String, enum: ["none", "fixed", "not_fixed"], default: "none" },
      at: { type: Date, default: null },
      note: { type: String, trim: true, maxlength: 1000, default: "" },
    },
    reopenedCount: { type: Number, min: 0, default: 0 },
  },
  {
    timestamps: true,
  },
);

complaintSchema.index({ tenantId: 1, createdAt: -1 });
complaintSchema.index({ propertyId: 1, status: 1 });
complaintSchema.index({ ownerId: 1, createdAt: -1 });
complaintSchema.index({ unitId: 1, createdAt: -1 });

export type ComplaintDocument = InferSchemaType<IComplaint>;

export const Complaint =
  mongoose.models.Complaint || model<IComplaint>("Complaint", complaintSchema);
