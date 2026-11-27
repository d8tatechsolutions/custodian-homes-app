"use client";

import {
  Ban,
  Check,
  Copy,
  FileText,
  Link2,
  Loader2,
  MapPin,
  Phone,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AddBrokerDialog } from "@/components/brokers/AddBrokerDialog";
import { type DataColumn, DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge, type StatusTone } from "@/components/common/StatusBadge";
import { TitleCell } from "@/components/common/TitleCell";
import { Money } from "@/components/money/Money";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/hooks/use-maintenance";
import { formatDate } from "@/lib/format";
import type { BrokerListingView } from "@/types/brokers";

interface BrokerRow {
  _id: string;
  userId: string;
  agencyName?: string;
  email: string;
  phone: string;
  status: "pending" | "verified" | "rejected" | "suspended";
  addedVia?: "self" | "admin" | "system";
  createdAt?: string;
}

interface OwnerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  isActive?: boolean;
  createdAt?: string;
}

const BROKER_TONE: Record<BrokerRow["status"], StatusTone> = {
  pending: "warning",
  verified: "success",
  rejected: "danger",
  suspended: "muted",
};
const ADDED: Record<string, string> = {
  self: "Signed up",
  admin: "Added by an owner",
  system: "Added by the platform",
};

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

function useLoad<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` is stable per panel; tick drives reloads
  useEffect(() => {
    let cancelled = false;
    void tick;
    setLoading(true);
    load()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch(
        (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not load"),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return { data, loading, error, refetch: useCallback(() => setTick((n) => n + 1), []) };
}

function BrokersPanel({ currentUserId }: { currentUserId: string }) {
  const { data, loading, error, refetch } = useLoad(
    () => json<{ brokers: BrokerRow[] }>("/api/v1/brokers?limit=100").then((r) => r.brokers ?? []),
    [] as BrokerRow[],
  );
  const [suspending, setSuspending] = useState<BrokerRow | null>(null);
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<string | null>(null);

  const decide = async (row: BrokerRow, decision: "verified" | "suspended", notes: string) => {
    try {
      const res = await fetch(`/api/v1/brokers/${row._id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not update the broker");
      toast.success(
        decision === "verified"
          ? "Broker active"
          : "Broker suspended — earned commission is still paid",
      );
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the broker");
    }
  };

  const newLink = async (row: BrokerRow) => {
    try {
      const d = await apiRequest<{ emailSent: boolean; inviteUrl?: string }>(
        `/api/v1/brokers/invite/${row.userId}`,
        { method: "POST" },
      );
      if (d.emailSent) toast.success(`New set-password link emailed to ${row.email}`);
      else if (d.inviteUrl) setLink(d.inviteUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send a new link");
    }
  };

  const columns: DataColumn<BrokerRow>[] = [
    {
      key: "who",
      header: "Broker",
      sortValue: (r) => (r.agencyName || r.email).toLowerCase(),
      cell: (r) => (
        <TitleCell
          detail={{
            title: r.agencyName || r.email,
            subtitle: ADDED[r.addedVia ?? "self"],
            fields: [
              { label: "Email", value: r.email },
              { label: "Phone", value: r.phone },
              { label: "Status", value: r.status },
              { label: "Joined", value: r.createdAt ? formatDate(r.createdAt) : "" },
            ],
          }}
        >
          {r.agencyName || r.email}
        </TitleCell>
      ),
    },
    { key: "email", header: "Email", cell: (r) => r.email, hideOnMobile: true },
    { key: "phone", header: "Phone", cell: (r) => r.phone },
    { key: "added", header: "Joined via", cell: (r) => ADDED[r.addedVia ?? "self"] },
    {
      key: "status",
      header: "Status",
      sortValue: (r) => r.status,
      cell: (r) => <StatusBadge tone={BROKER_TONE[r.status]}>{r.status}</StatusBadge>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddBrokerDialog
          inviterRole="system-admin"
          currentUserId={currentUserId}
          onAdded={refetch}
        />
      </div>
      <DataTable
        rows={data}
        columns={columns}
        getRowId={(r) => r._id}
        loading={loading}
        error={error}
        caption="Brokers"
        emptyTitle="No brokers yet"
        rowActions={(r) => (
          <>
            {r.status === "verified" ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => {
                  setSuspending(r);
                  setReason("");
                }}
              >
                <Ban className="mr-1 h-3.5 w-3.5" /> Suspend
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void decide(r, "verified", "Activated by the platform")}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />{" "}
                {r.status === "pending" ? "Verify" : "Reactivate"}
              </Button>
            )}
            {r.addedVia && r.addedVia !== "self" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void newLink(r)}
                aria-label="Re-send set-password link"
              >
                <Link2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </>
        )}
      />
      <Dialog open={Boolean(suspending)} onOpenChange={(o) => !o && setSuspending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suspend broker</DialogTitle>
            <DialogDescription>
              They can no longer log in, request listings or share links. Commission already earned
              is still paid.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="suspend-reason">Reason</Label>
            <Textarea
              id="suspend-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setSuspending(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={!reason.trim()}
              onClick={async () => {
                if (!suspending) return;
                await decide(suspending, "suspended", reason.trim());
                setSuspending(null);
              }}
            >
              Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(link)} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New set-password link</DialogTitle>
            <DialogDescription>
              The email could not be sent, so share this link yourself. Valid for 24 hours; any
              older link stops working.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              readOnly
              value={link ?? ""}
              aria-label="Link"
              onFocus={(e) => e.target.select()}
            />
            <Button
              variant="outline"
              aria-label="Copy link"
              onClick={() =>
                void navigator.clipboard.writeText(link ?? "").then(() => toast.success("Copied"))
              }
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OwnersPanel() {
  const { data, loading, error } = useLoad(
    () =>
      json<{ data: OwnerRow[] }>("/api/v1/admin/users?role=admin&limit=100").then(
        (r) => r.data ?? [],
      ),
    [] as OwnerRow[],
  );
  const columns: DataColumn<OwnerRow>[] = [
    {
      key: "name",
      header: "Owner",
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <TitleCell
          detail={{
            title: r.name,
            fields: [
              { label: "Email", value: r.email },
              { label: "Phone", value: r.phone },
              { label: "Status", value: r.isActive === false ? "Inactive" : "Active" },
            ],
          }}
        >
          {r.name}
        </TitleCell>
      ),
    },
    { key: "email", header: "Email", cell: (r) => r.email },
    { key: "phone", header: "Phone", cell: (r) => r.phone },
    {
      key: "state",
      header: "Status",
      cell: (r) =>
        r.isActive === false ? (
          <StatusBadge tone="muted">Inactive</StatusBadge>
        ) : (
          <StatusBadge tone="success">Active</StatusBadge>
        ),
    },
  ];
  return (
    <DataTable
      rows={data}
      columns={columns}
      getRowId={(r) => r.id}
      loading={loading}
      error={error}
      caption="Owners"
      emptyTitle="No owners yet"
    />
  );
}

