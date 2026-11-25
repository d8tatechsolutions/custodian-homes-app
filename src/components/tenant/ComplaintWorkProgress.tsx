"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Timeline, type TimelineItem } from "@/components/common/Timeline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/hooks/use-maintenance";
import { formatDate } from "@/lib/format";
import type { ComplaintProgress } from "@/types/maintenance";

interface ComplaintWorkProgressProps {
  complaintId: string;
  complaintStatus: string;
  progress: ComplaintProgress | undefined;
  onConfirmed: () => void;
}

/**
 * What the tenant sees about the work on their complaint (client decisions
 * Q5, Q7, Q14): Received → Assigned → Scheduled → Done, photos of the work,
 * and an "Is it fixed?" answer once it is done.
 */
export function ComplaintWorkProgress({
  complaintId,
  complaintStatus,
  progress,
  onConfirmed,
}: ComplaintWorkProgressProps) {
  const [answering, setAnswering] = useState<"fixed" | "not_fixed" | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  if (!progress) return null;

  const tasks = progress.tasks;
  const assigned = tasks.some((t) => t.assigned);
  const scheduled =
    tasks
      .map((t) => t.scheduledFor)
      .filter(Boolean)
      .sort()[0] ?? "";
  const allDone =
    tasks.length > 0 && tasks.every((t) => t.status === "done" || t.status === "cancelled");
  const anyStarted = tasks.some(
    (t) => t.status === "in-progress" || t.status.startsWith("waiting"),
  );
  const photosAfter = tasks.flatMap((t) => t.photosAfter);

  const step = (done: boolean, current: boolean): TimelineItem["state"] =>
    done ? "done" : current ? "current" : "pending";
  const items: TimelineItem[] = [
    { id: "received", title: "Received", state: "done" },
    {
      id: "assigned",
      title: "Assigned",
      meta: assigned ? "Someone has been given the job" : "Waiting to be assigned",
      state: step(assigned, !assigned),
    },
    {
      id: "scheduled",
      title: "Scheduled",
      meta: scheduled ? formatDate(scheduled) : "No date set yet",
      state: step(Boolean(scheduled) || anyStarted || allDone, assigned && !scheduled && !allDone),
    },
    { id: "done", title: "Done", state: step(allDone, anyStarted && !allDone) },
  ];

  const answer = async (fixed: boolean) => {
    if (!fixed && !showNote) {
      setShowNote(true);
      return;
    }
    setAnswering(fixed ? "fixed" : "not_fixed");
    try {
      await apiRequest(`/api/v1/tenant/me/complaints/${complaintId}/confirm`, {
        method: "POST",
        json: { fixed, note: note.trim() },
      });
      toast.success(fixed ? "Thanks for confirming" : "Thanks — we've reopened your request");
      onConfirmed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your answer");
    } finally {
      setAnswering(null);
    }
  };

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-border/70 p-4">
      {tasks.length > 0 ? <Timeline items={items} /> : null}

      {photosAfter.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Photos of the work</p>
          <ul className="grid grid-cols-3 gap-2">
            {photosAfter.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-lg border border-border">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square"
                >
                  {/* biome-ignore lint/performance/noImgElement: user uploads from an external CDN */}
                  <img
                    src={p.url}
                    alt="Completed work"
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {complaintStatus === "resolved" && progress.confirmation === "none" ? (
        <div className="space-y-3 rounded-xl bg-muted/50 p-3">
          <p className="text-sm font-medium">Is it fixed?</p>
          {showNote ? (
            <Textarea
              rows={2}
              maxLength={1000}
              value={note}
              placeholder="What is still wrong? (optional)"
              aria-label="What is still wrong"
              onChange={(e) => setNote(e.target.value)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="rounded-full"
              disabled={answering !== null}
              onClick={() => void answer(true)}
            >
              {answering === "fixed" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
              )}
              Yes, it's fixed
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={answering !== null}
              onClick={() => void answer(false)}
            >
              {answering === "not_fixed" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-1.5 h-4 w-4" />
              )}
              {showNote ? "Send: not fixed" : "No, not fixed"}
            </Button>
          </div>
        </div>
      ) : null}
      {progress.confirmation === "fixed" ? (
        <p className="text-sm text-success">You confirmed this is fixed. Thank you.</p>
      ) : null}
      {progress.confirmation === "not_fixed" && complaintStatus !== "resolved" ? (
        <p className="text-sm text-muted-foreground">
          You told us it isn't fixed — the team is on it again.
        </p>
      ) : null}
    </div>
  );
}
