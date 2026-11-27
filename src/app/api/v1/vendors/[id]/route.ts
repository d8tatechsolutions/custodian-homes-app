import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { catalogActor, propertiesOwnedBy } from "@/lib/maintenance/catalog-helpers";
import { ACTIVE_TASK_STATUSES } from "@/lib/maintenance/enums";
import { guardMutation } from "@/lib/maintenance/route-helpers";
import { asSoftDeleteModel } from "@/lib/mongoose-soft-delete";
import { vendorUpdate } from "@/lib/schemas/maintenance";
import { Task } from "@/models/Task";
import { Vendor } from "@/models/Vendor";

async function loadOwnVendor(request: NextRequest, id: string) {
  const actor = await catalogActor(request);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "Only the owner can manage service providers" }, { status: 403 });
  }
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid service provider id" }, { status: 400 });
  const vendor = await Vendor.findOne({ _id: id, ownerId: actor.userId }).lean();
  if (!vendor) return NextResponse.json({ error: "Service provider not found" }, { status: 404 });
  return { actor, vendor };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;
  const loaded = await loadOwnVendor(request, id);
  if (loaded instanceof NextResponse) return loaded;

  const parsed = vendorUpdate.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the service provider details", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const set: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.propertyIds) {
    if (!(await propertiesOwnedBy(loaded.actor.userId, parsed.data.propertyIds))) {
      return NextResponse.json({ error: "Pick only your own properties" }, { status: 400 });
    }
    set.propertyIds = [...new Set(parsed.data.propertyIds)];
  }
  if (parsed.data.trades) set.trades = [...new Set(parsed.data.trades)];

  const updated = await Vendor.findOneAndUpdate(
    { _id: id, ownerId: loaded.actor.userId },
    { $set: set },
    {
      new: true,
      runValidators: true,
    },
  ).lean();
  // Keep the denormalised name on open tasks in step with the vendor record.
  if (parsed.data.name) {
    await Task.updateMany(
      { "assignee.vendorId": id, status: { $in: [...ACTIVE_TASK_STATUSES] } },
      { $set: { "assignee.name": parsed.data.name, assignedToName: parsed.data.name } },
    );
  }
  return NextResponse.json({ data: { ...updated, _id: id } });
}

/**
 * Removes a vendor (soft delete). Refused while the vendor still has open
 * tasks, so no job is left pointing at nobody — reassign those first.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;
  const loaded = await loadOwnVendor(request, id);
  if (loaded instanceof NextResponse) return loaded;

  const openTasks = await Task.countDocuments({
    "assignee.vendorId": id,
    status: { $in: [...ACTIVE_TASK_STATUSES] },
  });
  if (openTasks > 0) {
    return NextResponse.json(
      {
        error: `This service provider has ${openTasks} open task(s); reassign them first or mark them inactive`,
      },
      { status: 409 },
    );
  }
  await asSoftDeleteModel(Vendor).softDeleteById(id);
  return NextResponse.json({ data: { id } });
}
