"use client";

import {
  ArrowLeft,
  CalendarClock,
  Link2,
  Loader2,
  MessageSquare,
  Phone,
  Repeat,
  Trash2,
  Unlink,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Timeline } from "@/components/common/Timeline";
import {
  type AssigneeChoice,
  AssigneeSelect,
  encodeAssignee,
} from "@/components/tasks/AssigneeSelect";
import { CostCard } from "@/components/tasks/CostCard";
import { EditTaskDialog } from "@/components/tasks/EditTaskDialog";
import { PhotoUploader } from "@/components/tasks/PhotoUploader";
import { StatusChangeDialog } from "@/components/tasks/StatusChangeDialog";
import { OverdueBadge, TaskPriorityBadge, TaskStatusBadge } from "@/components/tasks/TaskBadges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useComplaints } from "@/hooks/use-complaints";
import {
  taskActions,
  useAssignees,
  useMaintenanceTask,
  useTaskActivity,
} from "@/hooks/use-maintenance";
import { formatDate } from "@/lib/format";
import {
  MAX_TASK_ATTACHMENTS,
  MAX_TASK_PHOTOS_PER_SIDE,
  TASK_STATUS_LABELS,
  type TaskStatusV2,
} from "@/lib/maintenance/enums";
import { allowedNextStatuses } from "@/lib/maintenance/status";
import { roleLabel } from "@/lib/role-labels";
import type { MaintenanceTask } from "@/types/maintenance";

interface TaskDetailViewProps {
  taskId: string;
  viewerRole: "admin" | "custodian" | "caretaker" | "system-admin";
  currentUserId: string;
  basePath: string;
  invoicesHref?: string;
}

