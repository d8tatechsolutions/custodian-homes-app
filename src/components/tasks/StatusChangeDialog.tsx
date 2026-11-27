"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TaskStatusBadge } from "@/components/tasks/TaskBadges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { taskActions } from "@/hooks/use-maintenance";
import { TASK_STATUS_LABELS, type TaskStatusV2 } from "@/lib/maintenance/enums";
import type { MaintenanceTask } from "@/types/maintenance";

interface StatusChangeDialogProps {
  task: MaintenanceTask | null;
  to: TaskStatusV2 | null;
  onClose: () => void;
  onChanged: (task: MaintenanceTask) => void;
}

/**
 * Confirms a status move. When finishing or cancelling a task linked to tenant
 * complaints it asks "Also resolve the complaint?" (client decisions Q4 and
 * the cancel rule), with an optional note the tenant will see.
 */
export function StatusChangeDialog({ task, to, onClose, onChanged }: StatusChangeDialogProps) {
  const [note, setNote] = useState("");
  const [resolve, setResolve] = useState(true);
  const [saving, setSaving] = useState(false);
  const linked = task?.complaintIds?.length ?? 0;
  const closing = to === "done" || to === "cancelled";
  const asksAboutComplaints = closing && linked > 0;

  useEffect(() => {
    if (task && to) {
      setNote("");
      setResolve(to === "done");
    }
  }, [task, to]);

  const confirm = async () => {
    if (!task || !to) return;
    setSaving(true);
    try {
      const updated = await taskActions.status(task._id, {
        status: to,
        note: note.trim(),
        resolveComplaints: asksAboutComplaints && resolve,
      });
      toast.success(`Moved to ${TASK_STATUS_LABELS[to]}`);
      onChanged(updated);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the status");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(task && to)} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            {task ? <TaskStatusBadge status={task.status} /> : null}
            <span aria-hidden="true">→</span>
            {to ? <TaskStatusBadge status={to} /> : null}
          </DialogDescription>
        </DialogHeader>

        {asksAboutComplaints ? (
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <Label className="flex cursor-pointer items-start gap-3 font-normal">
              <Checkbox
                checked={resolve}
                onChange={(e) => setResolve(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">
                  Also resolve the tenant complaint{linked > 1 ? "s" : ""}?
                </span>
                <span className="block text-xs text-muted-foreground">
                  {to === "done"
                    ? "The tenant is asked to confirm it is fixed."
                    : "The tenant sees the request as closed."}
                </span>
              </span>
            </Label>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="status-note">
            Note {asksAboutComplaints && resolve ? "(shown to the tenant)" : "(optional)"}
          </Label>
          <Textarea
            id="status-note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              to === "cancelled" ? "Why is it no longer needed?" : "Anything worth recording"
            }
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-full" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            variant={to === "cancelled" ? "destructive" : "default"}
            onClick={() => void confirm()}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {to ? `Mark ${TASK_STATUS_LABELS[to].toLowerCase()}` : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
