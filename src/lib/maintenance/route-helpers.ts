import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  type DashboardActor,
  propertyTitleMap,
  resolveDashboardActor,
} from "@/app/api/v1/_helpers";
import type { Action } from "@/lib/authorization";
import { isTasksV2Enabled } from "@/lib/feature-flags";
import { actorCanAccessTask } from "@/lib/maintenance/access";
import { nairobiToday } from "@/lib/maintenance/dates";
import { isTaskOverdue } from "@/lib/maintenance/status";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { type ITask, Task } from "@/models/Task";
import { User } from "@/models/User";

export type TaskDoc = ITask & { _id: unknown; createdAt?: Date; updatedAt?: Date };

/** 404 for every v2-only route while the release flag is off. */
export function tasksV2Disabled(): NextResponse | null {
  return isTasksV2Enabled() ? null : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Rate limit + same-origin guard shared by every mutating v2 route. */
export async function guardMutation(request: NextRequest): Promise<NextResponse | null> {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 30 });
  if (limit instanceof NextResponse) return limit;
  return checkSameOrigin(request);
}

/**
 * Loads a task the caller may act on: flag on, valid id, permission, scope.
 * Returns a ready-made error response otherwise.
 */
export async function loadScopedTask(
  request: NextRequest,
  id: string,
  action: Action,
): Promise<{ task: TaskDoc; actor: DashboardActor; actorName: string } | NextResponse> {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }
  const authError = await requirePermission(request, action);
  if (authError) return authError;

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, action);
  if (actor instanceof NextResponse) return actor;

  const task = (await Task.findById(id).lean()) as TaskDoc | null;
  if (!task || !actorCanAccessTask(actor, task)) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  const user = (await User.findById(actor.userId).select("name").lean()) as {
    name?: string;
  } | null;
  return { task, actor, actorName: user?.name ?? "" };
}

/** Serialized task for the v2 UI: property title and derived overdue flag. */
export function serializeTaskV2(task: TaskDoc, titles: Map<string, string>, now = new Date()) {
  return {
    ...task,
    _id: String(task._id),
    property: titles.get(task.propertyId) ?? "",
    overdue: isTaskOverdue(task, nairobiToday(now)),
  };
}

export async function respondWithTask(taskId: unknown, status = 200): Promise<NextResponse> {
  const fresh = (await Task.findById(taskId).lean()) as TaskDoc | null;
  if (!fresh) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const titles = await propertyTitleMap([fresh.propertyId]);
  return NextResponse.json({ data: serializeTaskV2(fresh, titles) }, { status });
}
