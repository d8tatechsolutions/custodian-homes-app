import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { billingFieldsFromAccount, resolveBillingAccountForOwner } from "@/lib/billing-accounts";
import { formatKES } from "@/lib/format";
import { computeDueDate, currentPeriod } from "@/lib/invoicing";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { actualCost } from "@/lib/maintenance/costs";
import { guardMutation, loadScopedTask, respondWithTask } from "@/lib/maintenance/route-helpers";
import { requirePermission } from "@/lib/permissions";
import { billTenantInput } from "@/lib/schemas/maintenance";
import { Complaint } from "@/models/Complaint";
import { Invoice } from "@/models/Invoice";
import { Lease } from "@/models/Lease";
import { Task } from "@/models/Task";
import { Tenant } from "@/models/Tenant";

/**
 * "Bill to tenant": creates a DRAFT invoice for the repair (client decision
 * Q23 — staff review and issue it from Invoices; nothing is sent
 * automatically). The charge is an itemised line with rent 0 and no lease, so
 * it never blocks monthly rent generation or earns broker commission.
 *
 * The tenant is the one who reported it (linked complaint), else the active
 * lease on the task's unit. With several candidates the caller must choose.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:manage");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const invoiceAuth = await requirePermission(request, "invoice:manage");
  if (invoiceAuth) return invoiceAuth;
  if (!(actor.role === "admin" || actor.role === "custodian" || actor.role === "system-admin")) {
    return NextResponse.json(
      { error: "Only the owner or custodian can bill a tenant" },
      { status: 403 },
    );
  }

  const parsed = billTenantInput.safeParse((await readJsonBody(request)) ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (task.cost?.payer !== "tenant") {
    return NextResponse.json({ error: "Set 'Who pays' to Tenant first" }, { status: 409 });
  }
  if (task.cost?.tenantInvoiceId) {
    const existing = (await Invoice.findById(task.cost.tenantInvoiceId)
      .select("status")
      .lean()) as {
      status?: string;
    } | null;
    if (existing && existing.status !== "void") {
      return NextResponse.json(
        { error: "The tenant has already been billed for this task" },
        { status: 409 },
      );
    }
  }
  const amount = parsed.data.amount ?? actualCost(task.cost);
  if (!(amount > 0)) {
    return NextResponse.json(
      { error: "Record the actual cost (or enter an amount) first" },
      { status: 400 },
    );
  }

  // Candidate tenants: reporters first, then the unit's active lease.
  const candidates = new Set<string>();
  if (task.complaintIds?.length) {
    const complaints = (await Complaint.find({ _id: { $in: task.complaintIds } })
      .select("tenantId")
      .lean()) as { tenantId: string }[];
    for (const c of complaints) if (c.tenantId) candidates.add(String(c.tenantId));
  }
  if (candidates.size === 0 && task.location?.unitId) {
    const leases = (await Lease.find({ unitId: task.location.unitId, status: "active" })
      .select("tenantId")
      .lean()) as { tenantId: string }[];
    for (const l of leases) if (l.tenantId) candidates.add(String(l.tenantId));
  }
  let tenantId = parsed.data.tenantId ?? "";
  if (tenantId && !candidates.has(tenantId)) {
    return NextResponse.json({ error: "That tenant is not linked to this task" }, { status: 400 });
  }
  if (!tenantId) {
    if (candidates.size === 0) {
      return NextResponse.json(
        { error: "No tenant is linked to this task (link a complaint or set a unit with a lease)" },
        { status: 409 },
      );
    }
    if (candidates.size > 1) {
      return NextResponse.json(
        { error: "Choose which tenant to bill", tenantIds: [...candidates] },
        { status: 409 },
      );
    }
    [tenantId] = [...candidates];
  }

  const tenant = (await Tenant.findById(tenantId).select("ownerId propertyId name").lean()) as {
    ownerId: string;
    propertyId: string;
    name?: string;
  } | null;
  if (!tenant || tenant.ownerId !== task.ownerId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const now = new Date();
  const period = currentPeriod(now);
  const billing = billingFieldsFromAccount(await resolveBillingAccountForOwner(tenant.ownerId));
  const label = `Repair: ${task.title}`.slice(0, 120);
  const invoice = await Invoice.create({
    invoiceNumber: "",
    tenantId,
    propertyId: task.propertyId,
    leaseId: "",
    unitId: task.location?.unitId ?? "",
    ownerId: tenant.ownerId,
    billingAccountId: billing?.billingAccountId ?? "",
    billingAdminId: billing?.billingAdminId ?? "",
    billingSnapshot: billing?.billingSnapshot,
    period,
    amountDue: amount,
    amountPaid: 0,
    status: "draft",
    dueDate: computeDueDate(period),
    issuedAt: null,
    notes: `${label} (maintenance task)`,
    rentAmount: 0,
    serviceChargeAmount: amount,
    rentIncludesServiceCharge: false,
    serviceFeeItems: [{ itemId: `task:${String(task._id)}`, label, amount }],
  });

  await Task.updateOne(
    { _id: task._id },
    { $set: { "cost.tenantInvoiceId": String(invoice._id) } },
  );
  await recordTaskActivity(
    task,
    { userId: actor.userId, role: actor.role, name: actorName },
    "bill_tenant",
    `Draft invoice of ${formatKES(amount)} created for ${tenant.name ?? "the tenant"} — review and issue it from Invoices`,
    { invoiceId: String(invoice._id), tenantId, amount },
  );
  return respondWithTask(task._id, 201);
}
