import type {
  CostApprovalStatus,
  RecurrenceEndKind,
  RecurrenceFrequency,
  TaskLocationKind,
  TaskPayer,
  TaskStatusV2,
} from "@/lib/maintenance/enums";

export type TaskPriority = "low" | "medium" | "high";

export interface TaskMedia {
  _id: string;
  url: string;
  key?: string;
  name?: string;
  kind: "image" | "document";
  uploadedBy: string;
  uploadedAt: string;
}

export interface TaskLocation {
  kind: TaskLocationKind;
  blockId?: string;
  floorId?: string;
  unitId?: string;
  commonAreaId?: string;
  label?: string;
}

export interface TaskAssignee {
  kind: "staff" | "vendor";
  userId?: string;
  vendorId?: string;
  name?: string;
}

export interface TaskCost {
  quote?: { amount: number; note?: string; by: string; at: string } | null;
  approval?: {
    status: CostApprovalStatus;
    approverUserId?: string;
    decidedBy?: string;
    decidedAt?: string | null;
    note?: string;
  };
  labourAmount?: number;
  materialsAmount?: number;
  payer?: TaskPayer;
  tenantInvoiceId?: string;
  vendorPayment?: {
    status: "unpaid" | "paid";
    paidAt?: string | null;
    method?: string;
    reference?: string;
  };
}

export interface MaintenanceTask {
  _id: string;
  ownerId: string;
  title: string;
  propertyId: string;
  property: string;
  priority: TaskPriority;
  status: TaskStatusV2;
  assignedTo?: string;
  assignedToName?: string;
  createdBy: string;
  createdByRole: string;
  createdByName?: string;
  dueDate: string;
  completedAt?: string;
  notes?: string;
  category?: string;
  location?: TaskLocation;
  assignee?: TaskAssignee | null;
  complaintIds?: string[];
  scheduledFor?: string;
  photosBefore?: TaskMedia[];
  photosAfter?: TaskMedia[];
  attachments?: TaskMedia[];
  receipts?: TaskMedia[];
  cost?: TaskCost;
  scheduleId?: string;
  overdue: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskActivityEntry {
  _id: string;
  actorId: string;
  actorRole: string;
  actorName?: string;
  kind: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface VendorRecord {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  trades: string[];
  kind: "external" | "staff";
  propertyIds: string[];
  notes?: string;
  isActive: boolean;
}

export interface TaskCategoryOption {
  id: string;
  name: string;
  builtIn: boolean;
}

export interface CommonArea {
  _id: string;
  name: string;
  isActive: boolean;
}

export interface PropertyOperationsSettings {
  approvalThreshold: number | null;
  commonAreas: CommonArea[];
}

export interface TaskScheduleRecord {
  _id: string;
  propertyId: string;
  property: string;
  title: string;
  category?: string;
  priority: TaskPriority;
  rule: { frequency: RecurrenceFrequency; interval: number };
  startDate: string;
  dueAfterDays?: number;
  end: { kind: RecurrenceEndKind; count?: number | null; until?: string };
  nextRunDate: string;
  occurrencesCreated: number;
  isActive: boolean;
  summary: string;
  assignee?: { kind: string; name?: string };
  location?: TaskLocation;
}

export interface AssigneeOptions {
  staff: { id: string; name: string; role: string }[];
  vendors: { id: string; name: string; trades: string[]; phone: string }[];
}

export interface ComplaintProgress {
  confirmation: "none" | "fixed" | "not_fixed";
  tasks: {
    id: string;
    status: TaskStatusV2;
    statusLabel: string;
    assigned: boolean;
    scheduledFor: string;
    completedAt: string;
    photosBefore: { id: string; url: string }[];
    photosAfter: { id: string; url: string }[];
  }[];
}
