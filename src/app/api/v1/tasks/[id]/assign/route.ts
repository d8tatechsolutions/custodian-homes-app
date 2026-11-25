import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { queueTaskNotice, recordTaskActivity } from "@/lib/maintenance/activity";
import { resolveAssignee } from "@/lib/maintenance/assignee";
import { guardMutation, loadScopedTask, respondWithTask } from "@/lib/maintenance/route-helpers";
import { assignInput } from "@/lib/schemas/maintenance";
import { Task } from "@/models/Task";

/**
 * (Re)assigns a task to a staff member or vendor, or clears the assignee.
 * A vendor is only told about the job once its cost is approved (or when no
 * approval is needed), so assigning a vendor queues no notice by itself.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:manage");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = assignInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid assignee", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (task.status === "done" || task.status === "cancelled") {
    return NextResponse.json({ error: "Reopen the task before reassigning it" }, { status: 409 });
  }

  const resolved = await resolveAssignee(
    actor,
    parsed.data.assignee,
    task.propertyId,
    task.ownerId,
  );
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  await Task.updateOne(
    { _id: task._id },
    {
      $set: {
        assignee: resolved.assignee,
        assignedTo: resolved.assignedTo,
        assignedToName: resolved.assignedToName,
      },
    },
  );

  const who = { userId: actor.userId, role: actor.role, name: actorName };
  await recordTaskActivity(
    task,
    who,
    "assign",
    resolved.assignee ? `Assigned to ${resolved.assignedToName || "someone"}` : "Unassigned",
    { assignee: resolved.assignee },
  );
  if (resolved.assignee?.kind === "staff" && resolved.assignedTo !== actor.userId) {
    await queueTaskNotice(task, who, "Assignee: you have a new task", [resolved.assignedTo]);
  }
  if (resolved.assignee?.kind === "vendor") {
    const approval = task.cost?.approval?.status;
    if (task.cost?.quote && (approval === "approved" || approval === "not_required")) {
      // Cost cleared: the vendor can be told now (Phase 5 sends the email).
      await queueTaskNotice(task, who, "Vendor: job details", [], {
        vendorId: resolved.assignee.vendorId,
      });
    }
  }
  return respondWithTask(task._id);
}
