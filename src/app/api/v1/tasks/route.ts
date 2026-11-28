import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { DashboardActor } from "@/app/api/v1/_helpers";
import { propertyTitleMap, readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { TASK_STATUSES } from "@/lib/domain-enums";
import { isTasksV2Enabled } from "@/lib/feature-flags";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { ownerFallbackAssignee, resolveAssignee } from "@/lib/maintenance/assignee";
import { nairobiToday } from "@/lib/maintenance/dates";
import { ACTIVE_TASK_STATUSES, TASK_STATUSES_V2 } from "@/lib/maintenance/enums";
import { loadTaskLocation } from "@/lib/maintenance/location-loader";
import { type NoticeTask, notifyTaskAssigned, notifyVendorJob } from "@/lib/maintenance/notify";
import { serializeTaskV2, type TaskDoc } from "@/lib/maintenance/route-helpers";
import { connectToDatabase } from "@/lib/mongoose";
import { buildPaginationResult, parsePagination } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { taskV2CreateFields } from "@/lib/schemas/maintenance";
import { type TaskInput, taskInput } from "@/lib/schemas/task";
import { serializeTask } from "@/lib/tasks";
import { Complaint } from "@/models/Complaint";
import { Property } from "@/models/Property";
import { Task } from "@/models/Task";
import { User } from "@/models/User";

/**
 * Create-scope predicate for tasks (plan §1.2). Tasks are property-scoped only
 * (no `blockId`/`unitId`), so admins are checked against their property-scoped
 * delegations (`propertyScopeIds`) while caretakers/custodians are checked
 * against their action-filtered assignments (`assignedPropertyIds`). The
 * asymmetry is deliberate — do not harmonize it.
 */
function canCreateTaskOnProperty(
  actor: DashboardActor,
  propertyId: string,
  propertyOwnerId: string,
): boolean {
  switch (actor.role) {
    case "system-admin":
      return true;
    case "admin":
      return propertyOwnerId === actor.userId || actor.propertyScopeIds.includes(propertyId);
    case "caretaker":
      return actor.assignedPropertyIds.includes(propertyId);
    case "custodian":
      return (
        actor.assignedPropertyIds.includes(propertyId) && propertyOwnerId === actor.managedByOwnerId
      );
    default:
      return false;
  }
}

/**
 * Loads the one property a task is being written against. Missing or
 * soft-deleted targets are an input error (400), not an authorization failure,
 * and a property without an owner can never yield a valid task owner.
 */
async function loadTaskTargetProperty(
  propertyId: string,
): Promise<{ ownerId: string } | NextResponse> {
  const property = await Property.findOne({ _id: propertyId, deletedAt: null })
    .select("ownerId")
    .lean();
  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 400 });
  }
  const ownerId = property.ownerId ? String(property.ownerId) : "";
  if (!ownerId) {
    return NextResponse.json({ error: "Property has no owner" }, { status: 400 });
  }
  return { ownerId };
}

