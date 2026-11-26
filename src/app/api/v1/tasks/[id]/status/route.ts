import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { canReopenCancelled } from "@/lib/maintenance/access";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { TASK_STATUS_LABELS, type TaskStatusV2 } from "@/lib/maintenance/enums";
import { type NoticeTask, notifyTenantProgress } from "@/lib/maintenance/notify";
import { guardMutation, loadScopedTask, respondWithTask } from "@/lib/maintenance/route-helpers";
import { canTransition } from "@/lib/maintenance/status";
import { statusChangeInput } from "@/lib/schemas/maintenance";
import { Complaint } from "@/models/Complaint";
import { Task } from "@/models/Task";

/**
 * Moves a task to another status (manual moves only — approval moves happen in
 * the quote/approval routes). Linked complaints follow: starting work marks
 * them in progress; finishing or cancelling resolves them when the caller
 * confirmed "Also resolve the complaint?".
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:manage");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = statusChangeInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid status change", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const from = task.status as TaskStatusV2;
  const to = parsed.data.status;

  if (from === to) {
    return NextResponse.json(
      { error: `The task is already ${TASK_STATUS_LABELS[to]}` },
      { status: 409 },
    );
  }
  if (to === "waiting-approval" || (from === "waiting-approval" && to !== "cancelled")) {
    return NextResponse.json(
      { error: "Approval status is set by the quote and approval steps" },
      { status: 409 },
    );
  }
  if (!canTransition(from, to)) {
    return NextResponse.json(
      {
        error: `A task that is ${TASK_STATUS_LABELS[from]} cannot move to ${TASK_STATUS_LABELS[to]}`,
      },
      { status: 409 },
    );
  }
  if (from === "cancelled" && !canReopenCancelled(actor)) {
    return NextResponse.json(
      { error: "Only the owner can reopen a cancelled task" },
      { status: 403 },
    );
  }
  if (to === "done" && task.cost?.approval?.status === "pending") {
    return NextResponse.json({ error: "The cost is still waiting for approval" }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const set: Record<string, unknown> = { status: to };
  if (to === "done") set.completedAt = nowIso;
  else set.completedAt = "";
  if (to === "in-progress" && !task.startedAt) set.startedAt = nowIso;
  set.cancelledAt = to === "cancelled" ? nowIso : "";

  // Guard on the status we validated against so concurrent moves cannot race.
  const updated = await Task.findOneAndUpdate(
    { _id: task._id, status: from },
    { $set: set },
    { new: true },
  ).lean();
  if (!updated) {
    return NextResponse.json(
      { error: "The task changed meanwhile; refresh and try again" },
      { status: 409 },
    );
  }

  const who = { userId: actor.userId, role: actor.role, name: actorName };
  await recordTaskActivity(
    task,
    who,
    "status",
    `${TASK_STATUS_LABELS[from]} → ${TASK_STATUS_LABELS[to]}${parsed.data.note ? `: ${parsed.data.note}` : ""}`,
    { from, to },
  );

  const complaintIds = task.complaintIds ?? [];
  if (complaintIds.length > 0) {
    const stamp = { updatedById: actor.userId, updatedByRole: actor.role };
    if (to === "in-progress") {
      await Complaint.updateMany(
        { _id: { $in: complaintIds }, status: "open" },
        { $set: { status: "in-progress", ...stamp } },
      );
      // Only the first start is news to the tenant (not resuming after parts).
      if (!task.startedAt) await notifyTenantProgress(task as NoticeTask, "started");
    }
    if ((to === "done" || to === "cancelled") && parsed.data.resolveComplaints) {
      await Complaint.updateMany(
        { _id: { $in: complaintIds }, status: { $ne: "resolved" } },
        {
          $set: {
            status: "resolved",
            resolution:
              parsed.data.note ||
              (to === "done"
                ? "The work has been completed."
                : "This request was closed by staff."),
            "tenantConfirmation.status": "none",
            "tenantConfirmation.at": null,
            ...stamp,
          },
        },
      );
      await recordTaskActivity(task, who, "complaint_link", "Linked complaints marked resolved", {
        complaintIds,
      });
    }
    if (to === "done") {
      await notifyTenantProgress(task as NoticeTask, "done");
    }
  }

  return respondWithTask(updated._id);
}
