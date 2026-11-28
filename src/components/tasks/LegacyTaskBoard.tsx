"use client";

import { KanbanSquare, List } from "lucide-react";
import { DndTaskBoard, NoDrag } from "@/components/tasks/DndTaskBoard";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskPriority, TaskStatus } from "@/data/dashboard";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface LegacyBoardTask {
  _id: string;
  title: string;
  status: string;
  priority: string;
  property?: string;
  dueDate?: string;
  assignedTo?: string;
  assignedToName?: string;
}

const COLUMNS: { id: TaskStatus; title: string }[] = [
  { id: "open", title: "Open" },
  { id: "in-progress", title: "In progress" },
  { id: "done", title: "Done" },
];

const LABELS: Record<TaskStatus, string> = {
  open: "Open",
  "in-progress": "In progress",
  done: "Done",
};

/**
 * The moves the existing task buttons already offer (Start, Mark done,
 * Reopen): open ↔ in progress, either → done, done → open. Done never goes
 * straight back to in progress.
 */
export function legacyMoves(from: string): TaskStatus[] {
  if (from === "open") return ["in-progress", "done"];
  if (from === "in-progress") return ["open", "done"];
  if (from === "done") return ["open"];
  return [];
}

const priorityClass: Record<TaskPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
};

interface LegacyTaskBoardProps {
  tasks: LegacyBoardTask[];
  resolveAssignee: (task: LegacyBoardTask) => string;
  onMove: (task: LegacyBoardTask, to: TaskStatus) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Board view for the current (v1) task pages: drag a card to another column
 * (mouse, touch press-and-hold, or keyboard), or use its "Move to…" menu.
 */
export function LegacyTaskBoard({
  tasks,
  resolveAssignee,
  onMove,
  disabled,
}: LegacyTaskBoardProps) {
  const move = (task: LegacyBoardTask, to: TaskStatus) => {
    if (disabled || !legacyMoves(task.status).includes(to)) return;
    void onMove(task, to);
  };

  return (
    <DndTaskBoard
      columns={COLUMNS}
      items={tasks}
      getId={(t) => t._id}
      getTitle={(t) => t.title}
      columnOf={(t) => t.status}
      canDrop={(t, column) => legacyMoves(t.status).includes(column as TaskStatus)}
      onDrop={(t, column) => move(t, column as TaskStatus)}
      disabled={disabled}
      renderCard={(t) => {
        const moves = legacyMoves(t.status);
        return (
          <>
            <p className="line-clamp-2 break-words font-medium">{t.title}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{t.property || "—"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn("capitalize", priorityClass[t.priority as TaskPriority])}
              >
                {t.priority}
              </Badge>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{resolveAssignee(t) || "Unassigned"}</span>
              <span className="shrink-0">{t.dueDate ? formatDate(t.dueDate) : ""}</span>
            </div>
            {moves.length > 0 && (
              <NoDrag blockPointer className="mt-2">
                <Select
                  value=""
                  disabled={disabled}
                  onValueChange={(to) => move(t, to as TaskStatus)}
                >
                  <SelectTrigger
                    className="h-8 w-[130px] rounded-full text-xs"
                    aria-label={`Move ${t.title}`}
                  >
                    <SelectValue placeholder="Move to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {moves.map((s) => (
                      <SelectItem key={s} value={s}>
                        {LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </NoDrag>
            )}
          </>
        );
      }}
    />
  );
}

export type TaskView = "list" | "board";

/** List / Board switch (same look as the Tasks & Maintenance v2 toggle). */
export function TaskViewToggle({
  view,
  onChange,
}: {
  view: TaskView;
  onChange: (view: TaskView) => void;
}) {
  return (
    <fieldset className="inline-flex shrink-0 rounded-full border border-border p-0.5">
      <legend className="sr-only">View</legend>
      {(["list", "board"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
            view === v
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v === "list" ? (
            <List className="h-3.5 w-3.5" />
          ) : (
            <KanbanSquare className="h-3.5 w-3.5" />
          )}
          {v === "list" ? "List" : "Board"}
        </button>
      ))}
    </fieldset>
  );
}
