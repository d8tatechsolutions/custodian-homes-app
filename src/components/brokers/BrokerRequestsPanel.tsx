"use client";

import { Check, Copy, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BidStatusBadge } from "@/components/brokers/BidStatusBadge";
import { describeTerms } from "@/components/brokers/CommissionTermsFields";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/hooks/use-maintenance";
import { formatDate } from "@/lib/format";
import type { BidView } from "@/types/brokers";

/** The broker's requests: status, the offer history, and answers to counter-offers. */
export function BrokerRequestsPanel({
  bids,
  onChanged,
}: {
  bids: BidView[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (bid: BidView, action: "accept" | "decline" | "withdraw") => {
    setBusy(`${bid._id}:${action}`);
    try {
      await apiRequest(`/api/v1/broker-bids/${bid._id}/respond`, {
        method: "POST",
        json: { action },
      });
      toast.success(
        action === "accept"
          ? "Counter-offer accepted — you can now share the listing"
          : action === "decline"
            ? "Declined"
            : "Request withdrawn",
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (bid: BidView) => {
    const url = `${window.location.origin}/marketplace/${bid.listingId}?ref=${bid.shareCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied");
    } catch {
      toast.error(`Could not copy — the link is ${url}`);
    }
  };

  if (bids.length === 0) {
    return (
      <EmptyState title="No requests yet" description="Find a listing and request to market it." />
    );
  }

  return (
    <ul className="space-y-4">
      {bids.map((bid) => {
        const latest = bid.offers[bid.offers.length - 1];
        return (
          <li key={bid._id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{bid.listingHeadline}</p>
                <p className="text-xs text-muted-foreground">
                  {bid.property} · sent {bid.createdAt ? formatDate(bid.createdAt) : ""}
                  {bid.status === "pending" || bid.status === "countered"
                    ? ` · expires ${formatDate(bid.expiresAt)}`
                    : ""}
                </p>
              </div>
              <BidStatusBadge status={bid.status} />
            </div>

            <ol className="mt-4 space-y-2 border-l border-border pl-4 text-sm">
              {bid.offers.map((o, i) => (
                <li key={`${o.at}-${i}`}>
                  <span className="font-medium">
                    {o.by === "broker" ? "You proposed" : "Owner countered"}:
                  </span>{" "}
                  {describeTerms(o)}
                  {o.message ? (
                    <span className="block text-muted-foreground">“{o.message}”</span>
                  ) : null}
                </li>
              ))}
            </ol>
            {bid.decisionNote && (bid.status === "rejected" || bid.status === "accepted") ? (
              <p className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
                Owner's note: {bid.decisionNote}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {bid.status === "countered" && latest?.by === "owner" ? (
                <>
                  <Button
                    size="sm"
                    className="rounded-full"
                    disabled={busy !== null}
                    onClick={() => void respond(bid, "accept")}
                  >
                    {busy === `${bid._id}:accept` ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-4 w-4" />
                    )}
                    Accept {describeTerms(latest)}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={busy !== null}
                    onClick={() => void respond(bid, "decline")}
                  >
                    <X className="mr-1.5 h-4 w-4" /> Decline
                  </Button>
                </>
              ) : null}
              {bid.status === "pending" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  disabled={busy !== null}
                  onClick={() => void respond(bid, "withdraw")}
                >
                  Withdraw request
                </Button>
              ) : null}
              {bid.status === "accepted" && bid.shareCode ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void copyLink(bid)}
                >
                  <Copy className="mr-1.5 h-4 w-4" /> Copy share link
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
