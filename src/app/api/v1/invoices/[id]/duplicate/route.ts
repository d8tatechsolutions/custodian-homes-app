import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody, resolveInvoiceActor } from "@/app/api/v1/_helpers";
import { invoiceInScope } from "@/app/api/v1/invoices/_scope";
import { computeDueDate, isFuturePeriod, serializeInvoice } from "@/lib/invoicing";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { invoiceDuplicateInput } from "@/lib/schemas";
import { Invoice } from "@/models/Invoice";

/**
 * Clone an invoice (draft or issued) into a new draft template.
 *
 * Amounts, split, source and notes are copied; the billed month is the one
 * supplied (or the source's), the due date resets to that month's default, and
 * the copy carries no number, no issue date and no payment — it is a draft.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
  }

  const authError = await requirePermission(request, "invoice:manage");
  if (authError) return authError;

  const body = await readJsonBody(request);
  const parsed = invoiceDuplicateInput.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid duplicate payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const actor = await resolveInvoiceActor(request, "invoice:manage");
  if (actor instanceof NextResponse) return actor;

  const source = await Invoice.findById(id).lean();
  if (!source || !invoiceInScope(source, actor)) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const resourceAuthError = await requirePermission(request, "invoice:manage", {
    resource: source,
  });
  if (resourceAuthError) return resourceAuthError;

  const now = new Date();
  const period = parsed.data.period ?? source.period;
  if (isFuturePeriod(period, now)) {
    return NextResponse.json({ error: "Cannot bill a future month" }, { status: 400 });
  }

  const copy = await Invoice.create({
    invoiceNumber: "",
    tenantId: source.tenantId,
    propertyId: source.propertyId,
    leaseId: source.leaseId ?? "",
    unitId: source.unitId ?? "",
    ownerId: source.ownerId,
    billingAccountId: source.billingAccountId ?? "",
    billingAdminId: source.billingAdminId ?? "",
    billingSnapshot: source.billingSnapshot,
    period,
    amountDue: source.amountDue,
    amountPaid: 0,
    status: "draft",
    dueDate: computeDueDate(period),
    issuedAt: null,
    notes: source.notes,
    rentAmount: source.rentAmount ?? source.amountDue,
    serviceChargeAmount: source.serviceChargeAmount ?? 0,
    rentIncludesServiceCharge: source.rentIncludesServiceCharge ?? false,
    serviceFeeItems: source.serviceFeeItems ?? [],
  });

  const created = await Invoice.findById(copy._id).lean();
  if (!created) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  return NextResponse.json(
    { data: serializeInvoice(created, now, { includeServiceFeeItems: true }) },
    { status: 201 },
  );
}
