"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFxRate } from "@/hooks/use-fx";
import { type Currency, convertAmount, formatCurrency, SUPPORTED_CURRENCIES } from "@/lib/fx-math";
import { cn } from "@/lib/utils";

export interface MoneyValue {
  amount: number | "";
  currency: Currency;
}

interface MoneyInputProps {
  label: string;
  value: MoneyValue;
  onChange: (value: MoneyValue) => void;
  /** Lock the currency (e.g. tenant bills are KES only). */
  currencies?: readonly Currency[];
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  min?: number;
}

/**
 * Amount + KES/USD switch with a live "≈ other currency" line, so whoever
 * types the number sees both values before saving.
 */
export function MoneyInput({
  label,
  value,
  onChange,
  currencies = SUPPORTED_CURRENCIES,
  required,
  disabled,
  hint,
  error,
  className,
  min = 0,
}: MoneyInputProps) {
  const id = useId();
  const canSwitch = currencies.length > 1;
  const { quote } = useFxRate(canSwitch);
  const other: Currency = value.currency === "KES" ? "USD" : "KES";
  const converted =
    canSwitch && quote && typeof value.amount === "number" && value.amount > 0
      ? convertAmount(value.amount, value.currency, other, quote.rate)
      : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <div className="flex gap-2">
        {canSwitch ? (
          <fieldset className="inline-flex shrink-0 rounded-full border border-input bg-background p-0.5">
            <legend className="sr-only">{`${label} currency`}</legend>
            {currencies.map((currency) => (
              <label
                key={currency}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  value.currency === currency
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${id}-currency`}
                  value={currency}
                  checked={value.currency === currency}
                  disabled={disabled}
                  onChange={() => onChange({ ...value, currency })}
                />
                {currency}
              </label>
            ))}
          </fieldset>
        ) : (
          <span className="inline-flex items-center rounded-full border border-input px-3 text-xs font-semibold text-muted-foreground">
            {value.currency}
          </span>
        )}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          step="0.01"
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          value={value.amount}
          onChange={(event) => {
            const raw = event.target.value;
            onChange({ ...value, amount: raw === "" ? "" : Number(raw) });
          }}
        />
      </div>
      {converted !== null ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          ≈ {formatCurrency(converted, other)} at 1 USD = {quote?.rate.toFixed(2)} KES
          {quote?.effectiveDate ? ` (${quote.effectiveDate})` : ""}
        </p>
      ) : null}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
