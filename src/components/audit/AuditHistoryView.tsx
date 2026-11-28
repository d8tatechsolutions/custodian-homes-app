"use client";

import { ChevronDown, History, MessageSquarePlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AuditEntryView, AuditNoteView } from "@/lib/audit-view";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_LIMIT = 20;

const TYPE_FILTERS = [
  { value: "all", label: "Everything" },
  { value: "invoice", label: "Invoices & payments" },
  { value: "lease", label: "Leases" },
  { value: "tenant", label: "Tenants" },
  { value: "user", label: "Accounts & roles" },
  { value: "assignment", label: "Staff access" },
  { value: "listing", label: "Listings" },
  { value: "property", label: "Properties" },
  { value: "commission", label: "Commissions" },
  { value: "broker", label: "Brokers" },
] as const;

interface Pagination {
  page: number;
  total: number;
  totalPages: number;
}

/** "amountPaid" → "Amount paid". */
function fieldLabel(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function formatWhen(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function NoteList({ notes }: { notes: AuditNoteView[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {notes.map((note) => (
        <li
          key={note.id}
          className="rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-sm"
        >
          <p className="whitespace-pre-wrap break-words text-foreground">{note.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Note by {note.authorName}
            {note.createdAt ? ` · ${formatWhen(note.createdAt)}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function AddNoteForm({
  entryId,
  onAdded,
}: {
  entryId: string;
  onAdded: (note: AuditNoteView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/audit/${entryId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add the note");
      onAdded(json.data as AuditNoteView);
      setText("");
      setOpen(false);
      toast.success("Note added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the note");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 h-8 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus className="mr-1 h-3.5 w-3.5" /> Add note
      </Button>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      <Label htmlFor={`note-${entryId}`} className="text-xs">
        Note (kept beside the entry; the entry itself is never changed)
      </Label>
      <Textarea
        id={`note-${entryId}`}
        value={text}
        maxLength={1000}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Confirmed with the owner by phone on 28 Nov"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{text.length}/1000</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={saving || !text.trim()} onClick={save}>
            {saving ? "Saving…" : "Save note"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  canAddNotes,
  onNoteAdded,
}: {
  entry: AuditEntryView;
  canAddNotes: boolean;
  onNoteAdded: (entryId: string, note: AuditNoteView) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = entry.changes.length > 0;
  const detailsId = `changes-${entry.id}`;

  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{entry.label}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="text-foreground">{entry.actor.name}</span>
            {entry.actor.name !== entry.actor.role && !entry.actor.isYou && (
              <span> · {entry.actor.role}</span>
            )}
            {entry.propertyTitle && <span> · {entry.propertyTitle}</span>}
          </p>
        </div>
        <time
          dateTime={entry.at}
          title={formatWhen(entry.at)}
          className="shrink-0 text-xs text-muted-foreground"
        >
          {entry.at ? relativeTime(entry.at) : ""}
        </time>
      </div>

      {hasChanges && (
        <>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            />
            {expanded ? "Hide details" : `Show details (${entry.changes.length})`}
          </button>
          {expanded && (
            <dl
              id={detailsId}
              className="mt-2 divide-y divide-border rounded-xl border border-border text-sm"
            >
              {entry.changes.map((change) => (
                <div
                  key={change.field}
                  className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3"
                >
                  <dt className="text-muted-foreground">{fieldLabel(change.field)}</dt>
                  <dd className="min-w-0 break-words">
                    {change.before !== "—" && (
                      <>
                        <span className="text-muted-foreground line-through">{change.before}</span>
                        <span className="mx-1.5 text-muted-foreground" aria-hidden="true">
                          →
                        </span>
                        <span className="sr-only">changed to</span>
                      </>
                    )}
                    <span className="text-foreground">{change.after}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      <NoteList notes={entry.notes} />
      {canAddNotes && (
        <AddNoteForm entryId={entry.id} onAdded={(note) => onNoteAdded(entry.id, note)} />
      )}
    </li>
  );
}

/**
 * The History page for every role. What it lists is decided on the server
 * (need-to-know); this view only filters and pages through it.
 */
export function AuditHistoryView() {
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, total: 0, totalPages: 0 });
  const [canAddNotes, setCanAddNotes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
        if (type !== "all") params.set("type", type);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/v1/audit?${params}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Could not load the history");
        setEntries(json.data ?? []);
        setPagination(json.pagination ?? { page, total: 0, totalPages: 0 });
        setCanAddNotes(Boolean(json.canAddNotes));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the history");
      } finally {
        setLoading(false);
      }
    },
    [type, from, to],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const onNoteAdded = (entryId: string, note: AuditNoteView) => {
    setEntries((list) =>
      list.map((e) => (e.id === entryId ? { ...e, notes: [...e.notes, note] } : e)),
    );
  };

  const filtersActive = type !== "all" || from || to;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="w-full min-w-0 space-y-1.5 sm:w-56">
          <Label htmlFor="history-type">Show</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="history-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 sm:w-40 sm:flex-none">
          <Label htmlFor="history-from">From</Label>
          <Input
            id="history-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 sm:w-40 sm:flex-none">
          <Label htmlFor="history-to">To</Label>
          <Input
            id="history-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {filtersActive && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setType("all");
                setFrom("");
                setTo("");
              }}
            >
              Clear
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => void load(pagination.page)}
            aria-label="Refresh history"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          {error}
        </p>
      )}

      {loading && entries.length === 0 ? (
        <ul className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="rounded-2xl border border-border bg-card p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </li>
          ))}
        </ul>
      ) : entries.length === 0 && !error ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border p-10 text-center">
          <History className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Nothing recorded yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {filtersActive
              ? "No entries match these filters."
              : "Changes you're allowed to see will appear here as they happen."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              canAddNotes={canAddNotes}
              onNoteAdded={onNoteAdded}
            />
          ))}
        </ul>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} entries
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || pagination.page <= 1}
              onClick={() => void load(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || pagination.page >= pagination.totalPages}
              onClick={() => void load(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-2 align-middle">
          Read-only
        </Badge>
        Entries can't be edited or deleted. You see the changes your role needs to know about.
      </p>
    </div>
  );
}
