import { z } from "zod";
import type { BidTerms } from "@/lib/broker-bids";

const id = z.string().trim().min(1).max(64);

/** Terms as typed in the UI: a percentage, or a fixed amount in KES or USD. */
export const bidTermsInput = z
  .object({
    basis: z.enum(["first_month_rent", "percentage_of_rent", "fixed"]),
    /** 0–100 for percentage bases. */
    ratePercent: z.coerce.number().finite().min(0).max(100).optional(),
    /** Major units for the fixed basis. */
    fixedAmount: z.coerce.number().finite().min(0).max(100_000_000).optional(),
    currency: z.enum(["KES", "USD"]).optional().default("KES"),
    message: z.string().trim().max(1000).optional().default(""),
  })
  .refine((t) => (t.basis === "fixed" ? (t.fixedAmount ?? 0) > 0 : (t.ratePercent ?? 0) > 0), {
    message: "Enter the commission",
    path: ["ratePercent"],
  });

export type BidTermsInput = z.infer<typeof bidTermsInput>;

export function toBidTerms(input: BidTermsInput): BidTerms {
  return {
    basis: input.basis,
    rateBps: input.basis === "fixed" ? 0 : Math.round((input.ratePercent ?? 0) * 100),
    fixedAmountMinor: input.basis === "fixed" ? Math.round((input.fixedAmount ?? 0) * 100) : 0,
    currency: input.basis === "fixed" ? input.currency : "KES",
    message: input.message,
  };
}

export const bidCreateInput = z.object({ listingId: id, terms: bidTermsInput });

export const bidDecisionInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    note: z.string().trim().max(1000).optional().default(""),
  }),
  z.object({
    action: z.literal("reject"),
    note: z.string().trim().min(1, "Add a reason").max(1000),
  }),
  z.object({
    action: z.literal("counter"),
    terms: bidTermsInput,
    note: z.string().trim().max(1000).optional().default(""),
  }),
]);

export const bidResponseInput = z.object({ action: z.enum(["accept", "decline", "withdraw"]) });