function ReviewPanel() {
  const { data, loading, error, refetch } = useLoad(
    () => apiRequest<BrokerListingView[]>("/api/v1/broker-listings/review?status=submitted"),
    [] as BrokerListingView[],
  );
  const [deciding, setDeciding] = useState<{
    row: BrokerListingView;
    decision: "approve" | "reject";
  } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (data.length === 0) {
    return (
      <EmptyState
        title="Nothing to review"
        description="Brokers' own listings waiting for approval appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {data.map((row) => (
        <article key={row._id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{row.title}</h3>
              <p className="text-xs text-muted-foreground">
                For {row.purpose} · {row.area}, {row.county} · by{" "}
                {row.broker?.agency || row.broker?.name}
                {row.broker?.profileStatus && row.broker.profileStatus !== "verified"
                  ? ` (${row.broker.profileStatus})`
                  : ""}
              </p>
            </div>
            {row.duplicateFlags ? (
              <StatusBadge tone="danger">
                {row.duplicateFlags} possible duplicate photo{row.duplicateFlags > 1 ? "s" : ""}
              </StatusBadge>
            ) : (
              <StatusBadge tone="success">No duplicate photos found</StatusBadge>
            )}
          </div>
          <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {row.photos.map((p) => (
              <li
                key={p.url}
                className="aspect-square overflow-hidden rounded-lg border border-border"
              >
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* biome-ignore lint/performance/noImgElement: uploaded listing photos */}
                  <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Price</dt>
                <dd>
                  <Money amount={row.price} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Bedrooms</dt>
                <dd>{row.bedrooms}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Submitted</dt>
                <dd>{row.updatedAt ? formatDate(row.updatedAt) : ""}</dd>
              </div>
            </dl>
            <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Private evidence
              </p>
              <p className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" /> {row.exactLocation.address}
              </p>
              <p className="flex items-center gap-1.5">
                <Phone className="h-4 w-4" /> Owner: {row.ownerContact.name} ·{" "}
                <a href={`tel:${row.ownerContact.phone}`} className="text-primary">
                  {row.ownerContact.phone}
                </a>
              </p>
              {row.mandateDocument.url ? (
                <a
                  href={row.mandateDocument.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-primary"
                >
                  <FileText className="h-4 w-4" /> Mandate letter
                </a>
              ) : null}
            </div>
          </div>
          {row.description ? (
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {row.description}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              className="rounded-full"
              onClick={() => {
                setDeciding({ row, decision: "approve" });
                setNote("");
              }}
            >
              <Check className="mr-1.5 h-4 w-4" /> Approve (live 60 days)
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setDeciding({ row, decision: "reject" });
                setNote("");
              }}
            >
              <X className="mr-1.5 h-4 w-4" /> Reject
            </Button>
          </div>
        </article>
      ))}
      <Dialog open={Boolean(deciding)} onOpenChange={(o) => !o && !busy && setDeciding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deciding?.decision === "approve" ? "Approve listing" : "Reject listing"}
            </DialogTitle>
            <DialogDescription>{deciding?.row.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="review-note">
              {deciding?.decision === "reject"
                ? "Reason (the broker sees this)"
                : "Note (optional)"}
            </Label>
            <Textarea
              id="review-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={busy}
              onClick={() => setDeciding(null)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              variant={deciding?.decision === "reject" ? "destructive" : "default"}
              disabled={busy || (deciding?.decision === "reject" && !note.trim())}
              onClick={async () => {
                if (!deciding) return;
                setBusy(true);
                try {
                  await apiRequest(`/api/v1/broker-listings/${deciding.row._id}/review`, {
                    method: "POST",
                    json: { decision: deciding.decision, note: note.trim() },
                  });
                  toast.success(
                    deciding.decision === "approve" ? "Approved — now live" : "Rejected",
                  );
                  setDeciding(null);
                  refetch();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not save");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {deciding?.decision === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface FlagRow {
  _id: string;
  url: string;
  matchedUrl: string;
  distance: number;
  listing: { headline: string };
  matchedListing: { headline: string };
  property: string;
  matchedProperty: string;
  createdAt: string;
}

function FlagsPanel() {
  const { data, loading, error, refetch } = useLoad(
    () => apiRequest<FlagRow[]>("/api/v1/listing-flags"),
    [] as FlagRow[],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [takingDown, setTakingDown] = useState<FlagRow | null>(null);
  const [reason, setReason] = useState("");

  const resolve = async (flag: FlagRow, action: "dismiss" | "take_down", note = "") => {
    setBusy(flag._id);
    try {
      await apiRequest(`/api/v1/listing-flags/${flag._id}`, {
        method: "PATCH",
        json: { action, note },
      });
      toast.success(action === "dismiss" ? "Dismissed" : "Listing taken down");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  };

  if (loading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (data.length === 0) {
    return (
      <EmptyState
        title="No duplicate photos flagged"
        description="Photos reused on another property are flagged here automatically."
      />
    );
  }
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {data.map((f) => (
        <li key={f._id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="grid grid-cols-2 gap-3">
            {[
              { url: f.url, title: f.listing.headline || "Listing", place: f.property },
              {
                url: f.matchedUrl,
                title: f.matchedListing.headline || "Earlier listing",
                place: f.matchedProperty,
              },
            ].map((side, i) => (
              <figure key={side.url + i} className="space-y-1">
                <a
                  href={side.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square overflow-hidden rounded-lg border border-border"
                >
                  {/* biome-ignore lint/performance/noImgElement: flagged listing photos */}
                  <img
                    src={side.url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </a>
                <figcaption className="text-xs">
                  <span className="font-medium">{i === 0 ? "New: " : "Matches: "}</span>
                  {side.title}
                  <span className="block text-muted-foreground">{side.place}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Similarity: {Math.round(((64 - f.distance) / 64) * 100)}% · {formatDate(f.createdAt)}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={busy === f._id}
              onClick={() => void resolve(f, "dismiss")}
            >
              Not a duplicate
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="rounded-full"
              disabled={busy === f._id}
              onClick={() => {
                setTakingDown(f);
                setReason("");
              }}
            >
              Take listing down
            </Button>
          </div>
        </li>
      ))}
      <Dialog open={Boolean(takingDown)} onOpenChange={(o) => !o && setTakingDown(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take the listing down?</DialogTitle>
            <DialogDescription>
              It is withdrawn from the marketplace. Record why for the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="takedown-reason">Reason</Label>
            <Textarea
              id="takedown-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setTakingDown(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={!reason.trim()}
              onClick={async () => {
                if (!takingDown) return;
                await resolve(takingDown, "take_down", reason.trim());
                setTakingDown(null);
              }}
            >
              Take down
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ul>
  );
}

/** System-admin: separate Brokers and Owners lists, listing review and duplicate-photo flags. */
export function SystemBrokersDirectory() {
  const { user } = useAuth();
  return (
    <Tabs defaultValue="review">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList className="w-max">
          <TabsTrigger value="review">Listings to review</TabsTrigger>
          <TabsTrigger value="flags">Duplicate photos</TabsTrigger>
          <TabsTrigger value="brokers">Brokers</TabsTrigger>
          <TabsTrigger value="owners">Owners</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="review" className="mt-6">
        <ReviewPanel />
      </TabsContent>
      <TabsContent value="flags" className="mt-6">
        <FlagsPanel />
      </TabsContent>
      <TabsContent value="brokers" className="mt-6">
        {user ? <BrokersPanel currentUserId={user.id} /> : null}
      </TabsContent>
      <TabsContent value="owners" className="mt-6">
        <OwnersPanel />
      </TabsContent>
    </Tabs>
  );
}
