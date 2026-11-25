"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type AssigneeChoice, AssigneeSelect } from "@/components/tasks/AssigneeSelect";
import {
  isLocationComplete,
  LocationPicker,
  type LocationValue,
} from "@/components/tasks/LocationPicker";
import { PhotoUploader, type UploadedFile } from "@/components/tasks/PhotoUploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { taskActions, useTaskCategories } from "@/hooks/use-maintenance";
import { useProperties } from "@/hooks/use-properties";
import { addDays, nairobiToday } from "@/lib/maintenance/dates";
import { MAX_TASK_PHOTOS_PER_SIDE } from "@/lib/maintenance/enums";
import type { MaintenanceTask, TaskPriority } from "@/types/maintenance";

export interface TaskFormPrefill {
  title?: string;
  notes?: string;
  propertyId?: string;
  priority?: TaskPriority;
  unitId?: string;
  complaintIds?: string[];
}

interface TaskFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewerRole: "admin" | "custodian" | "caretaker" | "system-admin";
  currentUserId: string;
  prefill?: TaskFormPrefill;
  onCreated: (task: MaintenanceTask) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-2xl border border-border p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/** "New task": what, where, who, when and before photos, in one scrollable panel. */
export function TaskFormSheet({
  open,
  onOpenChange,
  viewerRole: role,
  currentUserId,
  prefill,
  onCreated,
}: TaskFormSheetProps) {
  const { properties } = useProperties();
  const { categories } = useTaskCategories();
  const isCaretaker = role === "caretaker";

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState<LocationValue>({ kind: "property" });
  const [assignee, setAssignee] = useState<AssigneeChoice>(null);
  const [dueDate, setDueDate] = useState(addDays(nairobiToday(), 3));
  const [scheduledFor, setScheduledFor] = useState("");
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset whenever the panel opens, applying any prefill (e.g. from a complaint).
  useEffect(() => {
    if (!open) return;
    setTitle(prefill?.title ?? "");
    setNotes(prefill?.notes ?? "");
    setPropertyId(prefill?.propertyId ?? "");
    setPriority(prefill?.priority ?? "medium");
    setCategory("");
    setLocation(prefill?.unitId ? { kind: "unit", unitId: prefill.unitId } : { kind: "property" });
    setAssignee(isCaretaker ? { kind: "staff", userId: currentUserId } : null);
    setDueDate(addDays(nairobiToday(), 3));
    setScheduledFor("");
    setPhotos([]);
  }, [open, prefill, isCaretaker, currentUserId]);

  // A single property is preselected.
  useEffect(() => {
    if (open && !propertyId && properties.length === 1) setPropertyId(properties[0]._id);
  }, [open, propertyId, properties]);

  const property = useMemo(
    () => properties.find((p) => p._id === propertyId),
    [properties, propertyId],
  );
  const problems = [
    !title.trim() && "Add a title",
    !propertyId && "Choose a property",
    !isLocationComplete(location) && "Finish choosing where",
    !dueDate && "Set a due date",
    scheduledFor && dueDate && scheduledFor > dueDate && "The scheduled date is after the due date",
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (problems.length > 0) {
      toast.error(problems[0]);
      return;
    }
    setSaving(true);
    try {
      const task = await taskActions.create({
        title: title.trim(),
        notes: notes.trim(),
        propertyId,
        priority,
        dueDate,
        category,
        location,
        assignee: assignee ? { ...assignee } : null,
        scheduledFor,
        complaintIds: prefill?.complaintIds ?? [],
        photosBefore: photos,
      });
      toast.success("Task created");
      onCreated(task);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4 text-left">
          <SheetTitle>New task</SheetTitle>
          <SheetDescription>
            {prefill?.complaintIds?.length
              ? "Raised from a tenant complaint — it will be linked automatically."
              : "Describe the job, where it is and who will do it."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Section title="What">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                maxLength={200}
                placeholder="e.g. Fix leaking kitchen tap"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="space-y-1.5">
              <Label htmlFor="task-notes">Details</Label>
              <Textarea
                id="task-notes"
                value={notes}
                maxLength={2000}
                rows={3}
                placeholder="What exactly needs doing?"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </Section>

          <Section title="Where">
            <div className="space-y-1.5">
              <Label>Property</Label>
              <Select
                value={propertyId}
                disabled={Boolean(prefill?.propertyId)}
                onValueChange={(v) => {
                  setPropertyId(v);
                  setLocation({ kind: "property" });
                  setAssignee(isCaretaker ? { kind: "staff", userId: currentUserId } : null);
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
            <LocationPicker
              propertyId={propertyId}
              blocks={property?.blocks ?? []}
              value={location}
              onChange={setLocation}
            />
          </Section>

          <Section title="Who">
            <AssigneeSelect
              propertyId={propertyId}
              value={assignee}
              onChange={setAssignee}
              disabled={isCaretaker}
              allowUnassigned={!isCaretaker}
            />
            {isCaretaker ? (
              <p className="text-xs text-muted-foreground">Tasks you create are assigned to you.</p>
            ) : null}
          </Section>

          <Section title="When">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Due date</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-scheduled">Scheduled for (optional)</Label>
                <Input
                  id="task-scheduled"
                  type="date"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Tenants see the scheduled date on their request. Repeating jobs are set up under
              Recurring.
            </p>
          </Section>

          <Section title="Before photos">
            <PhotoUploader
              label="Before photos"
              max={MAX_TASK_PHOTOS_PER_SIDE}
              items={photos.map((p) => ({ id: p.key || p.url, url: p.url, name: p.name }))}
              onUploaded={(file) => setPhotos((prev) => [...prev, file])}
              onRemove={(id) => setPhotos((prev) => prev.filter((p) => (p.key || p.url) !== id))}
            />
          </Section>
        </div>

        <SheetFooter className="gap-2 border-t border-border px-6 py-4 sm:justify-between">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {problems[0] ?? "Ready to create."}
          </p>
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
              disabled={saving || problems.length > 0}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create task
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
