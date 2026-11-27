"use client";

import { Check, Loader2, Repeat2, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BidStatusBadge } from "@/components/brokers/BidStatusBadge";
import {
  CommissionTermsFields,
  describeTerms,
  type TermsDraft,
  termsComplete,
  termsFromStored,
  termsPayload,
} from "@/components/brokers/CommissionTermsFields";
import { EmptyState } from "@/components/common/EmptyState";
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
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/hooks/use-maintenance";
import { formatDate } from "@/lib/format";
import type { BidView } from "@/types/brokers";

type Mode = { bid: BidView; action: "approve" | "reject" | "counter" } | null;

/**
 * Broker requests on the owner's listings, grouped by listing so competing
 * brokers can be compared side by side. Approve, reject (with a reason) or
 * send a counter-offer.
 */
export function BidRequestsPanel({ bids, onChanged }: { bids: BidView[]; onChanged: () => void }) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [terms, setTerms] = useState<TermsDraft>(termsFromStored(null));
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const list = bids.filter(
      (b) => filter === "all" || b.awaiting === "owner" || b.status === "countered",
    );
    const map = new Map<
      string,
      { headline: string; property: string; rent: number; bids: BidView[] }
    >();
    for (const b of list) {
      const g = map.get(b.listingId) ?? {
        headline: b.listingHeadline,
        property: b.property,
        rent: b.askingRent,
        bids: [],
      };
      g.bids.push(b);
      map.set(b.listingId, g);
    }
    return [...map.entries()];
  }, [bids, filter]);

  const begin = (bid: BidView, action: "approve" | "reject" | "counter") => {
    setMode({ bid, action });
    setNote("");
    setTerms(termsFromStored(bid.offers[bid.offers.length - 1]));
  };

  const confirm = async () => {
    if (!mode) return;
    if (mode.action === "reject" && !note.trim()) {
      toast.error("Add a short reason");
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/v1/broker-bids/${mode.bid._id}/decision`, {
        method: "POST",
        json:
          mode.action === "counter"
            ? {
                action: "counter",
                note: note.trim(),
                terms: { ...termsPayload(terms), message: note.trim() },
              }
            : { action: mode.action, note: note.trim() },
      });
      toast.success(
        mode.action === "approve"
          ? "Broker approved — they can now share this listing"
          : mode.action === "counter"
            ? "Counter-offer sent"
            : "Request rejected",
      );
      setMode(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as "open" | "all")}>
        <TabsList>
          <TabsTrigger value="open">Needs your answer</TabsTrigger>
          <TabsTrigger value="all">All requests</TabsTrigger>
        </TabsList>
      </Tabs>

      {groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filter === "open" ? "No broker requests waiting" : "No broker requests yet"}
          description="When brokers ask to market one of your listings, you'll compare their offers here."
        />
      ) : (
        groups.map(([listingId, g]) => (
          <section key={listingId} className="rounded-2xl border border-border bg-card shadow-soft">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-4">
              <div>
                <h3 className="font-semibold">{g.headline}</h3>
                <p className="text-xs text-muted-foreground">
                  {g.property} · {g.bids.length} broker{g.bids.length === 1 ? "" : "s"}
                </p>
              </div>
              <Money amount={g.rent} className="text-sm font-medium" />
            </header>
            <ul className="divide-y divide-border/60">
              {g.bids.map((b) => {
                const latest = b.offers[b.offers.length - 1];
                return (
                  <li
                    key={b._id}
                    className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">
                        {b.broker.name || "Broker"}
                        {b.broker.agency ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {b.broker.agency}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-sm">
                        {latest ? describeTerms(latest) : "—"}
                        {latest?.by === "owner" ? (
                          <span className="text-muted-foreground"> (your counter)</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {b.broker.tenantsBrought} tenant{b.broker.tenantsBrought === 1 ? "" : "s"}{" "}
                        brought before · asked {b.createdAt ? formatDate(b.createdAt) : ""}
                      </p>
                      {latest?.message ? (
                        <p className="text-sm text-muted-foreground">“{latest.message}”</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <BidStatusBadge status={b.status} />
                      {b.awaiting === "owner" ? (
                        <>
                          <Button
                            size="sm"
                            className="rounded-full"
                            onClick={() => begin(b, "approve")}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => begin(b, "counter")}
                          >
                            <Repeat2 className="mr-1 h-3.5 w-3.5" /> Counter
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-full"
                            onClick={() => begin(b, "reject")}
                          >
                            <X className="mr-1 h-3.5 w-3.5" /> Reject
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <Dialog open={Boolean(mode)} onOpenChange={(o) => !o && !busy && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode?.action === "approve"
                ? "Approve broker"
                : mode?.action === "counter"
                  ? "Send a counter-offer"
                  : "Reject request"}
            </DialogTitle>
            <DialogDescription>
              {mode?.bid.broker.name} · {mode?.bid.listingHeadline}
              {mode?.action === "approve"
                ? ` — on ${describeTerms(mode.bid.offers[mode.bid.offers.length - 1])}. Other brokers can still be approved too.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {mode?.action === "counter" ? (
            <CommissionTermsFields
              value={terms}
              onChange={setTerms}
              monthlyRent={mode.bid.askingRent}
            />
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="bid-note">
              {mode?.action === "reject" ? "Reason (the broker sees this)" : "Note (optional)"}
            </Label>
            <Textarea
              id="bid-note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={busy}
              onClick={() => setMode(null)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              variant={mode?.action === "reject" ? "destructive" : "default"}
              disabled={
                busy ||
                (mode?.action === "counter" && !termsComplete(terms)) ||
                (mode?.action === "reject" && !note.trim())
              }
              onClick={() => void confirm()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {mode?.action === "approve"
                ? "Approve"
                : mode?.action === "counter"
                  ? "Send counter-offer"
                  : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
