import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { formatKES } from "@/lib/format";
import { queueTaskNotice, recordTaskActivity } from "@/lib/maintenance/activity";
import { quoteNeedsApproval, resolveCostApprover } from "@/lib/maintenance/approver";
import { emptyCost } from "@/lib/maintenance/costs";
import { guardMutation, loadScopedTask, respondWithTask } from "@/lib/maintenance/route-helpers";
import { isActiveStatus } from "@/lib/maintenance/status";
import { quoteInput } from "@/lib/schemas/maintenance";
import { Property } from "@/models/Property";
import { PropertyOperations } from "@/models/PropertyOperations";
import { Task } from "@/models/Task";

/**
 * Records the quote for a task. Above the property's approval threshold (or
 * for every quote while no threshold is set) the task moves to "Waiting for
 * approval" and the approver is fixed now; otherwise work can proceed and an
 * assigned vendor can be told about the job.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:manage");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = quoteInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid quote", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (!isActiveStatus(task.status)) {
    return NextResponse.json({ error: "Reopen the task before adding a quote" }, { status: 409 });
  }
  if (task.cost?.approval?.status === "pending") {
    return NextResponse.json({ error: "A quote is already waiting for approval" }, { status: 409 });
  }

  const [operations, property] = await Promise.all([
    PropertyOperations.findOne({ propertyId: task.propertyId })
      .select("approvalThreshold")
      .lean() as Promise<{
      approvalThreshold?: number | null;
    } | null>,
    Property.findById(task.propertyId).select("ownerId").lean() as Promise<{
      ownerId?: string;
    } | null>,
  ]);
  const needsApproval = quoteNeedsApproval(
    parsed.data.amount,
    operations?.approvalThreshold ?? null,
  );
  const quote = {
    amount: parsed.data.amount,
    note: parsed.data.note,
    by: actor.userId,
    at: new Date(),
  };

  let approverUserId = "";
  if (needsApproval) {
    const approver = await resolveCostApprover(
      task.propertyId,
      String(property?.ownerId ?? task.ownerId),
    );
    if (!approver) {
      return NextResponse.json(
        { error: "This property has no one who can approve costs" },
        { status: 409 },
      );
    }
    approverUserId = approver.userId;
  }

  const approval = {
    status: needsApproval ? ("pending" as const) : ("not_required" as const),
    approverUserId,
    decidedBy: "",
    decidedAt: null,
    note: "",
    resumeStatus: needsApproval ? task.status : "",
  };
  const set: Record<string, unknown> = task.cost
    ? { "cost.quote": quote, "cost.approval": approval }
    : { cost: { ...emptyCost(), quote, approval } };
  if (needsApproval) set.status = "waiting-approval";

  const updated = await Task.updateOne({ _id: task._id, status: task.status }, { $set: set });
  if (updated.modifiedCount === 0) {
    return NextResponse.json(
      { error: "The task changed meanwhile; refresh and try again" },
      { status: 409 },
    );
  }

  const who = { userId: actor.userId, role: actor.role, name: actorName };
  await recordTaskActivity(
    task,
    who,
    "quote",
    `Quote ${formatKES(parsed.data.amount)}${needsApproval ? " — sent for approval" : " — no approval needed"}`,
    { amount: parsed.data.amount, needsApproval },
  );
  if (needsApproval) {
    await queueTaskNotice(
      task,
      who,
      "Approver: a cost is waiting for your approval",
      [approverUserId],
      {
        amount: parsed.data.amount,
      },
    );
  } else if (task.assignee?.kind === "vendor") {
    await queueTaskNotice(task, who, "Vendor: job details", [], {
      vendorId: task.assignee.vendorId,
    });
  }
  return respondWithTask(task._id);
}
