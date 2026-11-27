import { AlarmClock } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { TASK_STATUS_LABELS, type TaskStatusV2 } from "@/lib/maintenance/enums";
import { TASK_PRIORITY_TONES, TASK_STATUS_TONES } from "@/lib/maintenance/status";
import type { TaskPriority } from "@/types/maintenance";

export function TaskStatusBadge({ status }: { status: TaskStatusV2 }) {
  return (
    <StatusBadge tone={TASK_STATUS_TONES[status] ?? "neutral"} dot>
      {TASK_STATUS_LABELS[status] ?? status}
    </StatusBadge>
  );
}

const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Low", medium: "Medium", high: "High" };

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  return <StatusBadge tone={TASK_PRIORITY_TONES[priority]}>{PRIORITY_LABEL[priority]}</StatusBadge>;
}

export function OverdueBadge() {
  return (
    <StatusBadge tone="danger">
      <AlarmClock className="h-3 w-3" aria-hidden="true" />
      Overdue
    </StatusBadge>
  );
}
