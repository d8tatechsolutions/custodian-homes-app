"use client";

import {
  AlarmClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Hourglass,
  KanbanSquare,
  List,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type DataColumn, DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { TitleCell } from "@/components/common/TitleCell";
import { SearchInput } from "@/components/SearchInput";
import { StatCard } from "@/components/StatCard";
import { DndTaskBoard, NoDrag } from "@/components/tasks/DndTaskBoard";
import { StatusChangeDialog } from "@/components/tasks/StatusChangeDialog";
import { OverdueBadge, TaskPriorityBadge, TaskStatusBadge } from "@/components/tasks/TaskBadges";
import { type TaskFormPrefill, TaskFormSheet } from "@/components/tasks/TaskFormSheet";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMaintenanceTasks, useTaskCategories } from "@/hooks/use-maintenance";
import { useProperties } from "@/hooks/use-properties";
import { formatDate } from "@/lib/format";
import {
  ACTIVE_TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskStatusV2,
} from "@/lib/maintenance/enums";
import { allowedNextStatuses } from "@/lib/maintenance/status";
import { matchesQuery } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { MaintenanceTask } from "@/types/maintenance";

type StatusFilter = "active" | "all" | TaskStatusV2;
type View = "list" | "board";

const BOARD_COLUMNS: { key: string; title: string; statuses: TaskStatusV2[] }[] = [
  { key: "open", title: "Open", statuses: ["open"] },
  { key: "in-progress", title: "In progress", statuses: ["in-progress"] },
  {
    key: "waiting",
    title: "Waiting",
    statuses: ["waiting-approval", "waiting-parts", "waiting-vendor"],
  },
  { key: "done", title: "Done", statuses: ["done"] },
];

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

interface TaskListViewProps {
  viewerRole: "admin" | "custodian" | "caretaker" | "system-admin";
  currentUserId: string;
  /** e.g. `/dashboard/admin/tasks` — detail pages live under it. */
  basePath: string;
  /** Lets the Complaints tab open the form prefilled. */
  prefill?: TaskFormPrefill | null;
  onPrefillConsumed?: () => void;
}

