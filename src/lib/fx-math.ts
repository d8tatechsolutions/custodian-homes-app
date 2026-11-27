/**
 * Pure USD/KES helpers, safe to import from client components.
 *
 * Rates are expressed as "1 USD = rate KES". Amounts are in major units
 * (shillings / dollars) and results are rounded to the nearest cent.
 */

export const SUPPORTED_CURRENCIES = ["KES", "USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export interface FxQuote {
  /** KES per 1 USD. */
  rate: number;
  /** YYYY-MM-DD the provider published the rate for. */
  effectiveDate: string;
  source: string;
  /** True when the newest available rate is older than the freshness window. */
  stale?: boolean;
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Converts an amount between KES and USD. Same-currency conversion is a no-op. */
export function convertAmount(amount: number, from: Currency, to: Currency, rate: number): number {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return roundCents(amount);
  if (!(rate > 0)) throw new Error("A positive exchange rate is required");
  return from === "USD" ? roundCents(amount * rate) : roundCents(amount / rate);
}

/** Same as {@link convertAmount} for integer minor units (cents). */
export function convertMinor(
  amountMinor: number,
  from: Currency,
  to: Currency,
  rate: number,
): number {
  return Math.round(convertAmount(amountMinor / 100, from, to, rate) * 100);
}

const FORMATTERS: Record<Currency, Intl.NumberFormat> = {
  KES: new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }),
  USD: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

/** `"Ksh 12,950"` / `"$100.00"` with non-breaking spaces normalised. */
export function formatCurrency(amount: number, currency: Currency): string {
  return FORMATTERS[currency].format(amount).replace(/ /g, " ");
}

/** Formats `amount` in `currency` plus its approximate equivalent in the other currency. */
export function formatDual(
  amount: number,
  currency: Currency,
  rate: number | null | undefined,
): { primary: string; secondary: string | null } {
  const primary = formatCurrency(amount, currency);
  if (!rate || !(rate > 0)) return { primary, secondary: null };
  const other: Currency = currency === "KES" ? "USD" : "KES";
  return {
    primary,
    secondary: `≈ ${formatCurrency(convertAmount(amount, currency, other, rate), other)}`,
  };
}

/** Plausibility guard for provider data (KES per USD has stayed well inside this band). */
export function isPlausibleKesRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 50 && rate < 500;
}
