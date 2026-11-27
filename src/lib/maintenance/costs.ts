import type { ITaskCost } from "@/models/Task";

/** A complete cost block with defaults, used when a task has none yet. */
export function emptyCost(): ITaskCost {
  return {
    quote: null,
    approval: {
      status: "not_required",
      approverUserId: "",
      decidedBy: "",
      decidedAt: null,
      note: "",
      resumeStatus: "",
    },
    labourAmount: 0,
    materialsAmount: 0,
    payer: "owner",
    tenantInvoiceId: "",
    vendorPayment: { status: "unpaid", paidAt: null, method: "", reference: "" },
  };
}

/** Actual cost recorded so far (labour + materials). */
export function actualCost(cost: Partial<ITaskCost> | undefined | null): number {
  return Math.round(((cost?.labourAmount ?? 0) + (cost?.materialsAmount ?? 0)) * 100) / 100;
}

/** Statuses a task returns to after an approval decision. */
export function resumeStatusAfterApproval(
  resume: string | undefined,
): "open" | "in-progress" | "waiting-parts" | "waiting-vendor" {
  return resume === "in-progress" || resume === "waiting-parts" || resume === "waiting-vendor"
    ? resume
    : "open";
}
