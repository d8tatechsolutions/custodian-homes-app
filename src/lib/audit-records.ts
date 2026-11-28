import mongoose from "mongoose";
import {
  type AuditActor,
  type AuditRequestContext,
  type WriteAuditEventInput,
  writeAuditEvent,
} from "@/lib/audit";
import { connectToDatabase } from "@/lib/mongoose";

/**
 * Best-effort audit write for business actions: the action has already
 * happened, so a logging failure must never turn it into an error. Failures
 * are logged on the server.
 */
export async function recordAudit(input: WriteAuditEventInput): Promise<void> {
  try {
    await connectToDatabase();
    // Never queue a write behind a missing connection (it would stall the
    // response for the driver's buffer timeout).
    if (mongoose.connection.readyState !== 1) {
      console.warn("[audit] skipped (no database connection):", input.action);
      return;
    }
    await writeAuditEvent(input);
  } catch (error) {
    console.error("[audit] could not record", input.action, input.entityId ?? "", error);
  }
}

/** Request details kept (hashed) with an entry. */
export function auditRequest(request: Request): AuditRequestContext {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  };
}

interface InvoiceLike {
  _id?: unknown;
  invoiceNumber?: string;
  period?: string;
  status?: string;
  amountDue?: number;
  amountPaid?: number;
  dueDate?: Date | string | null;
  paidAt?: Date | string | null;
  method?: string;
  paymentReference?: string;
  propertyId?: string;
  unitId?: string;
}

/** The money fields an invoice entry records. */
export function invoiceAuditSnapshot(invoice: InvoiceLike | null | undefined) {
  if (!invoice) return null;
  return {
    invoiceNumber: invoice.invoiceNumber ?? "",
    period: invoice.period ?? "",
    status: invoice.status ?? "",
    amountDue: invoice.amountDue ?? 0,
    amountPaid: invoice.amountPaid ?? 0,
    dueDate: invoice.dueDate ?? null,
    paidAt: invoice.paidAt ?? null,
    method: invoice.method ?? "",
    paymentReference: invoice.paymentReference ?? "",
  };
}

/** Records an invoice change against the invoice's property and unit. */
export function recordInvoiceAudit(
  request: Request | null,
  actor: AuditActor,
  action: string,
  invoice: InvoiceLike,
  before: InvoiceLike | null,
  after: InvoiceLike | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const afterSnapshot = invoiceAuditSnapshot(after);
  return recordAudit({
    actor,
    action,
    entityType: "invoice",
    entityId: String(invoice._id ?? ""),
    scope: { propertyId: invoice.propertyId ?? "", unitId: invoice.unitId ?? "" },
    before: invoiceAuditSnapshot(before),
    after: afterSnapshot ? { ...afterSnapshot, ...extra } : extra,
    request: request ? auditRequest(request) : undefined,
  });
}

interface LeaseLike {
  _id?: unknown;
  propertyId?: string;
  unitId?: string;
  tenantId?: string;
  rentAmount?: number;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  status?: string;
}

function leaseSnapshot(lease: LeaseLike | null) {
  if (!lease) return null;
  return {
    rentAmount: lease.rentAmount ?? 0,
    startDate: lease.startDate ?? null,
    endDate: lease.endDate ?? null,
    status: lease.status ?? "",
  };
}

/** Records a lease change (rent, dates, status) against its property and unit. */
export function recordLeaseAudit(
  request: Request | null,
  actor: AuditActor,
  action: string,
  lease: LeaseLike,
  before: LeaseLike | null,
  after: LeaseLike | null,
): Promise<void> {
  return recordAudit({
    actor,
    action,
    entityType: "lease",
    entityId: String(lease._id ?? ""),
    scope: { propertyId: lease.propertyId ?? "", unitId: lease.unitId ?? "" },
    before: leaseSnapshot(before),
    after: leaseSnapshot(after),
    request: request ? auditRequest(request) : undefined,
  });
}
