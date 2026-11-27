"use client";

import { BedDouble, Loader2, MapPin, Search, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CommissionTermsFields,
  EMPTY_TERMS,
  type StoredTerms,
  type TermsDraft,
  termsComplete,
  termsFromStored,
  termsPayload,
} from "@/components/brokers/CommissionTermsFields";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Money } from "@/components/money/Money";
import { SearchInput } from "@/components/SearchInput";
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
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/hooks/use-maintenance";
import type { PublicListingProjection } from "@/lib/listings";
import { matchesQuery } from "@/lib/search";
import type { BidView } from "@/types/brokers";

interface Props {
  bids: BidView[];
  defaultTerms?: StoredTerms | null;
  onRequested: () => void;
}

/**
 * Live marketplace listings a broker can ask to market, with the status of
 * any request they already made. "Request to list" opens the terms dialog,
 * pre-filled from the broker's default commission.
 */
export function BrokerFindListings({ bids, defaultTerms, onRequested }: Props) {
  const [listings, setListings] = useState<PublicListingProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<PublicListingProjection | null>(null);
  const [terms, setTerms] = useState<TermsDraft>(EMPTY_TERMS);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/marketplace/listings?limit=100")
      .then((r) => r.json())
      .then((json) => !cancelled && setListings(json.listings ?? json.data ?? []))
      .catch(() => !cancelled && setListings([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const latestByListing = useMemo(() => {
    const map = new Map<string, BidView>();
    for (const b of bids) if (!map.has(b.listingId)) map.set(b.listingId, b);
    return map;
  }, [bids]);

  const visible = listings.filter((l) =>
    matchesQuery(query, l.headline, l.property?.title, l.property?.location, l.unit?.name),
  );

  const open = (listing: PublicListingProjection) => {
    setTarget(listing);
    setTerms(termsFromStored(defaultTerms));
    setMessage("");
  };

  const send = async () => {
    if (!target || !termsComplete(terms)) return;
    setSending(true);
    try {
      await apiRequest("/api/v1/broker-bids", {
        method: "POST",
        json: { listingId: target.id, terms: { ...termsPayload(terms), message: message.trim() } },
      });
      toast.success("Request sent to the owner");
      setTarget(null);
      onRequested();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the request");
    } finally {
      setSending(false);
    }
  };

  const statusFor = (listingId: string) => {
    const bid = latestByListing.get(listingId);
    if (!bid) return null;
    if (bid.status === "accepted")
      return <StatusBadge tone="success">Approved — you can share it</StatusBadge>;
    if (bid.status === "pending")
      return <StatusBadge tone="warning">Waiting for the owner</StatusBadge>;
    if (bid.status === "countered")
      return <StatusBadge tone="info">Counter-offer to answer</StatusBadge>;
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="sm:max-w-sm">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search by area, property or unit"
        />
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading listings…
        </p>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No listings to show"
          description="Live listings on the marketplace appear here."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((l) => {
            const bid = latestByListing.get(l.id);
            const blocked = bid && ["pending", "countered", "accepted"].includes(bid.status);
            const photo = l.media?.find((m) => m.isPrimary)?.url ?? l.media?.[0]?.url;
            return (
              <li
                key={l.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft"
              >
                <div className="aspect-[16/9] bg-muted">
                  {photo ? (
                    // biome-ignore lint/performance/noImgElement: listing photos from the upload CDN
                    <img
                      src={photo}
                      alt={l.headline}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <p className="line-clamp-2 font-medium">{l.headline}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {l.property?.title} · {l.property?.location}
                  </p>
                  <p className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <BedDouble className="h-3.5 w-3.5" /> {l.unit?.beds ?? 0} bed
                    </span>
                    <span>{l.unit?.name}</span>
                  </p>
                  <Money amount={l.askingRent} className="font-semibold" />
                  <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                    {statusFor(l.id) ?? <span />}
                    {!blocked ? (
                      <Button size="sm" className="rounded-full" onClick={() => open(l)}>
                        <Send className="mr-1.5 h-3.5 w-3.5" /> Request to list
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && !sending && setTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request to list</DialogTitle>
            <DialogDescription>
              {target?.headline}. The owner can approve, reject or send you a counter-offer.
              Requests expire after 14 days without an answer.
            </DialogDescription>
          </DialogHeader>
          <CommissionTermsFields
            value={terms}
            onChange={setTerms}
            monthlyRent={target?.askingRent}
          />
          <div className="space-y-1.5">
            <Label htmlFor="bid-message">Message to the owner (optional)</Label>
            <Textarea
              id="bid-message"
              rows={3}
              maxLength={1000}
              value={message}
              placeholder="Your experience in this area, how you'll market it…"
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={sending}
              onClick={() => setTarget(null)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={sending || !termsComplete(terms)}
              onClick={() => void send()}
            >
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
