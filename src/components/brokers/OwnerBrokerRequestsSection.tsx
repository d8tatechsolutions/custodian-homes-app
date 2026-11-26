"use client";

import { AddBrokerDialog } from "@/components/brokers/AddBrokerDialog";
import { BidRequestsPanel } from "@/components/brokers/BidRequestsPanel";
import { FxAttribution } from "@/components/money/Money";
import { useBrokerBids } from "@/hooks/use-broker-bids";
import { useReleaseFlags } from "@/hooks/use-fx";

/**
 * Owner's broker requests and "Add broker", shown on the Brokers page while
 * BROKER_BIDS_ENABLED is on. Renders nothing otherwise.
 */
export function OwnerBrokerRequestsSection({
  currentUserId,
  onBrokerAdded,
}: {
  currentUserId: string;
  onBrokerAdded?: () => void;
}) {
  const { flags, loading } = useReleaseFlags();
  const { bids, refetch } = useBrokerBids(flags.brokerBids);
  if (loading || !flags.brokerBids) return null;
  const waiting = bids.filter((b) => b.awaiting === "owner").length;

  return (
    <section
      className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft"
      aria-labelledby="broker-requests"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="broker-requests" className="text-lg font-semibold">
            Broker requests
            {waiting > 0 ? (
              <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {waiting}
              </span>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            Brokers asking to market your listings, with the commission they propose.
          </p>
        </div>
        <AddBrokerDialog
          inviterRole="admin"
          currentUserId={currentUserId}
          onAdded={onBrokerAdded}
        />
      </div>
      <BidRequestsPanel bids={bids} onChanged={refetch} />
      <FxAttribution />
    </section>
  );
}
