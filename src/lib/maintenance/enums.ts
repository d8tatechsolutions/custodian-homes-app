import { TASK_STATUSES } from "@/lib/domain-enums";

/**
 * Tasks & Maintenance v2 enums. A strict superset of the original task
 * statuses (`open | in-progress | done`) so existing tasks stay valid.
 * Kept out of `domain-enums.ts` to avoid touching a shared file.
 */
export const TASK_STATUSES_V2 = [
  ...TASK_STATUSES,
  "waiting-approval",
  "waiting-parts",
  "waiting-vendor",
  "cancelled",
] as const;
export type TaskStatusV2 = (typeof TASK_STATUSES_V2)[number];

export const TASK_STATUS_LABELS: Record<TaskStatusV2, string> = {
  open: "Open",
  "in-progress": "In progress",
  "waiting-approval": "Waiting for approval",
  "waiting-parts": "Waiting for parts",
  "waiting-vendor": "Waiting for vendor",
  done: "Done",
  cancelled: "Cancelled",
};

/** Statuses that count as "still to do" (overdue applies to these). */
export const ACTIVE_TASK_STATUSES: readonly TaskStatusV2[] = [
  "open",
  "in-progress",
  "waiting-approval",
  "waiting-parts",
  "waiting-vendor",
];

export const TASK_LOCATION_KINDS = ["property", "block", "floor", "unit", "common_area"] as const;
export type TaskLocationKind = (typeof TASK_LOCATION_KINDS)[number];

export const TASK_ASSIGNEE_KINDS = ["staff", "vendor"] as const;
export type TaskAssigneeKind = (typeof TASK_ASSIGNEE_KINDS)[number];

export const TASK_PAYERS = ["owner", "tenant", "service_charge"] as const;
export type TaskPayer = (typeof TASK_PAYERS)[number];

export const TASK_PAYER_LABELS: Record<TaskPayer, string> = {
  owner: "Owner",
  tenant: "Tenant",
  service_charge: "Service-charge fund",
};

export const COST_APPROVAL_STATUSES = ["not_required", "pending", "approved", "rejected"] as const;
export type CostApprovalStatus = (typeof COST_APPROVAL_STATUSES)[number];

export const TASK_ACTIVITY_KINDS = [
  "created",
  "comment",
  "status",
  "assign",
  "photo",
  "attachment",
  "quote",
  "approval",
  "cost",
  "vendor_payment",
  "bill_tenant",
  "complaint_link",
  "tenant_confirmation",
  "notify",
] as const;
export type TaskActivityKind = (typeof TASK_ACTIVITY_KINDS)[number];

/** Starting categories; admins add their own on top (TaskCategory). */
export const DEFAULT_TASK_CATEGORIES = [
  "Plumbing",
  "Electrical",
  "Cleaning",
  "Security",
  "Painting",
  "Carpentry",
  "Pest control",
  "Other",
] as const;

export const MAX_TASK_PHOTOS_PER_SIDE = 3;
export const MAX_TASK_ATTACHMENTS = 10;

/** Due-date offsets (days) for tasks auto-created from a complaint. */
export const COMPLAINT_TASK_DUE_DAYS: Record<"low" | "medium" | "high", number> = {
  high: 1,
  medium: 3,
  low: 7,
};

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const RECURRENCE_END_KINDS = ["never", "count", "until"] as const;
export type RecurrenceEndKind = (typeof RECURRENCE_END_KINDS)[number];
