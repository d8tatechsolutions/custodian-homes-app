"use client";

import { useEffect, useState } from "react";
import type { ReleaseFlags } from "@/lib/feature-flags";
import type { FxQuote } from "@/lib/fx-math";

/*
 * Module-level caches: the rate and flags change at most daily, so every
 * component on a page shares one request instead of fetching its own.
 */
let ratePromise: Promise<FxQuote | null> | null = null;
let flagsPromise: Promise<ReleaseFlags> | null = null;

const OFF: ReleaseFlags = { tasksV2: false, brokerBids: false, fxDisplay: false };

function loadRate(): Promise<FxQuote | null> {
  ratePromise ??= fetch("/api/v1/fx")
    .then(async (res) => (res.ok ? ((await res.json()).data as FxQuote) : null))
    .catch(() => null);
  return ratePromise;
}

function loadFlags(): Promise<ReleaseFlags> {
  flagsPromise ??= fetch("/api/v1/features")
    .then(async (res) => (res.ok ? ((await res.json()).data as ReleaseFlags) : OFF))
    .catch(() => OFF);
  return flagsPromise;
}

/** Test hook: forget cached rate/flags. */
export function resetFxCaches() {
  ratePromise = null;
  flagsPromise = null;
}

export function useFxRate(enabled = true): { quote: FxQuote | null; loading: boolean } {
  const [quote, setQuote] = useState<FxQuote | null>(null);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void loadRate().then((q) => {
      if (cancelled) return;
      setQuote(q);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { quote, loading };
}

export function useReleaseFlags(): { flags: ReleaseFlags; loading: boolean } {
  const [flags, setFlags] = useState<ReleaseFlags>(OFF);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void loadFlags().then((f) => {
      if (cancelled) return;
      setFlags(f);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { flags, loading };
}
