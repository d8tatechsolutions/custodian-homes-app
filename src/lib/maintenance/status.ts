import type { StatusTone } from "@/components/common/StatusBadge";
import { ACTIVE_TASK_STATUSES, type TaskStatusV2 } from "@/lib/maintenance/enums";

/**
 * Allowed manual status moves. `waiting-approval` is entered and left by the
 * quote/approval flow only (see `costs.ts`), never picked by hand, and `done`
 * is unreachable while a cost still awaits approval.
 */
const MANUAL_TRANSITIONS: Record<TaskStatusV2, readonly TaskStatusV2[]> = {
  open: ["in-progress", "waiting-parts", "waiting-vendor", "done", "cancelled"],
  "in-progress": ["open", "waiting-parts", "waiting-vendor", "done", "cancelled"],
  "waiting-approval": ["cancelled"],
  "waiting-parts": ["open", "in-progress", "waiting-vendor", "done", "cancelled"],
  "waiting-vendor": ["open", "in-progress", "waiting-parts", "done", "cancelled"],
  done: ["open"],
  cancelled: ["open"],
};

export function allowedNextStatuses(current: TaskStatusV2): readonly TaskStatusV2[] {
  return MANUAL_TRANSITIONS[current] ?? [];
}

export function canTransition(from: TaskStatusV2, to: TaskStatusV2): boolean {
  return allowedNextStatuses(from).includes(to);
}

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);
}

/** Overdue is derived: still active and the due day has passed (Nairobi calendar). */
export function isTaskOverdue(task: { status: string; dueDate?: string }, today: string): boolean {
  if (!isActiveStatus(task.status) || !task.dueDate) return false;
  return task.dueDate.slice(0, 10) < today;
}

export const TASK_STATUS_TONES: Record<TaskStatusV2, StatusTone> = {
  open: "warning",
  "in-progress": "info",
  "waiting-approval": "warning",
  "waiting-parts": "neutral",
  "waiting-vendor": "neutral",
  done: "success",
  cancelled: "muted",
};

export const TASK_PRIORITY_TONES: Record<"low" | "medium" | "high", StatusTone> = {
  low: "muted",
  medium: "warning",
  high: "danger",
};
