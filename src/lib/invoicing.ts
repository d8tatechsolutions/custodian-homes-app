/**
 * Stored invoice states.
 *
 * Release R1 (expand) of the invoice-state migration
 * (docs/plans/2026-11-18-tasks-invoices-table-navigation.md §2.5): `new` is
 * added alongside the legacy `pending`; every reader and guard treats the two
 * as the same "issued, awaiting payment" state (shown as **Unpaid**). Writers
 * keep emitting `pending` until R3; `pending` is removed in R4.
 */
export const INVOICE_STATUSES = ["draft", "pending", "new", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type DerivedInvoiceStatus = InvoiceStatus | "overdue";

/** Issued, awaiting payment. `pending` (legacy) and `new` are equivalent. */
export const OPEN_INVOICE_STATUSES = ["pending", "new"] as const;
export type OpenInvoiceStatus = (typeof OPEN_INVOICE_STATUSES)[number];

/** The status writers emit for an issued invoice in this release (R1). */
export const ISSUED_INVOICE_STATUS: OpenInvoiceStatus = "pending";

export function isOpenInvoiceStatus(status: string): status is OpenInvoiceStatus {
  return (OPEN_INVOICE_STATUSES as readonly string[]).includes(status);
}

/** User-facing labels. Never show the raw `new` / `pending` values. */
export const INVOICE_STATUS_LABELS: Record<DerivedInvoiceStatus, string> = {
  draft: "Draft",
  pending: "Unpaid",
  new: "Unpaid",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status as DerivedInvoiceStatus] ?? status;
}

/**
 * Mongo status filter for a list `status` query parameter. `pending`/`new`
 * (and the UI key `unpaid`) match both open states; `overdue` is open and
 * past due. Returns null for no filter.
 */
export function invoiceStatusFilter(
  status: string | null | undefined,
  now: Date,
): Record<string, unknown> | null {
  if (!status) return null;
  if (status === "overdue") {
    return { status: { $in: [...OPEN_INVOICE_STATUSES] }, dueDate: { $lt: now } };
  }
  if (status === "pending" || status === "new" || status === "unpaid") {
    return { status: { $in: [...OPEN_INVOICE_STATUSES] } };
  }
  return { status };
}

export const INVOICE_METHODS = ["M-Pesa", "Card", "Bank", "Cash", "Cheque", "Other"] as const;
export type InvoiceMethod = (typeof INVOICE_METHODS)[number];

/** Matches a UTC calendar month identifier, e.g. `"2026-09"`. */
export const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Throws a `RangeError` when `period` is not a well-formed `"YYYY-MM"` string.
 * All date helpers and the numbering helper validate through this single gate
 * so malformed input fails before any state (e.g. a counter) is touched.
 */
export function assertValidPeriod(period: string): void {
  if (!PERIOD_REGEX.test(period)) {
    throw new RangeError(`Invalid period "${period}". Expected "YYYY-MM".`);
  }
}

function parsePeriod(period: string): { year: number; month: number } {
  assertValidPeriod(period);
  return { year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) };
}

/**
 * Inclusive UTC range for the calendar month: `start` is the first instant of
 * the month and `end` is the last millisecond of the last day of the month.
 */
export function periodRange(period: string): { start: Date; end: Date } {
  const { year, month } = parsePeriod(period);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1) - 1);
  return { start, end };
}

/** Day-of-month of the last day of `period` (handles leap years and 30/31-day months). */
export function lastDayOf(period: string): number {
  return periodRange(period).end.getUTCDate();
}

/** Due date locked at the 5th of the month AFTER `period`, in UTC. */
export function computeDueDate(period: string): Date {
  const { year, month } = parsePeriod(period);
  return new Date(Date.UTC(year, month, 5));
}

/**
 * Boundary-inclusive check: a lease is active within the period when it started
 * on or before the period end and either has no end date or ends on or after
 * the period start.
 */
export function isLeaseActiveForPeriod(
  lease: { startDate: Date; endDate?: Date | null },
  periodStart: Date,
  periodEnd: Date,
): boolean {
  return (
    lease.startDate.getTime() <= periodEnd.getTime() &&
    (lease.endDate == null || lease.endDate.getTime() >= periodStart.getTime())
  );
}

/**
 * Returns the stored status unchanged except for an open (`pending` or `new`)
 * invoice whose due date has passed, which derives as `"overdue"`. `draft`,
 * `paid` and `void` are never flipped. `overdue` is derived at read time and
 * never stored.
 */
export function deriveStatus(
  invoice: { status: string; dueDate: Date },
  now: Date,
): DerivedInvoiceStatus {
  if (isOpenInvoiceStatus(invoice.status) && invoice.dueDate.getTime() < now.getTime()) {
    return "overdue";
  }
  return invoice.status as InvoiceStatus;
}

export interface SerializeInvoiceOptions {
  /**
   * Include the staff-only itemized service-fee snapshot. Defaults to false so
   * tenant-facing routes never leak item labels or individual amounts.
   */
  includeServiceFeeItems?: boolean;
}

