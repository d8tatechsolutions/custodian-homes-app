"use client";

import { MoneyInput, type MoneyValue } from "@/components/money/MoneyInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Currency, formatCurrency } from "@/lib/fx-math";

export type CommissionBasis = "first_month_rent" | "percentage_of_rent" | "fixed";

/** Terms as edited in forms (major units, percent). */
export interface TermsDraft {
  basis: CommissionBasis;
  ratePercent: number | "";
  fixed: MoneyValue;
}

/** Terms as stored (basis points, minor units). */
export interface StoredTerms {
  basis: CommissionBasis;
  rateBps?: number;
  fixedAmountMinor?: number;
  currency?: string;
}

export const BASIS_LABELS: Record<CommissionBasis, string> = {
  first_month_rent: "% of the first month's rent",
  percentage_of_rent: "% of rent collected",
  fixed: "Fixed amount",
};

export const EMPTY_TERMS: TermsDraft = {
  basis: "first_month_rent",
  ratePercent: "",
  fixed: { amount: "", currency: "KES" },
};

export function termsFromStored(t: StoredTerms | null | undefined): TermsDraft {
  if (!t?.basis) return EMPTY_TERMS;
  return {
    basis: t.basis,
    ratePercent: t.basis === "fixed" ? "" : (t.rateBps ?? 0) / 100,
    fixed: {
      amount: t.basis === "fixed" ? (t.fixedAmountMinor ?? 0) / 100 : "",
      currency: (t.currency === "USD" ? "USD" : "KES") as Currency,
    },
  };
}

/** Payload for the API (`ratePercent` / `fixedAmount` / `currency`). */
export function termsPayload(d: TermsDraft) {
  return d.basis === "fixed"
    ? { basis: d.basis, fixedAmount: Number(d.fixed.amount || 0), currency: d.fixed.currency }
    : { basis: d.basis, ratePercent: Number(d.ratePercent || 0), currency: "KES" as const };
}

export function termsComplete(d: TermsDraft): boolean {
  return d.basis === "fixed"
    ? typeof d.fixed.amount === "number" && d.fixed.amount > 0
    : typeof d.ratePercent === "number" && d.ratePercent > 0 && d.ratePercent <= 100;
}

/** "10% of the first month's rent" / "Ksh 15,000 fixed" / "$100.00 fixed". */
export function describeTerms(t: StoredTerms): string {
  if (t.basis === "fixed") {
    return `${formatCurrency((t.fixedAmountMinor ?? 0) / 100, t.currency === "USD" ? "USD" : "KES")} fixed`;
  }
  const pct = ((t.rateBps ?? 0) / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 });
  return `${pct}${BASIS_LABELS[t.basis]}`;
}

interface Props {
  value: TermsDraft;
  onChange: (value: TermsDraft) => void;
  disabled?: boolean;
  /** Rent the percentage applies to, for the live preview. */
  monthlyRent?: number;
}

/** Commission basis + rate or fixed amount, with KES/USD for fixed amounts. */
export function CommissionTermsFields({ value, onChange, disabled, monthlyRent }: Props) {
  const preview =
    value.basis !== "fixed" &&
    monthlyRent &&
    typeof value.ratePercent === "number" &&
    value.ratePercent > 0
      ? (monthlyRent * value.ratePercent) / 100
      : null;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Commission type</Label>
        <Select
          value={value.basis}
          disabled={disabled}
          onValueChange={(basis) => onChange({ ...value, basis: basis as CommissionBasis })}
        >
          <SelectTrigger aria-label="Commission type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(BASIS_LABELS) as CommissionBasis[]).map((b) => (
              <SelectItem key={b} value={b}>
                {BASIS_LABELS[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {value.basis === "fixed" ? (
        <MoneyInput
          label="Amount"
          value={value.fixed}
          disabled={disabled}
          onChange={(fixed) => onChange({ ...value, fixed })}
          hint="Agreed in USD? It is paid in KES at the rate on the payout day."
        />
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="terms-rate">Rate (%)</Label>
          <Input
            id="terms-rate"
            type="number"
            min={0}
            max={100}
            step="0.5"
            inputMode="decimal"
            disabled={disabled}
            value={value.ratePercent}
            onChange={(e) =>
              onChange({
                ...value,
                ratePercent: e.target.value === "" ? "" : Number(e.target.value),
              })
            }
          />
          {preview !== null ? (
            <p className="text-xs text-muted-foreground">
              About {formatCurrency(preview, "KES")} on a rent of{" "}
              {formatCurrency(monthlyRent ?? 0, "KES")}
              {value.basis === "percentage_of_rent" ? " per month collected" : ""}.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
