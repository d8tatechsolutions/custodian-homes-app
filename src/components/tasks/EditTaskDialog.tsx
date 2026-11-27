"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  isLocationComplete,
  LocationPicker,
  type LocationValue,
} from "@/components/tasks/LocationPicker";
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
import { taskActions, useTaskCategories } from "@/hooks/use-maintenance";
import { useProperties } from "@/hooks/use-properties";
import type { MaintenanceTask, TaskPriority } from "@/types/maintenance";

interface EditTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: MaintenanceTask;
  onSaved: (task: MaintenanceTask) => void;
}

/** Edits a task's details. Status and assignment have their own actions. */
export function EditTaskDialog({ open, onOpenChange, task, onSaved }: EditTaskDialogProps) {
  const { properties } = useProperties();
  const { categories } = useTaskCategories();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [category, setCategory] = useState(task.category ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate?.slice(0, 10) ?? "");
  const [scheduledFor, setScheduledFor] = useState(task.scheduledFor ?? "");
  const [location, setLocation] = useState<LocationValue>({ kind: "property" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setPriority(task.priority);
    setCategory(task.category ?? "");
    setDueDate(task.dueDate?.slice(0, 10) ?? "");
    setScheduledFor(task.scheduledFor ?? "");
    setLocation(
      task.location
        ? {
            kind: task.location.kind,
            blockId: task.location.blockId || undefined,
            floorId: task.location.floorId || undefined,
            unitId: task.location.unitId || undefined,
            commonAreaId: task.location.commonAreaId || undefined,
          }
        : { kind: "property" },
    );
  }, [open, task]);

  const blocks = properties.find((p) => p._id === task.propertyId)?.blocks ?? [];
  const invalid = !title.trim() || !dueDate || !isLocationComplete(location);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await taskActions.update(task._id, {
        title: title.trim(),
        notes: notes.trim(),
        priority,
        category,
        dueDate,
        scheduledFor,
        location,
      });
      toast.success("Task updated");
      onSaved(updated);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            Status and assignment are changed from the task page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              maxLength={200}
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
                  {category && !categories.some((c) => c.name === category) ? (
                    <SelectItem value={category}>{category}</SelectItem>
                  ) : null}
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
          <LocationPicker
            propertyId={task.propertyId}
            blocks={blocks}
            value={location}
            onChange={setLocation}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-due">Due date</Label>
              <Input
                id="edit-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-scheduled">Scheduled for</Label>
              <Input
                id="edit-scheduled"
                type="date"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Details</Label>
            <Textarea
              id="edit-notes"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button className="rounded-full" disabled={saving || invalid} onClick={() => void save()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