/**
 * Shallow copies an invoice doc, normalizing `status` through `deriveStatus`
 * and appending a derived `overdue` boolean. All original fields are kept
 * except `serviceFeeItems`, which is stripped unless explicitly requested.
 */
export function serializeInvoice<T extends { status: string; dueDate: Date }>(
  doc: T,
  now: Date,
  options: SerializeInvoiceOptions = {},
): T & { status: DerivedInvoiceStatus; overdue: boolean } {
  const status = deriveStatus(doc, now);
  const serialized = { ...doc, status, overdue: status === "overdue" };
  if (!options.includeServiceFeeItems) {
    delete (serialized as { serviceFeeItems?: unknown }).serviceFeeItems;
  }
  return serialized;
}

/** `"YYYY-MM"` of `now` in UTC (e.g. September 2026 -> `"2026-09"`). */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// State-machine guards. Derived "overdue" is treated as its stored open
// status so mark-paid/void stay legal on serialized (overdue) invoices; only
// "draft" is deletable.
//
// Drafts are templates: never payable, never visible to tenants. A draft must
// be issued (number + issue date assigned) before a payment can be recorded.

export function canMarkPaid(status: DerivedInvoiceStatus): boolean {
  return isOpenInvoiceStatus(status) || status === "overdue";
}

/** Only a draft can be issued (draft -> unpaid). */
export function canIssue(status: DerivedInvoiceStatus): boolean {
  return status === "draft";
}

/**
 * Online payment guard — deliberately narrower than `canMarkPaid`: only a
 * stored `pending` invoice with zero balance is payable online (drafts are not
 * payable online, and a partially-paid invoice has no full-settlement charge
 * path in this round).
 */
export function canPayOnline(invoice: { status: string; amountPaid: number }): boolean {
  return isOpenInvoiceStatus(invoice.status) && invoice.amountPaid === 0;
}

/**
 * `draft -> void` stays tolerated in this release (not offered in the UI);
 * see plan §2.1.
 */
export function canVoid(status: DerivedInvoiceStatus): boolean {
  return status === "draft" || isOpenInvoiceStatus(status) || status === "overdue";
}

export function canDelete(status: DerivedInvoiceStatus): boolean {
  return status === "draft";
}

export type ManualPaymentResolution =
  | { ok: true; amountPaid: number; status: "paid" | OpenInvoiceStatus }
  | { ok: false; reason: "already-settled" | "exceeds-balance" };

/**
 * Resolves a manual (offline) payment against an invoice. `requestedAmount`
 * omitted settles the full remaining balance; a smaller amount records a
 * partial payment that keeps the invoice open (its current `pending`/`new`
 * status is preserved) until the balance reaches `amountDue`. Amounts above
 * the outstanding balance are rejected so `amountPaid` can never exceed
 * `amountDue`.
 */
export function resolveManualPayment(
  invoice: { amountDue: number; amountPaid?: number | null; status?: string },
  requestedAmount?: number,
): ManualPaymentResolution {
  const alreadyPaid = invoice.amountPaid ?? 0;
  const remaining = invoice.amountDue - alreadyPaid;
  if (remaining <= 0) return { ok: false, reason: "already-settled" };

  const amount = requestedAmount ?? remaining;
  if (amount > remaining) return { ok: false, reason: "exceeds-balance" };

  const amountPaid = alreadyPaid + amount;
  const openStatus: OpenInvoiceStatus =
    invoice.status === "new"
      ? "new"
      : invoice.status === "pending"
        ? "pending"
        : ISSUED_INVOICE_STATUS;
  return { ok: true, amountPaid, status: amountPaid >= invoice.amountDue ? "paid" : openStatus };
}

/** True when `period` is after the current UTC month (future billing is rejected). */
export function isFuturePeriod(period: string, now: Date = new Date()): boolean {
  assertValidPeriod(period);
  return period > currentPeriod(now);
}

/**
 * Parses a due date from `<input type="date">` (`YYYY-MM-DD`, read as a UTC
 * calendar day) or a full ISO datetime. Returns null when invalid.
 */
export function parseDueDate(value: string): Date | null {
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dayOnly
    ? new Date(Date.UTC(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3])))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolves and validates the due date for a billed month: defaults to the 5th
 * of the following month and must not fall before the billed month starts.
 */
export function resolveDueDate(
  period: string,
  dueDate?: string | null,
): { ok: true; dueDate: Date } | { ok: false; error: string } {
  if (!dueDate) return { ok: true, dueDate: computeDueDate(period) };
  const parsed = parseDueDate(dueDate);
  if (!parsed) return { ok: false, error: "Due date must be a valid date" };
  if (parsed.getTime() < periodRange(period).start.getTime()) {
    return { ok: false, error: "Due date cannot be before the billed month" };
  }
  return { ok: true, dueDate: parsed };
}
