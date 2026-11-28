import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody, resolveInvoiceActor } from "@/app/api/v1/_helpers";
import { invoiceInScope } from "@/app/api/v1/invoices/_scope";
import { recordInvoiceAudit } from "@/lib/audit-records";
import { canDelete, isFuturePeriod, resolveDueDate, serializeInvoice } from "@/lib/invoicing";
import { connectToDatabase } from "@/lib/mongoose";
import { asSoftDeleteModel } from "@/lib/mongoose-soft-delete";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { invoiceUpdate } from "@/lib/schemas";
import { Invoice } from "@/models/Invoice";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
  }

  const authError = await requirePermission(request, "invoice:read");
  if (authError) return authError;

  await connectToDatabase();

  const actor = await resolveInvoiceActor(request, "invoice:read");
  if (actor instanceof NextResponse) return actor;

  const invoice = await Invoice.findById(id).lean();
  if (!invoice || !invoiceInScope(invoice, actor)) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: serializeInvoice(invoice, new Date(), { includeServiceFeeItems: true }),
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  // Drafts are the only editable state: an issued invoice is immutable
  // (record a payment or void it instead).
  if (invoice.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft invoices can be edited. Issued invoices can be paid or voided." },
      { status: 409 },
    );
  }

  const body = await readJsonBody(request);
  const parsed = invoiceUpdate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid invoice payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.status !== undefined && parsed.data.status !== "draft") {
    return NextResponse.json(
      { error: "Use Issue to issue a draft; status cannot be changed by editing" },
      { status: 409 },
    );
  }

  const period = parsed.data.period ?? invoice.period;
  if (parsed.data.period !== undefined && isFuturePeriod(period)) {
    return NextResponse.json({ error: "Cannot bill a future month" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.period !== undefined) updateData.period = period;
  if (parsed.data.dueDate !== undefined || parsed.data.period !== undefined) {
    const due = resolveDueDate(period, parsed.data.dueDate);
    if (!due.ok) return NextResponse.json({ error: due.error }, { status: 400 });
    updateData.dueDate = due.dueDate;
  }
  const amountDue = parsed.data.amountDue ?? invoice.amountDue;
  if (parsed.data.amountDue !== undefined) updateData.amountDue = amountDue;
  if (parsed.data.serviceChargeAmount !== undefined || parsed.data.amountDue !== undefined) {
    if (invoice.leaseId) {
      if (parsed.data.serviceChargeAmount !== undefined) {
        return NextResponse.json(
          { error: "The service charge is derived from the lease's unit" },
          { status: 400 },
        );
      }
      // Lease drafts keep their snapshot split; scale rent to the new total.
      const serviceCharge = Math.min(invoice.serviceChargeAmount ?? 0, amountDue);
      updateData.serviceChargeAmount = serviceCharge;
      updateData.rentAmount = amountDue - serviceCharge;
    } else {
      const serviceCharge =
        parsed.data.serviceChargeAmount ?? Math.min(invoice.serviceChargeAmount ?? 0, amountDue);
      if (serviceCharge > amountDue) {
        return NextResponse.json(
          { error: "Service charge cannot exceed the amount due" },
          { status: 400 },
        );
      }
      updateData.serviceChargeAmount = serviceCharge;
      updateData.rentAmount = amountDue - serviceCharge;
    }
  }
  if (parsed.data.method !== undefined) updateData.method = parsed.data.method;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  // Guarded on draft so a concurrent issue cannot be overwritten.
  const updated = await Invoice.findOneAndUpdate({ _id: id, status: "draft" }, updateData, {
    returnDocument: "after",
    runValidators: true,
  }).lean();
  if (!updated) {
    return NextResponse.json(
      { error: "The invoice was issued by another request; reload and try again" },
      { status: 409 },
    );
  }
  await recordInvoiceAudit(
    request,
    { userId: actor.userId, role: actor.role },
    "invoice.updated",
    invoice,
    invoice,
    updated,
  );

  return NextResponse.json({
    data: serializeInvoice(updated, new Date(), { includeServiceFeeItems: true }),
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  if (!canDelete(invoice.status)) {
    return NextResponse.json({ error: "Only draft invoices can be deleted" }, { status: 409 });
  }

  await asSoftDeleteModel(Invoice).softDeleteById(id);
  await recordInvoiceAudit(
    request,
    { userId: actor.userId, role: actor.role },
    "invoice.deleted",
    invoice,
    invoice,
    null,
  );

  return NextResponse.json({ message: "Invoice deleted" });
}