function formatStamp(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-KE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function TaskDetailView({
  taskId,
  viewerRole: role,
  currentUserId,
  basePath,
  invoicesHref,
}: TaskDetailViewProps) {
  const router = useRouter();
  const { task, setTask, loading, error } = useMaintenanceTask(taskId);
  const { activity, refetch: refetchActivity } = useTaskActivity(taskId);
  const { assignees } = useAssignees(task?.propertyId ?? null);
  const { items: complaints } = useComplaints();
  const [moveTo, setMoveTo] = useState<TaskStatusV2 | null>(null);
  const [assignee, setAssignee] = useState<AssigneeChoice>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isSupervisor = role === "admin" || role === "custodian" || role === "system-admin";

  useEffect(() => {
    if (!task?.assignee) setAssignee(null);
    else if (task.assignee.kind === "staff")
      setAssignee({ kind: "staff", userId: task.assignee.userId ?? "" });
    else setAssignee({ kind: "vendor", vendorId: task.assignee.vendorId ?? "" });
  }, [task?.assignee]);

  const changed = (updated: MaintenanceTask) => {
    setTask(updated);
    refetchActivity();
  };

  const linked = useMemo(
    () => complaints.filter((c) => (task?.complaintIds ?? []).includes(c._id)),
    [complaints, task?.complaintIds],
  );
  const linkable = useMemo(
    () =>
      complaints.filter(
        (c) =>
          c.propertyId === task?.propertyId &&
          c.status !== "resolved" &&
          !(task?.complaintIds ?? []).includes(c._id),
      ),
    [complaints, task?.propertyId, task?.complaintIds],
  );

  if (loading && !task) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !task) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive"
      >
        {error ?? "Task not found"}{" "}
        <Link href={basePath} className="underline">
          Back to tasks
        </Link>
      </div>
    );
  }

  const canBefore = isSupervisor || task.createdBy === currentUserId;
  const canAfter =
    isSupervisor || (task.assignee?.kind === "staff" && task.assignee.userId === currentUserId);
  const closed = task.status === "done" || task.status === "cancelled";
  // Only admins may reopen a cancelled task (enforced again by the API).
  const canReopenCancelled = role === "admin" || role === "system-admin";
  const nextStatuses =
    task.status === "cancelled" && !canReopenCancelled ? [] : allowedNextStatuses(task.status);
  const vendor =
    task.assignee?.kind === "vendor"
      ? assignees.vendors.find((v) => v.id === task.assignee?.vendorId)
      : null;
  const assigneeDirty =
    encodeAssignee(assignee) !==
    encodeAssignee(
      task.assignee
        ? task.assignee.kind === "staff"
          ? { kind: "staff", userId: task.assignee.userId ?? "" }
          : { kind: "vendor", vendorId: task.assignee.vendorId ?? "" }
        : null,
    );

  const act = async (key: string, fn: () => Promise<MaintenanceTask>, success: string) => {
    setBusy(key);
    try {
      changed(await fn());
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Link
          href={basePath}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All tasks
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <h2 className="break-words font-display text-2xl font-semibold tracking-tight">
              {task.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status} />
              <TaskPriorityBadge priority={task.priority} />
              {task.overdue ? <OverdueBadge /> : null}
              {task.category ? <StatusBadge tone="neutral">{task.category}</StatusBadge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {task.property}
              {task.location?.label ? ` › ${task.location.label}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === "done" ? "default" : s === "cancelled" ? "outline" : "secondary"}
                className="rounded-full"
                onClick={() => setMoveTo(s)}
              >
                {s === "open" && closed ? "Reopen" : TASK_STATUS_LABELS[s]}
              </Button>
            ))}
            {!closed ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            ) : null}
            {role === "admin" || role === "system-admin" || role === "custodian" ? (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-destructive"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete task"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">
                {task.notes || <span className="text-muted-foreground">No details added.</span>}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Photos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <PhotoUploader
                label="Before"
                max={MAX_TASK_PHOTOS_PER_SIDE}
                disabled={!canBefore || task.status === "cancelled"}
                disabledReason={!canBefore ? "Added by whoever created the task" : undefined}
                items={(task.photosBefore ?? []).map((p) => ({
                  id: p._id,
                  url: p.url,
                  name: p.name,
                }))}
                onUploaded={async (file) =>
                  changed(
                    await taskActions.photo(task._id, {
                      action: "add",
                      side: "before",
                      media: file,
                    }),
                  )
                }
                onRemove={async (id) =>
                  changed(
                    await taskActions.photo(task._id, {
                      action: "remove",
                      side: "before",
                      mediaId: id,
                    }),
                  )
                }
              />
              <PhotoUploader
                label="After"
                max={MAX_TASK_PHOTOS_PER_SIDE}
                disabled={!canAfter || task.status === "cancelled"}
                disabledReason={!canAfter ? "Added by the person doing the work" : undefined}
                items={(task.photosAfter ?? []).map((p) => ({
                  id: p._id,
                  url: p.url,
                  name: p.name,
                }))}
                onUploaded={async (file) =>
                  changed(
                    await taskActions.photo(task._id, {
                      action: "add",
                      side: "after",
                      media: file,
                    }),
                  )
                }
                onRemove={async (id) =>
                  changed(
                    await taskActions.photo(task._id, {
                      action: "remove",
                      side: "after",
                      mediaId: id,
                    }),
                  )
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Tenant complaints</CardTitle>
              {linkable.length > 0 && !closed ? (
                <Select
                  value=""
                  onValueChange={(complaintId) =>
                    void act(
                      "link",
                      () => taskActions.linkComplaint(task._id, complaintId, "link"),
                      "Complaint linked",
                    )
                  }
                >
                  <SelectTrigger
                    className="h-8 w-auto gap-1 rounded-full text-xs"
                    aria-label="Link a complaint"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    <SelectValue placeholder="Link a complaint" />
                  </SelectTrigger>
                  <SelectContent>
                    {linkable.map((c) => (
                      <SelectItem key={c._id} value={c._id}>
                        {c.subject}
                        {c.unitName ? ` · ${c.unitName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </CardHeader>
            <CardContent>
              {linked.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not linked to any complaint.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {linked.map((c) => {
                    const confirmation = (c as { tenantConfirmation?: { status?: string } })
                      .tenantConfirmation?.status;
                    return (
                      <li key={c._id} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{c.subject}</p>
                          <p className="text-xs capitalize text-muted-foreground">
                            {c.status.replace("-", " ")}
                            {c.unitName ? ` · ${c.unitName}` : ""}
                            {confirmation === "fixed" ? " · tenant confirmed fixed" : ""}
                            {confirmation === "not_fixed" ? " · tenant says not fixed" : ""}
                          </p>
                        </div>
                        {!closed ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Unlink ${c.subject}`}
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                "unlink",
                                () => taskActions.linkComplaint(task._id, c._id, "unlink"),
                                "Complaint unlinked",
                              )
                            }
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <CostCard
            task={task}
            currentUserId={currentUserId}
            isSupervisor={isSupervisor}
            invoicesHref={invoicesHref}
            onChanged={changed}
          />

          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
            </CardHeader>
            <CardContent>
              <PhotoUploader
                label="Quotes and documents"
                accept="documents"
                max={MAX_TASK_ATTACHMENTS}
                disabled={task.status === "cancelled"}
                items={(task.attachments ?? []).map((a) => ({
                  id: a._id,
                  url: a.url,
                  name: a.name,
                  kind: a.kind,
                }))}
                onUploaded={async (file) =>
                  changed(
                    await taskActions.attachment(task._id, {
                      action: "add",
                      target: "attachments",
                      media: file,
                    }),
                  )
                }
                onRemove={async (id) =>
                  changed(
                    await taskActions.attachment(task._id, {
                      action: "remove",
                      target: "attachments",
                      mediaId: id,
                    }),
                  )
                }
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <AssigneeSelect
                propertyId={task.propertyId}
                value={assignee}
                onChange={setAssignee}
                disabled={closed || role === "caretaker"}
                label="Assigned to"
              />
              {vendor ? (
                <a
                  href={`tel:${vendor.phone}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
                >
                  <Phone className="h-4 w-4" /> Call {vendor.name}
                </a>
              ) : null}
              {assigneeDirty && !closed ? (
                <Button
                  className="w-full rounded-full"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(
                      "assign",
                      () => taskActions.assign(task._id, assignee),
                      "Assignment saved",
                    )
                  }
                >
                  {busy === "assign" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save
                  assignment
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dates</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Due</dt>
                  <dd>{task.dueDate ? formatDate(task.dueDate) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> Scheduled
                  </dt>
                  <dd>{task.scheduledFor ? formatDate(task.scheduledFor) : "—"}</dd>
                </div>
                {task.completedAt ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Completed</dt>
                    <dd>{formatDate(task.completedAt)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Created by</dt>
                  <dd className="text-right">
                    {task.createdByName || roleLabel(task.createdByRole) || "—"}
                  </dd>
                </div>
              </dl>
              {task.scheduleId ? (
                <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  <Repeat className="h-3.5 w-3.5" /> Created by a recurring schedule
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Timeline
                emptyText="No activity yet."
                items={activity
                  .filter((a) => a.kind !== "notify")
                  .map((a) => ({
                    id: a._id,
                    title:
                      a.kind === "comment"
                        ? `${a.actorName || roleLabel(a.actorRole) || "Someone"} commented`
                        : a.message,
                    meta: `${a.kind === "comment" ? "" : `${a.actorName || roleLabel(a.actorRole) || ""} · `}${formatStamp(a.createdAt)}`,
                    body:
                      a.kind === "comment" ? (
                        <p className="whitespace-pre-wrap">{a.message}</p>
                      ) : undefined,
                  }))}
              />
              <div className="space-y-2">
                <Textarea
                  rows={2}
                  maxLength={2000}
                  value={comment}
                  placeholder="Add a comment"
                  aria-label="Add a comment"
                  onChange={(e) => setComment(e.target.value)}
                />
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={!comment.trim() || busy !== null}
                  onClick={async () => {
                    setBusy("comment");
                    try {
                      await taskActions.comment(task._id, comment.trim());
                      setComment("");
                      refetchActivity();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not add the comment");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "comment" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Comment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <StatusChangeDialog
        task={moveTo ? task : null}
        to={moveTo}
        onClose={() => setMoveTo(null)}
        onChanged={changed}
      />
      <EditTaskDialog open={editing} onOpenChange={setEditing} task={task} onSaved={changed} />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the task and its photos from the list. Linked complaints stay, without
              this task.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                try {
                  await taskActions.remove(task._id);
                  toast.success("Task deleted");
                  router.push(basePath);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not delete the task");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
