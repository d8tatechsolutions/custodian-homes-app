"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/hooks/use-maintenance";
import type { BidView } from "@/types/brokers";

/** Broker bids visible to the caller (their own as broker, or those they decide on). */
export function useBrokerBids(enabled: boolean) {
  const [bids, setBids] = useState<BidView[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void tick;
    apiRequest<BidView[]>("/api/v1/broker-bids")
      .then((d) => !cancelled && setBids(d ?? []))
      .catch(() => !cancelled && setBids([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);
  return { bids, loading, refetch };
}
