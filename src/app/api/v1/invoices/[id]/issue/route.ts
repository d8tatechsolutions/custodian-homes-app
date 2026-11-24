import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  isDuplicateKeyError,
  isInvoiceNumberCollision,
  resolveInvoiceActor,
} from "@/app/api/v1/_helpers";
import { invoiceInScope } from "@/app/api/v1/invoices/_scope";
import { nextInvoiceNumber } from "@/lib/invoice-numbering";
import {
  canIssue,
  computeDueDate,
  ISSUED_INVOICE_STATUS,
  isFuturePeriod,
  serializeInvoice,
} from "@/lib/invoicing";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { Invoice } from "@/models/Invoice";

/**
 * Issue a draft template: `draft -> unpaid`.
 *
 * Reserves the invoice number atomically, stamps `issuedAt`, keeps the draft's
 * due date (or defaults it), and flips the status. Guarded on `status: "draft"`
 * so a second call (or a concurrent issue) gets 409 and never double-numbers.
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

  await connectToDatabase();
  const actor = await resolveInvoiceActor(request, "invoice:manage");
  if (actor instanceof NextResponse) return actor;

  const invoice = await Invoice.findById(id).lean();
  if (!invoice || !invoiceInScope(invoice, actor)) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const resourceAuthError = await requirePermission(request, "invoice:manage", {
    resource: invoice,
  });
  if (resourceAuthError) return resourceAuthError;

  if (!canIssue(invoice.status)) {
    return NextResponse.json({ error: "Only a draft can be issued" }, { status: 409 });
  }
  if (!(invoice.amountDue > 0)) {
    return NextResponse.json(
      { error: "Set an amount greater than zero before issuing" },
      { status: 400 },
    );
  }
  const now = new Date();
  if (isFuturePeriod(invoice.period, now)) {
    return NextResponse.json(
      { error: "Cannot issue an invoice for a future month" },
      { status: 400 },
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const invoiceNumber = await nextInvoiceNumber(invoice.ownerId, invoice.period, {
      billingAccountId: invoice.billingAccountId,
    });
    try {
      const updated = await Invoice.findOneAndUpdate(
        { _id: id, status: "draft" },
        {
          $set: {
            status: ISSUED_INVOICE_STATUS,
            invoiceNumber,
            issuedAt: now,
            dueDate: invoice.dueDate ?? computeDueDate(invoice.period),
          },
        },
        { new: true, runValidators: true },
      ).lean();
      if (!updated) {
        return NextResponse.json({ error: "This draft was already issued" }, { status: 409 });
      }
      return NextResponse.json({
        data: serializeInvoice(updated, now, { includeServiceFeeItems: true }),
      });
    } catch (error) {
      if (isInvoiceNumberCollision(error)) continue;
      if (isDuplicateKeyError(error)) {
        return NextResponse.json(
          { error: "An invoice for this lease and month has already been issued" },
          { status: 409 },
        );
      }
      throw error;
    }
  }

  return NextResponse.json({ error: "Could not reserve a unique invoice number" }, { status: 409 });
}