export async function GET(request: NextRequest) {
  const { page, limit } = parsePagination({
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  const skip = (page - 1) * limit;
  const status = request.nextUrl.searchParams.get("status");
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  const assignedTo = request.nextUrl.searchParams.get("assignedTo");

  const v2 = isTasksV2Enabled();
  const knownStatuses: readonly string[] = v2 ? TASK_STATUSES_V2 : TASK_STATUSES;
  if (status && !knownStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid task status" }, { status: 400 });
  }

  const authError = await requirePermission(request, "task:read-own");
  if (authError) return authError;

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "task:read-own");
  if (actor instanceof NextResponse) return actor;

  // Owner-scoped admin reads (plan §1.3): own tasks unioned with the active
  // delegated property scope; an empty delegated scope narrows to own tasks
  // only, so no admin/system-admin list is ever unfiltered. Every clause is
  // composed with $and — query params may narrow the scope, never overwrite it.
  const clauses: Record<string, unknown>[] = [];
  if (actor.role === "caretaker") {
    if (actor.assignedPropertyIds.length === 0) {
      return NextResponse.json(buildPaginationResult([], 0, page, limit));
    }
    clauses.push({ ownerId: actor.managedByOwnerId });
    clauses.push({ propertyId: { $in: actor.assignedPropertyIds } });
  } else if (actor.role === "custodian") {
    clauses.push({ ownerId: actor.managedByOwnerId });
  } else if (actor.role === "admin" || actor.role === "system-admin") {
    if (actor.propertyScopeIds.length > 0) {
      clauses.push({
        $or: [{ ownerId: actor.userId }, { propertyId: { $in: actor.propertyScopeIds } }],
      });
    } else {
      clauses.push({ ownerId: actor.userId });
    }
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (status) clauses.push({ status });
  if (propertyId) clauses.push({ propertyId });
  if (assignedTo) clauses.push({ assignedTo });
  if (v2) {
    // v2 list filters; they only ever narrow the scope clauses above.
    const params = request.nextUrl.searchParams;
    const category = params.get("category");
    const complaintId = params.get("complaintId");
    const assigneeKind = params.get("assigneeKind");
    if (category) clauses.push({ category });
    if (complaintId) clauses.push({ complaintIds: complaintId });
    if (assigneeKind === "vendor" || assigneeKind === "staff") {
      clauses.push({ "assignee.kind": assigneeKind });
    }
    if (params.get("active") === "1") clauses.push({ status: { $in: [...ACTIVE_TASK_STATUSES] } });
    if (params.get("overdue") === "1") {
      clauses.push({ status: { $in: [...ACTIVE_TASK_STATUSES] } });
      clauses.push({ dueDate: { $lt: nairobiToday(), $gt: "" } });
    }
  }
  const filter: Record<string, unknown> = clauses.length === 1 ? clauses[0] : { $and: clauses };

  const [tasks, total] = await Promise.all([
    Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Task.countDocuments(filter),
  ]);
  const titles = await propertyTitleMap(tasks.map((t) => t.propertyId));

  return NextResponse.json(
    buildPaginationResult(
      tasks.map((t) => (v2 ? serializeTaskV2(t as TaskDoc, titles) : serializeTask(t, titles))),
      total,
      page,
      limit,
    ),
  );
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const authError = await requirePermission(request, "task:create");
  if (authError) return authError;

  const body = await readJsonBody(request);
  const v2 = isTasksV2Enabled();
  const parsed = taskInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid task payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "task:create");
  if (actor instanceof NextResponse) return actor;

  // POST is a scoped write (plan §1.2): the target property is resolved once and
  // reused for both the scope check and the owner derivation. `managedByOwnerId`
  // is "" for admins, so no fallback may ever silently produce an empty owner.
  let propertyId = parsed.data.propertyId;
  let ownerId = "";

  if (propertyId) {
    const property = await loadTaskTargetProperty(propertyId);
    if (property instanceof NextResponse) return property;
    if (!canCreateTaskOnProperty(actor, propertyId, property.ownerId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    ownerId = property.ownerId;
  } else if (actor.role === "admin" || actor.role === "system-admin") {
    ownerId = actor.userId;
  } else if (actor.role === "caretaker" || actor.role === "custodian") {
    // Without an explicit property, staff may only derive one when their
    // action-filtered scope is unambiguous.
    if (actor.assignedPropertyIds.length !== 1) {
      return NextResponse.json({ error: "A property must be specified" }, { status: 400 });
    }
    const [scopedPropertyId] = actor.assignedPropertyIds;
    const property = await loadTaskTargetProperty(scopedPropertyId);
    if (property instanceof NextResponse) return property;
    if (!canCreateTaskOnProperty(actor, scopedPropertyId, property.ownerId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    propertyId = scopedPropertyId;
    ownerId = property.ownerId;
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const creator = await User.findById(actor.userId).select("name").lean();

  if (v2) {
    return createTaskV2(body, parsed.data, actor, {
      propertyId,
      ownerId,
      creatorName: (creator as { name?: string } | null)?.name ?? "",
    });
  }

  // Left unassigned on a property nobody manages: the owner receives it.
  const ownerFallback = parsed.data.assignedTo
    ? null
    : await ownerFallbackAssignee(propertyId, ownerId);
  const task = await Task.create({
    title: parsed.data.title,
    propertyId,
    priority: parsed.data.priority,
    status: parsed.data.status,
    assignedTo: ownerFallback ? ownerFallback.assignedTo : (parsed.data.assignedTo ?? ""),
    assignedToName: ownerFallback
      ? ownerFallback.assignedToName
      : (parsed.data.assignedToName ?? ""),
    createdBy: actor.userId,
    createdByRole: actor.role,
    createdByName: (creator as { name?: string } | null)?.name ?? "",
    ownerId,
    dueDate: parsed.data.dueDate,
    notes: parsed.data.notes ?? "",
  });

  const titles = await propertyTitleMap([task.propertyId]);
  return NextResponse.json({ data: serializeTask(task.toObject(), titles) }, { status: 201 });
}

/**
 * Tasks & Maintenance v2 create: validates location, assignee (caretakers are
 * always assigned to themselves), linked complaints and "before" photos, then
 * links complaints both ways and records the first history entry.
 */
async function createTaskV2(
  body: unknown,
  base: TaskInput,
  actor: DashboardActor,
  target: { propertyId: string; ownerId: string; creatorName: string },
): Promise<NextResponse> {
  const extra = taskV2CreateFields.safeParse(body ?? {});
  if (!extra.success) {
    return NextResponse.json(
      { error: "Invalid task payload", issues: extra.error.flatten() },
      { status: 400 },
    );
  }
  const { propertyId, ownerId } = target;

  const location = await loadTaskLocation(propertyId, extra.data.location);
  if ("error" in location) return NextResponse.json({ error: location.error }, { status: 400 });

  const requestedAssignee =
    actor.role === "caretaker"
      ? { kind: "staff" as const, userId: actor.userId }
      : (extra.data.assignee ?? null);
  const resolved = await resolveAssignee(actor, requestedAssignee, propertyId, ownerId);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
  // Left unassigned on a property nobody manages: the owner receives it.
  const assignee = resolved.assignee
    ? resolved
    : ((await ownerFallbackAssignee(propertyId, ownerId)) ?? resolved);

  const complaintIds = [...new Set(extra.data.complaintIds)];
  if (complaintIds.length > 0) {
    const found = await Complaint.countDocuments({
      _id: { $in: complaintIds },
      ownerId,
      propertyId,
    });
    if (found !== complaintIds.length) {
      return NextResponse.json(
        { error: "A linked complaint is not on this property" },
        { status: 400 },
      );
    }
  }

  const uploadedAt = new Date();
  const task = await Task.create({
    title: base.title,
    propertyId,
    ownerId,
    priority: base.priority,
    status: "open",
    dueDate: base.dueDate,
    notes: base.notes ?? "",
    createdBy: actor.userId,
    createdByRole: actor.role,
    createdByName: target.creatorName,
    category: extra.data.category,
    location,
    assignee: assignee.assignee,
    assignedTo: assignee.assignedTo,
    assignedToName: assignee.assignedToName,
    scheduledFor: extra.data.scheduledFor ?? "",
    complaintIds,
    photosBefore: extra.data.photosBefore.map((m) => ({
      ...m,
      kind: "image",
      uploadedBy: actor.userId,
      uploadedAt,
    })),
  });

  if (complaintIds.length > 0) {
    await Complaint.updateMany(
      { _id: { $in: complaintIds } },
      { $addToSet: { taskIds: String(task._id) } },
    );
  }
  const who = { userId: actor.userId, role: actor.role, name: target.creatorName };
  await recordTaskActivity(
    task,
    who,
    "created",
    assignee.assignee
      ? `Created and assigned to ${assignee.assignedToName || "someone"}`
      : "Created",
    { complaintIds },
  );
  const created = task.toObject() as NoticeTask;
  if (assignee.assignee?.kind === "staff") await notifyTaskAssigned(created, who);
  // A new task has no quote yet, so a service provider can be told straight away.
  if (assignee.assignee?.kind === "vendor") await notifyVendorJob(created, who, "assigned");

  const titles = await propertyTitleMap([propertyId]);
  return NextResponse.json(
    { data: serializeTaskV2(task.toObject() as TaskDoc, titles) },
    { status: 201 },
  );
}
