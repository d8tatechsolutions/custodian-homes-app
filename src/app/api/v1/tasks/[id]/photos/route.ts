import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { DashboardActor } from "@/app/api/v1/_helpers";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { MAX_TASK_PHOTOS_PER_SIDE } from "@/lib/maintenance/enums";
import {
  guardMutation,
  loadScopedTask,
  respondWithTask,
  type TaskDoc,
} from "@/lib/maintenance/route-helpers";
import { photoInput } from "@/lib/schemas/maintenance";
import { Task } from "@/models/Task";

/** Staff above the doer (admin, custodian, system-admin) may manage any task photo. */
function isSupervisor(actor: DashboardActor): boolean {
  return actor.role === "admin" || actor.role === "custodian" || actor.role === "system-admin";
}

/**
 * "Before" photos are added by whoever created the task; "after" photos by the
 * person assigned (client decisions Q9/Q10). Supervisors can manage both, so
 * vendor jobs and system-created tasks still get photos.
 */
function mayEdit(side: "before" | "after", actor: DashboardActor, task: TaskDoc): boolean {
  if (isSupervisor(actor)) return true;
  if (side === "before") return task.createdBy === actor.userId;
  return task.assignee?.kind === "staff" && task.assignee.userId === actor.userId;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:manage");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = photoInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid photo request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { side } = parsed.data;
  if (!mayEdit(side, actor, task)) {
    return NextResponse.json(
      {
        error:
          side === "before"
            ? "Only the person who created the task can add before photos"
            : "Only the person assigned can add after photos",
      },
      { status: 403 },
    );
  }
  const field = side === "before" ? "photosBefore" : "photosAfter";
  const who = { userId: actor.userId, role: actor.role, name: actorName };

  if (parsed.data.action === "add") {
    // Atomic limit: only push while the array has fewer than the maximum.
    const result = await Task.updateOne(
      { _id: task._id, [`${field}.${MAX_TASK_PHOTOS_PER_SIDE - 1}`]: { $exists: false } },
      {
        $push: {
          [field]: {
            ...parsed.data.media,
            kind: "image",
            uploadedBy: actor.userId,
            uploadedAt: new Date(),
          },
        },
      },
    );
    if (result.modifiedCount === 0) {
      return NextResponse.json(
        { error: `A task can have at most ${MAX_TASK_PHOTOS_PER_SIDE} ${side} photos` },
        { status: 409 },
      );
    }
    await recordTaskActivity(task, who, "photo", `Added a ${side} photo`, { side });
  } else {
    const result = await Task.updateOne(
      { _id: task._id },
      { $pull: { [field]: { _id: parsed.data.mediaId } } },
    );
    if (result.modifiedCount === 0) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }
    await recordTaskActivity(task, who, "photo", `Removed a ${side} photo`, { side });
  }
  return respondWithTask(task._id);
}
