import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/domain-enums";
import {
  COST_APPROVAL_STATUSES,
  type CostApprovalStatus,
  TASK_ASSIGNEE_KINDS,
  TASK_LOCATION_KINDS,
  TASK_PAYERS,
  TASK_STATUSES_V2,
  type TaskAssigneeKind,
  type TaskLocationKind,
  type TaskPayer,
  type TaskStatusV2,
} from "@/lib/maintenance/enums";

export type { TaskPriority, TaskStatus } from "@/lib/domain-enums";
export { TASK_PRIORITIES, TASK_STATUSES };

/** An uploaded image or document attached to a task. */
export interface ITaskMedia {
  url: string;
  key?: string;
  name?: string;
  kind: "image" | "document";
  uploadedBy: string;
  uploadedAt: Date;
}

export interface ITaskLocation {
  kind: TaskLocationKind;
  blockId?: string;
  floorId?: string;
  unitId?: string;
  commonAreaId?: string;
  /** Human-readable breadcrumb, e.g. "Block A › Floor 3 › 3B". */
  label?: string;
}

export interface ITaskAssignee {
  kind: TaskAssigneeKind;
  userId?: string;
  vendorId?: string;
  name?: string;
}

export interface ITaskCost {
  quote?: {
    amount: number;
    note?: string;
    by: string;
    at: Date;
  } | null;
  approval: {
    status: CostApprovalStatus;
    approverUserId?: string;
    decidedBy?: string;
    decidedAt?: Date | null;
    note?: string;
  };
  labourAmount?: number;
  materialsAmount?: number;
  payer?: TaskPayer;
  tenantInvoiceId?: string;
  vendorPayment: {
    status: "unpaid" | "paid";
    paidAt?: Date | null;
    method?: string;
    reference?: string;
  };
}

export interface ITask {
  ownerId: string;
  title: string;
  propertyId: string;
  propertyName?: string;
  priority: (typeof TASK_PRIORITIES)[number];
  status: TaskStatusV2;
  assignedTo?: string;
  assignedToName?: string;
  createdBy: string;
  createdByRole: string;
  createdByName?: string;
  dueDate: string;
  completedAt?: string;
  notes?: string;
  // ── v2 (all optional; legacy tasks keep working) ──
  category?: string;
  location?: ITaskLocation;
  assignee?: ITaskAssignee | null;
  complaintIds?: string[];
  scheduledFor?: string;
  photosBefore?: ITaskMedia[];
  photosAfter?: ITaskMedia[];
  attachments?: ITaskMedia[];
  receipts?: ITaskMedia[];
  cost?: ITaskCost;
  scheduleId?: string;
  /** YYYY-MM-DD occurrence a recurring schedule generated this task for. */
  occurrenceDate?: string;
  startedAt?: string;
  cancelledAt?: string;
}

const mediaSchema = new Schema<ITaskMedia>(
  {
    url: { type: String, required: true, trim: true },
    key: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },
    kind: { type: String, enum: ["image", "document"], required: true },
    uploadedBy: { type: String, required: true, trim: true },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

const locationSchema = new Schema<ITaskLocation>(
  {
    kind: { type: String, enum: [...TASK_LOCATION_KINDS], default: "property" },
    blockId: { type: String, trim: true, default: "" },
    floorId: { type: String, trim: true, default: "" },
    unitId: { type: String, trim: true, default: "" },
    commonAreaId: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const assigneeSchema = new Schema<ITaskAssignee>(
  {
    kind: { type: String, enum: [...TASK_ASSIGNEE_KINDS], required: true },
    userId: { type: String, trim: true, default: "" },
    vendorId: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const costSchema = new Schema<ITaskCost>(
  {
    quote: {
      type: new Schema(
        {
          amount: { type: Number, required: true, min: 0 },
          note: { type: String, trim: true, default: "" },
          by: { type: String, required: true },
          at: { type: Date, default: () => new Date() },
        },
        { _id: false },
      ),
      default: null,
    },
    approval: {
      status: { type: String, enum: [...COST_APPROVAL_STATUSES], default: "not_required" },
      approverUserId: { type: String, default: "" },
      decidedBy: { type: String, default: "" },
      decidedAt: { type: Date, default: null },
      note: { type: String, trim: true, default: "" },
    },
    labourAmount: { type: Number, min: 0, default: 0 },
    materialsAmount: { type: Number, min: 0, default: 0 },
    payer: { type: String, enum: [...TASK_PAYERS], default: "owner" },
    tenantInvoiceId: { type: String, default: "" },
    vendorPayment: {
      status: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
      paidAt: { type: Date, default: null },
      method: { type: String, trim: true, default: "" },
      reference: { type: String, trim: true, default: "" },
    },
  },
  { _id: false },
);

const taskSchema = new Schema<ITask>(
  {
    ownerId: { type: String, required: true, trim: true, default: "" },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    propertyId: { type: String, required: true, trim: true },
    propertyName: { type: String, trim: true, default: "" },
    priority: { type: String, enum: [...TASK_PRIORITIES], default: "medium" },
    status: { type: String, enum: [...TASK_STATUSES_V2], default: "open" },
    assignedTo: { type: String, trim: true, default: "" },
    assignedToName: { type: String, trim: true, default: "" },
    createdBy: { type: String, required: true, trim: true },
    createdByRole: { type: String, required: true, trim: true },
    createdByName: { type: String, trim: true, default: "" },
    dueDate: { type: String, required: true, trim: true },
    completedAt: { type: String, default: "" },
    notes: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, maxlength: 60, default: "" },
    location: { type: locationSchema, default: undefined },
    assignee: { type: assigneeSchema, default: null },
    complaintIds: { type: [String], default: [] },
    scheduledFor: { type: String, trim: true, default: "" },
    photosBefore: { type: [mediaSchema], default: [] },
    photosAfter: { type: [mediaSchema], default: [] },
    attachments: { type: [mediaSchema], default: [] },
    receipts: { type: [mediaSchema], default: [] },
    cost: { type: costSchema, default: undefined },
    scheduleId: { type: String, trim: true, default: "" },
    occurrenceDate: { type: String, trim: true, default: "" },
    startedAt: { type: String, default: "" },
    cancelledAt: { type: String, default: "" },
  },
  { timestamps: true },
);

taskSchema.index({ ownerId: 1, status: 1 });
taskSchema.index({ propertyId: 1, status: 1 });
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ createdBy: 1, createdAt: -1 });
taskSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
taskSchema.index({ propertyId: 1, status: 1, createdAt: -1 });
taskSchema.index({ complaintIds: 1 });
taskSchema.index({ "cost.approval.approverUserId": 1, "cost.approval.status": 1 });
// A recurring schedule creates each occurrence at most once (safe cron re-runs).
taskSchema.index(
  { scheduleId: 1, occurrenceDate: 1 },
  { unique: true, partialFilterExpression: { scheduleId: { $gt: "" } } },
);

export type TaskDocument = InferSchemaType<ITask>;

export const Task = mongoose.models.Task || model<ITask>("Task", taskSchema);
