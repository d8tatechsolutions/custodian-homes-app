"use client";

import { BadgeCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { Money } from "@/components/money/Money";
import { TaskPriorityBadge } from "@/components/tasks/TaskBadges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { taskActions, useApprovals } from "@/hooks/use-maintenance";
import { formatDate } from "@/lib/format";

/** Costs waiting for the current user's decision, oldest first. */
export function ApprovalsPanel({ basePath }: { basePath: string }) {
  const { approvals, loading, error, refetch } = useApprovals();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (id: string, decision: "approve" | "reject") => {
    const note = (notes[id] ?? "").trim();
    if (decision === "reject" && !note) {
      toast.error("Add a short reason to reject");
      return;
    }
    setBusy(`${id}:${decision}`);
    try {
      await taskActions.approval(id, { decision, note });
      toast.success(decision === "approve" ? "Cost approved" : "Cost rejected");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the decision");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading approvals…
      </p>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {error}
      </div>
    );
  }
  if (approvals.length === 0) {
    return (
      <EmptyState
        icon={BadgeCheck}
        title="Nothing waiting for your approval"
        description="When a quote is above a property's approval limit, it appears here for you to approve or reject."
      />
    );
  }

  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {approvals.map((t) => (
        <li
          key={t._id}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`${basePath}/${t._id}`}
                className="font-medium hover:text-primary hover:underline"
              >
                {t.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {t.property}
                {t.location?.label ? ` › ${t.location.label}` : ""}
              </p>
            </div>
            <TaskPriorityBadge priority={t.priority} />
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">Quoted</p>
            <Money amount={t.cost?.quote?.amount ?? 0} className="text-lg font-semibold" />
            {t.cost?.quote?.note ? <p className="mt-1 text-sm">{t.cost.quote.note}</p> : null}
            <p className="mt-2 text-xs text-muted-foreground">
              {t.assignedToName ? `Work by ${t.assignedToName}` : "No one assigned yet"}
              {t.cost?.quote?.at ? ` · quoted ${formatDate(t.cost.quote.at)}` : ""}
            </p>
          </div>
          <Input
            value={notes[t._id] ?? ""}
            maxLength={1000}
            placeholder="Note (required to reject)"
            aria-label={`Decision note for ${t.title}`}
            onChange={(e) => setNotes((prev) => ({ ...prev, [t._id]: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button
              className="flex-1 rounded-full"
              disabled={busy !== null}
              onClick={() => void decide(t._id, "approve")}
            >
              {busy === `${t._id}:approve` ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Approve
            </Button>
            <Button
              variant="outline"
              className="flex-1 rounded-full"
              disabled={busy !== null}
              onClick={() => void decide(t._id, "reject")}
            >
              Reject
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
