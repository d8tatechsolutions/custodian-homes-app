import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { formatKES } from "@/lib/format";
import { actorCanAccessTask } from "@/lib/maintenance/access";
import { queueTaskNotice, recordTaskActivity } from "@/lib/maintenance/activity";
import { resumeStatusAfterApproval } from "@/lib/maintenance/costs";
import {
  guardMutation,
  respondWithTask,
  type TaskDoc,
  tasksV2Disabled,
} from "@/lib/maintenance/route-helpers";
import { connectToDatabase } from "@/lib/mongoose";
import { approvalInput } from "@/lib/schemas/maintenance";
import { Task } from "@/models/Task";
import { User } from "@/models/User";

/**
 * Like `loadScopedTask`, but the recorded approver may always open the task:
 * an owner with an account can approve without otherwise managing it.
 */
async function loadApprovalTask(request: NextRequest, id: string) {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "task:read-own");
  if (actor instanceof NextResponse) return actor;
  const task = (await Task.findById(id).lean()) as TaskDoc | null;
  const isApprover = task?.cost?.approval?.approverUserId === actor.userId;
  if (!task || (!isApprover && !actorCanAccessTask(actor, task))) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  const user = (await User.findById(actor.userId).select("name").lean()) as {
    name?: string;
  } | null;
  return { task, actor, actorName: user?.name ?? "" };
}

/**
 * The approver fixed when the quote was recorded approves or rejects it. Only
 * that person may decide (system-admin may act for support). The task returns
 * to the status it had before; an approved vendor job can now be sent.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadApprovalTask(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = approvalInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid decision", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const approval = task.cost?.approval;
  if (approval?.status !== "pending" || task.status !== "waiting-approval") {
    return NextResponse.json(
      { error: "Nothing is waiting for approval on this task" },
      { status: 409 },
    );
  }
  if (approval.approverUserId !== actor.userId && actor.role !== "system-admin") {
    return NextResponse.json(
      { error: "Only the property's approver can decide on this cost" },
      { status: 403 },
    );
  }
  if (parsed.data.decision === "reject" && !parsed.data.note) {
    return NextResponse.json({ error: "Add a short reason when rejecting" }, { status: 400 });
  }

  const approved = parsed.data.decision === "approve";
  const nextStatus = resumeStatusAfterApproval(approval.resumeStatus);
  const result = await Task.updateOne(
    { _id: task._id, status: "waiting-approval", "cost.approval.status": "pending" },
    {
      $set: {
        status: nextStatus,
        "cost.approval.status": approved ? "approved" : "rejected",
        "cost.approval.decidedBy": actor.userId,
        "cost.approval.decidedAt": new Date(),
        "cost.approval.note": parsed.data.note,
      },
    },
  );
  if (result.modifiedCount === 0) {
    return NextResponse.json({ error: "This cost was already decided" }, { status: 409 });
  }

  const who = { userId: actor.userId, role: actor.role, name: actorName };
  const amount = task.cost?.quote?.amount ?? 0;
  await recordTaskActivity(
    task,
    who,
    "approval",
    `${approved ? "Approved" : "Rejected"} the ${formatKES(amount)} quote${parsed.data.note ? `: ${parsed.data.note}` : ""}`,
    { decision: parsed.data.decision, amount },
  );
  await queueTaskNotice(
    task,
    who,
    approved ? "Staff: cost approved — work can start" : "Staff: cost rejected — get a new quote",
    [task.cost?.quote?.by ?? ""].filter(Boolean),
  );
  if (approved && task.assignee?.kind === "vendor") {
    await queueTaskNotice(task, who, "Vendor: job details", [], {
      vendorId: task.assignee.vendorId,
    });
  }
  return respondWithTask(task._id);
}
