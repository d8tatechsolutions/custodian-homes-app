import { type FxQuote, isPlausibleKesRate } from "@/lib/fx-math";
import { cached, invalidateCached } from "@/lib/memory-cache";
import { FxRate } from "@/models/FxRate";

/** The stored rate changes once a day; keep the newest row in memory briefly. */
const LATEST_RATE_CACHE_MS = 5 * 60_000;
const LATEST_RATE_KEY = "fx:usd-kes:latest";

/**
 * Server-side USD/KES rate service.
 *
 * Source: ExchangeRate-API's open endpoint (no key, refreshed daily). Its terms
 * require visible attribution, rendered by `<FxAttribution />`.
 *
 * Rates are cached in Mongo, one row per day. The daily cron refreshes them;
 * readers also refresh on demand when the newest row is older than the
 * freshness window, so Preview deployments (where Vercel cron never runs)
 * still get current rates. A provider outage never blocks a page: the last
 * known rate is returned and flagged `stale`.
 */

export const FX_PROVIDER_URL = "https://open.er-api.com/v6/latest/USD";
export const FX_SOURCE = "exchangerate-api.com";
const FRESH_HOURS = 36;
const FETCH_TIMEOUT_MS = 5_000;

interface ProviderResponse {
  result?: string;
  base_code?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

interface StoredRate {
  rate: number;
  effectiveDate: string;
  source: string;
  fetchedAt: Date | string;
}

function toQuote(doc: StoredRate, now: Date): FxQuote {
  const ageHours = (now.getTime() - new Date(doc.fetchedAt).getTime()) / 3_600_000;
  return {
    rate: doc.rate,
    effectiveDate: doc.effectiveDate,
    source: doc.source,
    stale: ageHours > FRESH_HOURS,
  };
}

/** Fetches today's rate from the provider and stores it. Returns null on any failure. */
export async function refreshUsdKesRate(now = new Date()): Promise<FxQuote | null> {
  let body: ProviderResponse;
  try {
    const res = await fetch(FX_PROVIDER_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[fx] provider responded ${res.status}`);
      return null;
    }
    body = (await res.json()) as ProviderResponse;
  } catch (error) {
    console.warn("[fx] provider request failed:", error instanceof Error ? error.message : error);
    return null;
  }

  const rate = body.rates?.KES;
  if (body.result !== "success" || body.base_code !== "USD" || typeof rate !== "number") {
    console.warn("[fx] provider returned an unexpected payload");
    return null;
  }
  if (!isPlausibleKesRate(rate)) {
    console.warn(`[fx] rejected implausible USD/KES rate ${rate}`);
    return null;
  }

  const published = body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000) : now;
  const effectiveDate = published.toISOString().slice(0, 10);

  await FxRate.updateOne(
    { base: "USD", quote: "KES", effectiveDate },
    { $set: { rate, source: FX_SOURCE, fetchedAt: now } },
    { upsert: true },
  );
  invalidateCached(LATEST_RATE_KEY);
  return { rate, effectiveDate, source: FX_SOURCE, stale: false };
}

async function latestStored(): Promise<StoredRate | null> {
  return cached(
    LATEST_RATE_KEY,
    LATEST_RATE_CACHE_MS,
    async () =>
      (await FxRate.findOne({ base: "USD", quote: "KES" })
        .sort({ effectiveDate: -1, fetchedAt: -1 })
        .lean()) as StoredRate | null,
  );
}

/** Current USD/KES rate: cached when fresh, refreshed when stale, last-known on outage. */
export async function getUsdKesRate(now = new Date()): Promise<FxQuote | null> {
  const latest = await latestStored();
  if (latest && !toQuote(latest, now).stale) return toQuote(latest, now);

  const refreshed = await refreshUsdKesRate(now);
  if (refreshed) return refreshed;
  return latest ? toQuote(latest, now) : null;
}

/**
 * Rate that applied on a given day (YYYY-MM-DD): the newest rate published on
 * or before that day, else the oldest one we have, else the current rate.
 */
export async function getUsdKesRateOn(day: string, now = new Date()): Promise<FxQuote | null> {
  const onOrBefore = (await FxRate.findOne({
    base: "USD",
    quote: "KES",
    effectiveDate: { $lte: day },
  })
    .sort({ effectiveDate: -1 })
    .lean()) as StoredRate | null;
  if (onOrBefore) return { ...toQuote(onOrBefore, now), stale: false };

  const earliest = (await FxRate.findOne({ base: "USD", quote: "KES" })
    .sort({ effectiveDate: 1 })
    .lean()) as StoredRate | null;
  if (earliest) return { ...toQuote(earliest, now), stale: false };

  return getUsdKesRate(now);
}
