import type { TaskActivityKind } from "@/lib/maintenance/enums";
import { TaskActivity } from "@/models/TaskActivity";

export interface ActivityActor {
  userId: string;
  role: string;
  name?: string;
}

/**
 * Appends one history entry. History must never break the action it records,
 * so failures are logged and swallowed.
 */
export async function recordTaskActivity(
  task: { _id: unknown; ownerId: string },
  actor: ActivityActor,
  kind: TaskActivityKind,
  message: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    await TaskActivity.create({
      taskId: String(task._id),
      ownerId: task.ownerId,
      actorId: actor.userId,
      actorRole: actor.role,
      actorName: actor.name ?? "",
      kind,
      message: message.slice(0, 2000),
      data,
    });
  } catch (error) {
    console.error(
      "[maintenance] activity not recorded:",
      error instanceof Error ? error.message : error,
    );
  }
}
