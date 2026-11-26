import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap, readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { canManageSchedules, taskScopeFilter } from "@/lib/maintenance/access";
import { resolveAssignee } from "@/lib/maintenance/assignee";
import { nairobiToday } from "@/lib/maintenance/dates";
import { loadTaskLocation } from "@/lib/maintenance/location-loader";
import { nextRunDate } from "@/lib/maintenance/recurrence";
import { guardMutation, tasksV2Disabled } from "@/lib/maintenance/route-helpers";
import {
  generateScheduleOccurrences,
  type ScheduleDoc,
  serializeSchedule,
} from "@/lib/maintenance/schedules";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { scheduleInput } from "@/lib/schemas/maintenance";
import { Property } from "@/models/Property";
import { TaskSchedule } from "@/models/TaskSchedule";

/**
 * Recurring schedules in the caller's task scope. Listing also creates any
 * occurrence that has fallen due, so schedules work on Preview deployments
 * where the daily job never runs.
 */
export async function GET(request: NextRequest) {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  const authError = await requirePermission(request, "task:read-own");
  if (authError) return authError;
  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "task:read-own");
  if (actor instanceof NextResponse) return actor;
  const scope = taskScopeFilter(actor);
  if (!scope) return NextResponse.json({ data: [] });

  const filter: Record<string, unknown> = { ...scope };
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (propertyId) filter.propertyId = propertyId;
  let rows = (await TaskSchedule.find(filter)
    .sort({ isActive: -1, nextRunDate: 1 })
    .limit(300)
    .lean()) as ScheduleDoc[];

  const today = nairobiToday();
  const due = rows.filter((s) => s.isActive && s.nextRunDate && s.nextRunDate <= today);
  if (due.length > 0) {
    for (const s of due) await generateScheduleOccurrences(s);
    rows = (await TaskSchedule.find(filter)
      .sort({ isActive: -1, nextRunDate: 1 })
      .limit(300)
      .lean()) as ScheduleDoc[];
  }
  const titles = await propertyTitleMap(rows.map((s) => s.propertyId));
  return NextResponse.json({ data: rows.map((s) => serializeSchedule(s, titles)) });
}

/** Creates a recurring schedule (owner/admin and custodian — client decision Q26). */
export async function POST(request: NextRequest) {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  const guard = await guardMutation(request);
  if (guard) return guard;
  const authError = await requirePermission(request, "task:create");
  if (authError) return authError;
  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "task:create");
  if (actor instanceof NextResponse) return actor;
  if (!canManageSchedules(actor)) {
    return NextResponse.json(
      { error: "Only owners and custodians can set up recurring tasks" },
      { status: 403 },
    );
  }

  const parsed = scheduleInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid schedule", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const property = (await Property.findOne({ _id: input.propertyId, deletedAt: null })
    .select("ownerId")
    .lean()) as {
    ownerId?: string;
  } | null;
  const ownerId = String(property?.ownerId ?? "");
  const inScope =
    actor.role === "system-admin" ||
    (actor.role === "admin" &&
      (ownerId === actor.userId || actor.propertyScopeIds.includes(input.propertyId))) ||
    (actor.role === "custodian" &&
      ownerId !== "" &&
      ownerId === actor.managedByOwnerId &&
      actor.assignedPropertyIds.includes(input.propertyId));
  if (!property || !ownerId || !inScope) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const location = await loadTaskLocation(input.propertyId, input.location);
  if ("error" in location) return NextResponse.json({ error: location.error }, { status: 400 });
  const assignee = await resolveAssignee(actor, input.assignee ?? null, input.propertyId, ownerId);
  if ("error" in assignee) return NextResponse.json({ error: assignee.error }, { status: 400 });

  const rule = { frequency: input.frequency, interval: input.interval };
  const end = {
    kind: input.endKind,
    count: input.endKind === "count" ? (input.endCount ?? null) : null,
    until: input.endKind === "until" ? (input.endUntil ?? "") : "",
  };
  const first = nextRunDate(input.startDate, rule, end, 0);
  if (!first) {
    return NextResponse.json({ error: "This schedule would never create a task" }, { status: 400 });
  }

  const schedule = await TaskSchedule.create({
    ownerId,
    propertyId: input.propertyId,
    title: input.title,
    category: input.category,
    priority: input.priority,
    notes: input.notes,
    location,
    assignee: assignee.assignee
      ? { ...assignee.assignee }
      : { kind: "", userId: "", vendorId: "", name: "" },
    rule,
    startDate: input.startDate,
    dueAfterDays: input.dueAfterDays,
    end,
    occurrencesCreated: 0,
    nextRunDate: first,
    isActive: true,
    createdBy: actor.userId,
    createdByRole: actor.role,
  });
  // A schedule starting today (or earlier) gets its first task right away.
  await generateScheduleOccurrences(schedule.toObject() as ScheduleDoc);

  const fresh = (await TaskSchedule.findById(schedule._id).lean()) as ScheduleDoc;
  const titles = await propertyTitleMap([input.propertyId]);
  return NextResponse.json({ data: serializeSchedule(fresh, titles) }, { status: 201 });
}
