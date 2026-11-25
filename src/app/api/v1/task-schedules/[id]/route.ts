import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap, readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { actorCanAccessTask, canManageSchedules } from "@/lib/maintenance/access";
import { guardMutation, tasksV2Disabled } from "@/lib/maintenance/route-helpers";
import { resumeIndex, type ScheduleDoc, serializeSchedule } from "@/lib/maintenance/schedules";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { scheduleUpdate } from "@/lib/schemas/maintenance";
import { TaskSchedule } from "@/models/TaskSchedule";

async function loadSchedule(request: NextRequest, id: string) {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid schedule id" }, { status: 400 });
  const authError = await requirePermission(request, "task:manage");
  if (authError) return authError;
  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "task:manage");
  if (actor instanceof NextResponse) return actor;
  if (!canManageSchedules(actor)) {
    return NextResponse.json(
      { error: "Only owners, admins and custodians manage recurring tasks" },
      { status: 403 },
    );
  }
  const schedule = (await TaskSchedule.findById(id).lean()) as ScheduleDoc | null;
  if (!schedule || !actorCanAccessTask(actor, schedule)) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  return { actor, schedule };
}

/** Pause or resume. Resuming skips occurrences that fell inside the pause. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;
  const loaded = await loadSchedule(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const { schedule } = loaded;

  const parsed = scheduleUpdate.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (parsed.data.isActive) {
    const { index, next } = resumeIndex(schedule);
    if (!next) {
      return NextResponse.json({ error: "This schedule has already finished" }, { status: 409 });
    }
    await TaskSchedule.updateOne(
      { _id: id },
      { $set: { isActive: true, occurrencesCreated: index, nextRunDate: next } },
    );
  } else {
    await TaskSchedule.updateOne({ _id: id }, { $set: { isActive: false } });
  }
  const fresh = (await TaskSchedule.findById(id).lean()) as ScheduleDoc;
  const titles = await propertyTitleMap([fresh.propertyId]);
  return NextResponse.json({ data: serializeSchedule(fresh, titles) });
}

/** Deletes the schedule. Tasks it already created are kept. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;
  const loaded = await loadSchedule(request, id);
  if (loaded instanceof NextResponse) return loaded;
  await TaskSchedule.deleteOne({ _id: id });
  return NextResponse.json({ data: { id } });
}
