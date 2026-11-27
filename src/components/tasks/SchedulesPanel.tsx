"use client";

import { Loader2, Pause, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type DataColumn, DataTable } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { type AssigneeChoice, AssigneeSelect } from "@/components/tasks/AssigneeSelect";
import {
  isLocationComplete,
  LocationPicker,
  type LocationValue,
} from "@/components/tasks/LocationPicker";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, useTaskCategories, useTaskSchedules } from "@/hooks/use-maintenance";
import { useProperties } from "@/hooks/use-properties";
import { formatDate } from "@/lib/format";
import { nairobiToday } from "@/lib/maintenance/dates";
import type { RecurrenceEndKind, RecurrenceFrequency } from "@/lib/maintenance/enums";
import { describeRecurrence } from "@/lib/maintenance/recurrence";
import type { TaskPriority, TaskScheduleRecord } from "@/types/maintenance";

/** "Every week", "Every 3 months" etc. — the usual presets plus custom "every N". */
const PRESETS: { key: string; label: string; frequency: RecurrenceFrequency; interval: number }[] =
  [
    { key: "daily", label: "Every day", frequency: "daily", interval: 1 },
    { key: "weekly", label: "Every week", frequency: "weekly", interval: 1 },
    { key: "monthly", label: "Every month", frequency: "monthly", interval: 1 },
    { key: "quarterly", label: "Every 3 months", frequency: "monthly", interval: 3 },
    { key: "half-yearly", label: "Every 6 months", frequency: "monthly", interval: 6 },
    { key: "yearly", label: "Every year", frequency: "yearly", interval: 1 },
  ];

function ScheduleFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { properties } = useProperties();
  const { categories } = useTaskCategories();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [location, setLocation] = useState<LocationValue>({ kind: "property" });
  const [assignee, setAssignee] = useState<AssigneeChoice>(null);
  const [preset, setPreset] = useState("monthly");
  const [customFrequency, setCustomFrequency] = useState<RecurrenceFrequency>("daily");
  const [customInterval, setCustomInterval] = useState(10);
  const [startDate, setStartDate] = useState(nairobiToday());
  const [dueAfterDays, setDueAfterDays] = useState(3);
  const [endKind, setEndKind] = useState<RecurrenceEndKind>("never");
  const [endCount, setEndCount] = useState(12);
  const [endUntil, setEndUntil] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setNotes("");
    setPropertyId(properties.length === 1 ? properties[0]._id : "");
    setCategory("");
    setPriority("medium");
    setLocation({ kind: "property" });
    setAssignee(null);
    setPreset("monthly");
    setStartDate(nairobiToday());
    setDueAfterDays(3);
    setEndKind("never");
    setEndCount(12);
    setEndUntil("");
  }, [open, properties]);

  const rule = useMemo(() => {
    if (preset === "custom")
      return { frequency: customFrequency, interval: Math.max(1, customInterval || 1) };
    const p = PRESETS.find((x) => x.key === preset) ?? PRESETS[2];
    return { frequency: p.frequency, interval: p.interval };
  }, [preset, customFrequency, customInterval]);

  const summary = describeRecurrence(rule, {
    kind: endKind,
    count: endKind === "count" ? endCount : null,
    until: endKind === "until" ? endUntil : "",
  });
  const blocks = properties.find((p) => p._id === propertyId)?.blocks ?? [];
  const problem =
    (!title.trim() && "Add a title") ||
    (!propertyId && "Choose a property") ||
    (!isLocationComplete(location) && "Finish choosing where") ||
    (!startDate && "Choose a start date") ||
    (endKind === "until" &&
      (!endUntil || endUntil < startDate) &&
      "The end date must be on or after the start") ||
    (endKind === "count" && !(endCount > 0) && "Enter how many times");

  const submit = async () => {
    if (problem) return;
    setSaving(true);
    try {
      await apiRequest("/api/v1/task-schedules", {
        method: "POST",
        json: {
          title: title.trim(),
          notes: notes.trim(),
          propertyId,
          category,
          priority,
          location,
          assignee,
          frequency: rule.frequency,
          interval: rule.interval,
          startDate,
          dueAfterDays,
          endKind,
          endCount: endKind === "count" ? endCount : undefined,
          endUntil: endKind === "until" ? endUntil : undefined,
        },
      });
      toast.success("Recurring task saved");
      onCreated();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New recurring task</DialogTitle>
          <DialogDescription>
            A new task is created on each date, even if the previous one is not finished yet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sch-title">Title</Label>
            <Input
              id="sch-title"
              value={title}
              maxLength={200}
              placeholder="e.g. Clean the water tank"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Property</Label>
              <Select
                value={propertyId}
                onValueChange={(v) => {
                  setPropertyId(v);
                  setLocation({ kind: "property" });
                  setAssignee(null);
                }}
              >
                <SelectTrigger aria-label="Property">
                  <SelectValue placeholder="Choose a property" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={category || "__none__"}
                onValueChange={(v) => setCategory(v === "__none__" ? "" : v)}
              >
                <SelectTrigger aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={`${c.builtIn}-${c.name}`} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <LocationPicker
            propertyId={propertyId}
            blocks={blocks}
            value={location}
            onChange={setLocation}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <AssigneeSelect propertyId={propertyId} value={assignee} onChange={setAssignee} />
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger aria-label="Priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="space-y-3 rounded-2xl border border-border p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Repeats
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>How often</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger aria-label="How often">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESETS.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {preset === "custom" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sch-interval">Every</Label>
                  <div className="flex gap-2">
                    <Input
                      id="sch-interval"
                      type="number"
                      min={1}
                      max={365}
                      value={customInterval}
                      onChange={(e) => setCustomInterval(Number(e.target.value))}
                      className="w-20"
                    />
                    <Select
                      value={customFrequency}
                      onValueChange={(v) => setCustomFrequency(v as RecurrenceFrequency)}
                    >
                      <SelectTrigger aria-label="Unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">days</SelectItem>
                        <SelectItem value="weekly">weeks</SelectItem>
                        <SelectItem value="monthly">months</SelectItem>
                        <SelectItem value="yearly">years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sch-start">First date</Label>
                <Input
                  id="sch-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sch-due">Due within (days)</Label>
                <Input
                  id="sch-due"
                  type="number"
                  min={0}
                  max={60}
                  value={dueAfterDays}
                  onChange={(e) => setDueAfterDays(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Ends</Label>
                <Select value={endKind} onValueChange={(v) => setEndKind(v as RecurrenceEndKind)}>
                  <SelectTrigger aria-label="Ends">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="count">After a number of times</SelectItem>
                    <SelectItem value="until">On a date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {endKind === "count" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sch-count">Times</Label>
                  <Input
                    id="sch-count"
                    type="number"
                    min={1}
                    max={1000}
                    value={endCount}
                    onChange={(e) => setEndCount(Number(e.target.value))}
                  />
                </div>
              ) : null}
              {endKind === "until" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sch-until">Last date</Label>
                  <Input
                    id="sch-until"
                    type="date"
                    value={endUntil}
                    onChange={(e) => setEndUntil(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
              <Repeat className="mr-1.5 inline h-4 w-4 text-primary" />
              {summary}, starting {startDate ? formatDate(startDate) : "—"}
            </p>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="sch-notes">Details</Label>
            <Textarea
              id="sch-notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{problem || ""}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={saving || Boolean(problem)}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Recurring tasks: list, pause/resume, delete and create. */
export function SchedulesPanel() {
  const { schedules, loading, error, refetch } = useTaskSchedules();
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TaskScheduleRecord | null>(null);

  const toggle = async (s: TaskScheduleRecord) => {
    setBusy(s._id);
    try {
      await apiRequest(`/api/v1/task-schedules/${s._id}`, {
        method: "PATCH",
        json: { isActive: !s.isActive },
      });
      toast.success(s.isActive ? "Paused" : "Resumed — dates missed while paused are skipped");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the schedule");
    } finally {
      setBusy(null);
    }
  };

  const columns: DataColumn<TaskScheduleRecord>[] = [
    {
      key: "title",
      header: "Recurring task",
      sortValue: (s) => s.title.toLowerCase(),
      cell: (s) => (
        <div className="min-w-0">
          <p className="font-medium">{s.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {s.property}
            {s.location?.label ? ` › ${s.location.label}` : ""}
          </p>
        </div>
      ),
    },
    { key: "rule", header: "Repeats", cell: (s) => s.summary },
    {
      key: "next",
      header: "Next",
      sortValue: (s) => s.nextRunDate || "9999",
      cell: (s) => (s.nextRunDate ? formatDate(s.nextRunDate) : "Finished"),
    },
    { key: "assignee", header: "Assigned to", cell: (s) => s.assignee?.name || "Unassigned" },
    {
      key: "state",
      header: "State",
      cell: (s) =>
        s.isActive ? (
          <StatusBadge tone="success">Active</StatusBadge>
        ) : (
          <StatusBadge tone="muted">{s.nextRunDate ? "Paused" : "Finished"}</StatusBadge>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="rounded-full" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New recurring task
        </Button>
      </div>
      <DataTable
        rows={schedules}
        columns={columns}
        getRowId={(s) => s._id}
        loading={loading}
        error={error}
        caption="Recurring tasks"
        emptyTitle="No recurring tasks yet"
        emptyDescription="Set up jobs that repeat, such as cleaning the water tank every 3 months."
        rowActions={(s) => (
          <>
            {s.nextRunDate || s.isActive ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={busy === s._id}
                onClick={() => void toggle(s)}
              >
                {s.isActive ? (
                  <Pause className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <Play className="mr-1 h-3.5 w-3.5" />
                )}
                {s.isActive ? "Pause" : "Resume"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${s.title}`}
              className="text-destructive"
              onClick={() => setDeleting(s)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      />
      <ScheduleFormDialog open={formOpen} onOpenChange={setFormOpen} onCreated={refetch} />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              No more tasks will be created. Tasks it already created are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await apiRequest(`/api/v1/task-schedules/${deleting._id}`, { method: "DELETE" });
                  toast.success("Recurring task deleted");
                  refetch();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not delete");
                } finally {
                  setDeleting(null);
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
