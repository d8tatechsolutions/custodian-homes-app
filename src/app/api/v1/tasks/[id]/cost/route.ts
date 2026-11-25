import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { formatKES } from "@/lib/format";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { emptyCost } from "@/lib/maintenance/costs";
import { TASK_PAYER_LABELS } from "@/lib/maintenance/enums";
import { guardMutation, loadScopedTask, respondWithTask } from "@/lib/maintenance/route-helpers";
import { costInput } from "@/lib/schemas/maintenance";
import { Task } from "@/models/Task";

/**
 * Records actual costs (labour, materials), who pays, and whether the vendor
 * has been paid. Anyone managing the task may enter actual costs; deciding who
 * pays and recording vendor payments is for supervisors (admin, custodian).
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:manage");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = costInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid cost details", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const supervisor =
    actor.role === "admin" || actor.role === "custodian" || actor.role === "system-admin";
  const { labourAmount, materialsAmount, payer, vendorPayment } = parsed.data;

  if ((payer !== undefined || vendorPayment !== undefined) && !supervisor) {
    return NextResponse.json(
      { error: "Only an admin or custodian can set who pays or record vendor payments" },
      { status: 403 },
    );
  }
  if (task.status === "cancelled") {
    return NextResponse.json({ error: "Reopen the task before recording costs" }, { status: 409 });
  }
  if (payer !== undefined && task.cost?.tenantInvoiceId && payer !== "tenant") {
    return NextResponse.json(
      { error: "The tenant has already been billed; void that invoice before changing who pays" },
      { status: 409 },
    );
  }

  const base = task.cost ? {} : { cost: emptyCost() };
  const set: Record<string, unknown> = {};
  const changes: string[] = [];
  if (labourAmount !== undefined) {
    set["cost.labourAmount"] = labourAmount;
    changes.push(`labour ${formatKES(labourAmount)}`);
  }
  if (materialsAmount !== undefined) {
    set["cost.materialsAmount"] = materialsAmount;
    changes.push(`materials ${formatKES(materialsAmount)}`);
  }
  if (payer !== undefined) {
    set["cost.payer"] = payer;
    changes.push(`paid by ${TASK_PAYER_LABELS[payer]}`);
  }
  if (vendorPayment !== undefined) {
    if (vendorPayment.status === "paid") {
      set["cost.vendorPayment"] = {
        status: "paid",
        paidAt: vendorPayment.paidAt ? new Date(`${vendorPayment.paidAt}T00:00:00Z`) : new Date(),
        method: vendorPayment.method,
        reference: vendorPayment.reference,
      };
      changes.push("vendor marked paid");
    } else {
      set["cost.vendorPayment"] = { status: "unpaid", paidAt: null, method: "", reference: "" };
      changes.push("vendor marked unpaid");
    }
  }
  if (changes.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Seed a complete cost block first when the task has none, then apply paths.
  if (base.cost) await Task.updateOne({ _id: task._id, cost: { $exists: false } }, { $set: base });
  await Task.updateOne({ _id: task._id }, { $set: set });

  const kind = vendorPayment !== undefined ? "vendor_payment" : "cost";
  await recordTaskActivity(
    task,
    { userId: actor.userId, role: actor.role, name: actorName },
    kind,
    `Updated costs: ${changes.join(", ")}`,
    parsed.data,
  );
  return respondWithTask(task._id);
}
