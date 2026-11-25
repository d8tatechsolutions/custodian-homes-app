import { z } from "zod";
import { TASK_PRIORITIES } from "@/lib/domain-enums";
import { isDayString } from "@/lib/maintenance/dates";
import {
  RECURRENCE_END_KINDS,
  RECURRENCE_FREQUENCIES,
  TASK_ASSIGNEE_KINDS,
  TASK_LOCATION_KINDS,
  TASK_PAYERS,
  TASK_STATUSES_V2,
} from "@/lib/maintenance/enums";

const id = z.string().trim().max(64);
const day = z
  .string()
  .trim()
  .refine((v) => isDayString(v), "Use a valid date (YYYY-MM-DD)");
const amount = z.coerce.number().finite().min(0).max(100_000_000);

/** A file already uploaded to UploadThing (the client sends the result). */
export const mediaInput = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https:\/\/([a-z0-9-]+\.)*(ufs\.sh|utfs\.io|uploadthing\.com)\//i.test(u), {
      message: "Files must be uploaded through the app",
    }),
  key: z.string().trim().max(200).optional().default(""),
  name: z.string().trim().max(200).optional().default(""),
});

export const locationInput = z.object({
  kind: z.enum(TASK_LOCATION_KINDS),
  blockId: id.optional(),
  floorId: id.optional(),
  unitId: id.optional(),
  commonAreaId: id.optional(),
});

export const assigneeInput = z
  .object({
    kind: z.enum(TASK_ASSIGNEE_KINDS),
    userId: id.optional(),
    vendorId: id.optional(),
  })
  .refine((a) => (a.kind === "staff" ? Boolean(a.userId) : Boolean(a.vendorId)), {
    message: "Pick who the task is assigned to",
  });

/** v2 fields accepted on task create (POST /api/v1/tasks) when the flag is on. */
export const taskV2CreateFields = z.object({
  category: z.string().trim().max(60).optional().default(""),
  location: locationInput.optional(),
  assignee: assigneeInput.nullable().optional(),
  scheduledFor: day.optional().or(z.literal("")),
  complaintIds: z.array(id).max(20).optional().default([]),
  photosBefore: z.array(mediaInput).max(3).optional().default([]),
});

export const taskV2UpdateFields = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  notes: z.string().trim().max(2000).optional(),
  dueDate: day.optional(),
  scheduledFor: day.optional().or(z.literal("")),
  category: z.string().trim().max(60).optional(),
  location: locationInput.optional(),
});

export const statusChangeInput = z.object({
  status: z.enum(TASK_STATUSES_V2),
  note: z.string().trim().max(1000).optional().default(""),
  /** Asked when finishing/cancelling a task linked to complaints. */
  resolveComplaints: z.boolean().optional().default(false),
});

export const assignInput = z.object({ assignee: assigneeInput.nullable() });

export const photoInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), side: z.enum(["before", "after"]), media: mediaInput }),
  z.object({ action: z.literal("remove"), side: z.enum(["before", "after"]), mediaId: id }),
]);

export const attachmentInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    target: z.enum(["attachments", "receipts"]),
    media: mediaInput,
  }),
  z.object({
    action: z.literal("remove"),
    target: z.enum(["attachments", "receipts"]),
    mediaId: id,
  }),
]);

export const quoteInput = z.object({
  amount: amount.refine((v) => v > 0, "Enter the quoted amount"),
  note: z.string().trim().max(1000).optional().default(""),
});

export const approvalInput = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional().default(""),
});

export const costInput = z.object({
  labourAmount: amount.optional(),
  materialsAmount: amount.optional(),
  payer: z.enum(TASK_PAYERS).optional(),
  vendorPayment: z
    .object({
      status: z.enum(["unpaid", "paid"]),
      paidAt: day.optional().or(z.literal("")),
      method: z.string().trim().max(60).optional().default(""),
      reference: z.string().trim().max(120).optional().default(""),
    })
    .optional(),
});

export const billTenantInput = z.object({
  /** Defaults to labour + materials when omitted. */
  amount: amount.optional(),
  /** The tenant to bill when the task has several candidates. */
  tenantId: id.optional(),
});

export const commentInput = z.object({ message: z.string().trim().min(1).max(2000) });

export const complaintLinkInput = z.object({
  complaintId: id.min(1),
  action: z.enum(["link", "unlink"]),
});

export const vendorInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().min(6, "Phone is required").max(32),
  email: z
    .union([z.string().trim().email().max(200), z.literal("")])
    .optional()
    .default(""),
  trades: z.array(z.string().trim().min(1).max(40)).max(10).optional().default([]),
  kind: z.enum(["external", "staff"]).optional().default("external"),
  propertyIds: z.array(id).max(500).optional().default([]),
  notes: z.string().trim().max(1000).optional().default(""),
  isActive: z.boolean().optional().default(true),
});
/** Edits carry no defaults, so omitted fields are left untouched. */
export const vendorUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(6).max(32).optional(),
  email: z.union([z.string().trim().email().max(200), z.literal("")]).optional(),
  trades: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  kind: z.enum(["external", "staff"]).optional(),
  propertyIds: z.array(id).max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const scheduleInput = z
  .object({
    propertyId: id.min(1),
    title: z.string().trim().min(1).max(200),
    category: z.string().trim().max(60).optional().default(""),
    priority: z.enum(TASK_PRIORITIES).optional().default("medium"),
    notes: z.string().trim().max(2000).optional().default(""),
    location: locationInput.optional(),
    assignee: assigneeInput.nullable().optional(),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.coerce.number().int().min(1).max(365).optional().default(1),
    startDate: day,
    dueAfterDays: z.coerce.number().int().min(0).max(60).optional().default(0),
    endKind: z.enum(RECURRENCE_END_KINDS).optional().default("never"),
    endCount: z.coerce.number().int().min(1).max(1000).optional(),
    endUntil: day.optional(),
  })
  .refine((s) => s.endKind !== "count" || Boolean(s.endCount), {
    message: "Enter how many times it repeats",
    path: ["endCount"],
  })
  .refine((s) => s.endKind !== "until" || (s.endUntil !== undefined && s.endUntil >= s.startDate), {
    message: "The end date must be on or after the start date",
    path: ["endUntil"],
  });

export const scheduleUpdate = z.object({ isActive: z.boolean() });

export const categoryInput = z.object({ name: z.string().trim().min(1).max(60) });

export const operationsInput = z.object({
  approvalThreshold: amount.nullable().optional(),
  commonAreas: z
    .array(
      z.object({
        _id: id.optional(),
        name: z.string().trim().min(1).max(80),
        isActive: z.boolean().optional().default(true),
      }),
    )
    .max(100)
    .optional(),
});

export const tenantConfirmationInput = z.object({
  fixed: z.boolean(),
  note: z.string().trim().max(1000).optional().default(""),
});