export function TaskListView({
  viewerRole: role,
  currentUserId,
  basePath,
  prefill,
  onPrefillConsumed,
}: TaskListViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [propertyId, setPropertyId] = useState("all");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("list");
  const [formOpen, setFormOpen] = useState(false);
  const [moving, setMoving] = useState<{ task: MaintenanceTask; to: TaskStatusV2 } | null>(null);

  const { tasks, loading, error, refetch, setTasks } = useMaintenanceTasks();
  const { properties } = useProperties();
  const { categories } = useTaskCategories();

  // Open the form when another tab hands over a prefill.
  const activePrefill = prefill ?? undefined;
  useEffect(() => {
    if (prefill) setFormOpen(true);
  }, [prefill]);

  const counts = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    return {
      open: tasks.filter((t) => t.status === "open").length,
      inProgress: tasks.filter((t) => t.status === "in-progress").length,
      waiting: tasks.filter((t) => t.status.startsWith("waiting")).length,
      overdue: tasks.filter((t) => t.overdue).length,
      doneThisMonth: tasks.filter(
        (t) => t.status === "done" && (t.completedAt ?? "").startsWith(thisMonth),
      ).length,
    };
  }, [tasks]);

  const visible = useMemo(() => {
    return tasks
      .filter((t) => {
        if (statusFilter === "active" && !ACTIVE_TASK_STATUSES.includes(t.status)) return false;
        if (statusFilter !== "active" && statusFilter !== "all" && t.status !== statusFilter)
          return false;
        if (propertyId !== "all" && t.propertyId !== propertyId) return false;
        if (priority !== "all" && t.priority !== priority) return false;
        if (category !== "all" && (t.category ?? "") !== category) return false;
        return matchesQuery(
          query,
          t.title,
          t.property,
          t.assignedToName,
          t.location?.label,
          t.category,
        );
      })
      .sort(
        (a, b) =>
          Number(b.overdue) - Number(a.overdue) ||
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          (a.dueDate || "").localeCompare(b.dueDate || ""),
      );
  }, [tasks, statusFilter, propertyId, priority, category, query]);

  const replaceTask = (updated: MaintenanceTask) =>
    setTasks((prev) => prev.map((t) => (t._id === updated._id ? updated : t)));

  const columns: DataColumn<MaintenanceTask>[] = [
    {
      key: "title",
      header: "Task",
      sortValue: (t) => t.title.toLowerCase(),
      cell: (t) => (
        <div className="min-w-0">
          <TitleCell href={`${basePath}/${t._id}`}>{t.title}</TitleCell>
          <p className="truncate text-xs text-muted-foreground">
            {[t.location?.label, t.category].filter(Boolean).join(" · ") || "Whole property"}
          </p>
        </div>
      ),
    },
    {
      key: "property",
      header: "Property",
      sortValue: (t) => t.property,
      cell: (t) => t.property || "—",
    },
    {
      key: "assignee",
      header: "Assigned to",
      sortValue: (t) => t.assignedToName ?? "",
      cell: (t) =>
        t.assignedToName ? (
          <span>
            {t.assignedToName}
            {t.assignee?.kind === "vendor" ? (
              <span className="text-xs text-muted-foreground"> · service provider</span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        ),
    },
    {
      key: "due",
      header: "Due",
      sortValue: (t) => t.dueDate,
      cell: (t) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {t.dueDate ? formatDate(t.dueDate) : "—"}
          {t.overdue ? <OverdueBadge /> : null}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      sortValue: (t) => PRIORITY_RANK[t.priority],
      cell: (t) => <TaskPriorityBadge priority={t.priority} />,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (t) => t.status,
      cell: (t) => <TaskStatusBadge status={t.status} />,
    },
  ];

  const movesFor = (t: MaintenanceTask): readonly TaskStatusV2[] =>
    t.status === "cancelled" && role !== "admin" && role !== "system-admin"
      ? []
      : allowedNextStatuses(t.status);

  /** The status a card dropped on a column moves to (first allowed one), if any. */
  const dropStatus = (t: MaintenanceTask, statuses: TaskStatusV2[]): TaskStatusV2 | null =>
    statuses.find((s) => movesFor(t).includes(s)) ?? null;

  const moveMenu = (t: MaintenanceTask) => {
    const options = movesFor(t);
    if (options.length === 0) return null;
    return (
      <Select value="" onValueChange={(to) => setMoving({ task: t, to: to as TaskStatusV2 })}>
        <SelectTrigger
          className="h-8 w-[130px] rounded-full text-xs"
          aria-label={`Move ${t.title}`}
        >
          <SelectValue placeholder="Move to…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Open" value={counts.open} icon={ClipboardList} />
        <StatCard label="In progress" value={counts.inProgress} icon={Clock} />
        <StatCard label="Waiting" value={counts.waiting} icon={Hourglass} />
        <StatCard label="Overdue" value={counts.overdue} icon={AlarmClock} />
        <StatCard label="Done this month" value={counts.doneThisMonth} icon={CheckCircle2} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search tasks, places, people"
            />
          </div>
          <div className="flex items-center gap-2">
            <fieldset className="inline-flex rounded-full border border-border p-0.5">
              <legend className="sr-only">View</legend>
              {(["list", "board"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
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
            <Button className="rounded-full" onClick={() => setFormOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New task
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">All open work</SelectItem>
              <SelectItem value="all">Everything</SelectItem>
              {(Object.keys(TASK_STATUS_LABELS) as TaskStatusV2[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger aria-label="Property filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {properties.map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger aria-label="Priority filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any priority</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Category filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any category</SelectItem>
              {categories.map((c) => (
                <SelectItem key={`${c.builtIn}-${c.name}`} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {view === "list" ? (
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(t) => t._id}
          loading={loading}
          error={error}
          emptyTitle={tasks.length === 0 ? "No tasks yet" : "No tasks match these filters"}
          emptyDescription={
            tasks.length === 0
              ? "Create a task, or they will appear here as tenants report issues."
              : undefined
          }
          caption="Tasks"
          rowActions={(t) => moveMenu(t)}
        />
      ) : loading ? null : visible.length === 0 ? (
        <EmptyState title="No tasks match these filters" />
      ) : (
        <DndTaskBoard
          columns={BOARD_COLUMNS.map((c) => ({ id: c.key, title: c.title }))}
          items={visible.filter((t) => BOARD_COLUMNS.some((c) => c.statuses.includes(t.status)))}
          getId={(t) => t._id}
          getTitle={(t) => t.title}
          columnOf={(t) => BOARD_COLUMNS.find((c) => c.statuses.includes(t.status))?.key ?? ""}
          canDrop={(t, key) => {
            const column = BOARD_COLUMNS.find((c) => c.key === key);
            return Boolean(column && dropStatus(t, column.statuses));
          }}
          onDrop={(t, key) => {
            const column = BOARD_COLUMNS.find((c) => c.key === key);
            const to = column ? dropStatus(t, column.statuses) : null;
            if (to) setMoving({ task: t, to });
          }}
          gridClassName="lg:grid-cols-4"
          renderCard={(t) => (
            <>
              <NoDrag>
                <Link
                  href={`${basePath}/${t._id}`}
                  className="line-clamp-2 font-medium hover:text-primary hover:underline"
                >
                  {t.title}
                </Link>
              </NoDrag>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {t.property}
                {t.location?.label ? ` · ${t.location.label}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <TaskPriorityBadge priority={t.priority} />
                {t.status.startsWith("waiting") ? <TaskStatusBadge status={t.status} /> : null}
                {t.overdue ? <OverdueBadge /> : null}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{t.assignedToName || "Unassigned"}</span>
                <span>{t.dueDate ? formatDate(t.dueDate) : ""}</span>
              </div>
              <NoDrag blockPointer className="mt-2">
                {moveMenu(t)}
              </NoDrag>
            </>
          )}
        />
      )}

      <TaskFormSheet
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) onPrefillConsumed?.();
        }}
        viewerRole={role}
        currentUserId={currentUserId}
        prefill={activePrefill}
        onCreated={(task) => {
          setTasks((prev) => [task, ...prev]);
          refetch();
        }}
      />
      <StatusChangeDialog
        task={moving?.task ?? null}
        to={moving?.to ?? null}
        onClose={() => setMoving(null)}
        onChanged={replaceTask}
      />
    </div>
  );
}
