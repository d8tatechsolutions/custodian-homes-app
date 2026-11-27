"use client";

import { MessageSquareWarning, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { type DataColumn, DataTable } from "@/components/common/DataTable";
import { StatusBadge, type StatusTone } from "@/components/common/StatusBadge";
import { TitleCell } from "@/components/common/TitleCell";
import type { TaskFormPrefill } from "@/components/tasks/TaskFormSheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useComplaints } from "@/hooks/use-complaints";
import { formatDate } from "@/lib/format";
import type { Complaint } from "@/types/communications";

type ComplaintRow = Complaint & {
  taskIds?: string[];
  tenantConfirmation?: { status?: "none" | "fixed" | "not_fixed" };
};

const STATUS_TONE: Record<string, StatusTone> = {
  open: "warning",
  "in-progress": "info",
  resolved: "success",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  "in-progress": "In progress",
  resolved: "Resolved",
};

interface ComplaintsPanelProps {
  basePath: string;
  onCreateTask: (prefill: TaskFormPrefill) => void;
}

/**
 * Staff inbox of tenant complaints (staff previously only saw them as
 * notifications). Each row shows its linked tasks; "Create task" opens the
 * task form prefilled and linked.
 */
export function ComplaintsPanel({ basePath, onCreateTask }: ComplaintsPanelProps) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const { items, loading, error } = useComplaints();
  const rows = useMemo(
    () => (items as ComplaintRow[]).filter((c) => filter === "all" || c.status !== "resolved"),
    [items, filter],
  );

  const columns: DataColumn<ComplaintRow>[] = [
    {
      key: "subject",
      header: "Complaint",
      sortValue: (c) => c.subject.toLowerCase(),
      cell: (c) => (
        <TitleCell
          detail={{
            title: c.subject,
            subtitle: [c.property, c.unitName].filter(Boolean).join(" · "),
            fields: [
              { label: "Category", value: c.category },
              { label: "Priority", value: c.priority },
              { label: "Status", value: STATUS_LABEL[c.status] ?? c.status },
              { label: "Reported", value: c.createdAt ? formatDate(c.createdAt) : "" },
              { label: "Message", value: <span className="whitespace-pre-wrap">{c.message}</span> },
              { label: "Resolution", value: c.resolution ?? "" },
            ],
          }}
        >
          {c.subject}
        </TitleCell>
      ),
    },
    {
      key: "where",
      header: "Where",
      sortValue: (c) => `${c.property} ${c.unitName}`,
      cell: (c) => (
        <span className="text-muted-foreground">
          {c.property}
          {c.unitName ? ` · ${c.unitName}` : ""}
        </span>
      ),
    },
    {
      key: "reported",
      header: "Reported",
      sortValue: (c) => c.createdAt ?? "",
      cell: (c) => (c.createdAt ? formatDate(c.createdAt) : "—"),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (c) => c.status,
      cell: (c) => (
        <span className="inline-flex flex-wrap gap-1.5">
          <StatusBadge tone={STATUS_TONE[c.status] ?? "neutral"}>
            {STATUS_LABEL[c.status] ?? c.status}
          </StatusBadge>
          {c.tenantConfirmation?.status === "not_fixed" ? (
            <StatusBadge tone="danger">Tenant: not fixed</StatusBadge>
          ) : null}
          {c.tenantConfirmation?.status === "fixed" ? (
            <StatusBadge tone="success">Tenant: fixed</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      key: "tasks",
      header: "Tasks",
      cell: (c) =>
        (c.taskIds ?? []).length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {(c.taskIds ?? []).map((id, i) => (
              <Link
                key={id}
                href={`${basePath}/${id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Task {i + 1}
              </Link>
            ))}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as "open" | "all")}>
        <TabsList>
          <TabsTrigger value="open">Needs attention</TabsTrigger>
          <TabsTrigger value="all">All complaints</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(c) => c._id}
        loading={loading}
        error={error}
        caption="Tenant complaints"
        emptyTitle={filter === "open" ? "No open complaints" : "No complaints yet"}
        emptyDescription="Tenant complaints appear here, each with the task raised for it."
        rowActions={(c) =>
          c.status !== "resolved" ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() =>
                onCreateTask({
                  title: c.subject,
                  notes: c.message,
                  propertyId: c.propertyId,
                  priority: c.priority,
                  unitId: c.unitId || undefined,
                  complaintIds: [c._id],
                })
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {(c.taskIds ?? []).length > 0 ? "Another task" : "Create task"}
            </Button>
          ) : null
        }
      />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MessageSquareWarning className="h-3.5 w-3.5" />
        New complaints get a task automatically, assigned to the caretaker of that unit, block or
        property.
      </p>
    </div>
  );
}
