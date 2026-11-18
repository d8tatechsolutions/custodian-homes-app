import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap, readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { TASK_STATUSES } from "@/lib/domain-enums";
import { connectToDatabase } from "@/lib/mongoose";
import { buildPaginationResult, parsePagination } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { taskInput } from "@/lib/schemas/task";
import { serializeTask } from "@/lib/tasks";
import { Property } from "@/models/Property";
import { Task } from "@/models/Task";
import { User } from "@/models/User";

export async function GET(request: NextRequest) {
  const { page, limit } = parsePagination({
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  const skip = (page - 1) * limit;
  const status = request.nextUrl.searchParams.get("status");
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  const assignedTo = request.nextUrl.searchParams.get("assignedTo");

  if (status && !(TASK_STATUSES as readonly string[]).includes(status)) {
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
  const filter: Record<string, unknown> = clauses.length === 1 ? clauses[0] : { $and: clauses };

  const [tasks, total] = await Promise.all([
    Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Task.countDocuments(filter),
  ]);
  const titles = await propertyTitleMap(tasks.map((t) => t.propertyId));

  return NextResponse.json(
    buildPaginationResult(
      tasks.map((t) => serializeTask(t, titles)),
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

  // `managedByOwnerId` is "" for admins, so the fallback must be empty-aware:
  // an empty string must never become the task's owner. With a chosen property
  // the owner is derived from it; otherwise it is the managed owner or self.
  let ownerId = actor.managedByOwnerId || actor.userId;
  if (parsed.data.propertyId) {
    const [property] = await Property.find({ _id: parsed.data.propertyId })
      .select("ownerId")
      .lean();
    const propertyOwnerId = property?.ownerId ? String(property.ownerId) : "";
    ownerId = propertyOwnerId || ownerId;
  }

  const creator = await User.findById(actor.userId).select("name").lean();

  const task = await Task.create({
    title: parsed.data.title,
    propertyId: parsed.data.propertyId ?? "",
    priority: parsed.data.priority,
    status: parsed.data.status,
    assignedTo: parsed.data.assignedTo ?? "",
    assignedToName: parsed.data.assignedToName ?? "",
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
