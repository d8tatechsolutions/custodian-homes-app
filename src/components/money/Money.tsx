"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFxRate, useReleaseFlags } from "@/hooks/use-fx";
import { type Currency, formatCurrency, formatDual } from "@/lib/fx-math";
import { cn } from "@/lib/utils";

interface MoneyProps {
  amount: number;
  currency?: Currency;
  /** Force the converted line on/off; defaults to the FX display flag. */
  showConverted?: boolean;
  /** Use this rate instead of today's (e.g. a payment's historical rate). */
  rate?: number;
  rateDate?: string;
  className?: string;
  layout?: "inline" | "stacked";
}

/**
 * Displays an amount with its approximate equivalent in the other currency:
 * `Ksh 12,950 · ≈ $100.21`. The tooltip shows the rate and its date.
 */
export function Money({
  amount,
  currency = "KES",
  showConverted,
  rate,
  rateDate,
  className,
  layout = "inline",
}: MoneyProps) {
  const { flags } = useReleaseFlags();
  const wantConverted = showConverted ?? flags.fxDisplay;
  const { quote } = useFxRate(wantConverted && rate === undefined);
  const effectiveRate = rate ?? quote?.rate;
  const effectiveDate = rateDate ?? quote?.effectiveDate;

  if (!wantConverted || !effectiveRate) {
    return (
      <span className={cn("tabular-nums", className)}>{formatCurrency(amount, currency)}</span>
    );
  }
  const { primary, secondary } = formatDual(amount, currency, effectiveRate);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "tabular-nums",
              layout === "stacked"
                ? "inline-flex flex-col"
                : "inline-flex flex-wrap items-baseline gap-x-1.5",
              className,
            )}
          >
            <span>{primary}</span>
            {secondary ? <span className="text-xs text-muted-foreground">{secondary}</span> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          1 USD = {effectiveRate.toFixed(2)} KES{effectiveDate ? ` · ${effectiveDate}` : ""}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Attribution required by the free rates provider; render once near converted amounts. */
export function FxAttribution({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] text-muted-foreground", className)}>
      USD amounts are approximate.{" "}
      <a
        href="https://www.exchangerate-api.com"
        target="_blank"
        rel="noopener noreferrer"
        className="underline-offset-2 hover:underline"
      >
        Rates by Exchange Rate API
      </a>
    </p>
  );
}

/**
 * Just the "≈ $100.00" line, for places that already print the KES amount.
 * Renders nothing while USD display is off or no rate is available.
 */
export function UsdHint({ amount, className }: { amount: number; className?: string }) {
  const { flags } = useReleaseFlags();
  const { quote } = useFxRate(flags.fxDisplay);
  if (!flags.fxDisplay || !quote) return null;
  const { secondary } = formatDual(amount, "KES", quote.rate);
  return secondary ? (
    <span className={cn("text-xs text-muted-foreground", className)}>{secondary}</span>
  ) : null;
}
