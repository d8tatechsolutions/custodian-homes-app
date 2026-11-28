import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap, readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { isTasksV2Enabled } from "@/lib/feature-flags";
import { loadTaskLocation } from "@/lib/maintenance/location-loader";
import { serializeTaskV2, type TaskDoc } from "@/lib/maintenance/route-helpers";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { taskV2UpdateFields } from "@/lib/schemas/maintenance";
import { taskUpdate } from "@/lib/schemas/task";
import { serializeTask } from "@/lib/tasks";
import { Complaint } from "@/models/Complaint";
import { Task } from "@/models/Task";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  const authError = await requirePermission(request, "task:read-own");
  if (authError) return authError;

  await connectToDatabase();
  const task = await Task.findById(id).lean();
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const actor = await resolveDashboardActor(request, "task:read-own");
  if (actor instanceof NextResponse) return actor;

  if (actor.role === "caretaker" && !actor.assignedPropertyIds.includes(task.propertyId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (actor.role === "custodian" && task.ownerId !== actor.managedByOwnerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Admins are owner-scoped (plan §1.3): own tasks, or tasks on a property
  // covered by an active delegated assignment for this action.
  if (
    actor.role === "admin" &&
    task.ownerId !== actor.userId &&
    !actor.propertyScopeIds.includes(task.propertyId)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const titles = await propertyTitleMap([task.propertyId]);
  return NextResponse.json({
    data: isTasksV2Enabled()
      ? serializeTaskV2(task as TaskDoc, titles)
      : serializeTask(task, titles),
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  const authError = await requirePermission(request, "task:manage");
  if (authError) return authError;

  await connectToDatabase();
  const task = await Task.findById(id).lean();
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const actor = await resolveDashboardActor(request, "task:manage");
  if (actor instanceof NextResponse) return actor;

  if (actor.role === "caretaker" && !actor.assignedPropertyIds.includes(task.propertyId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (actor.role === "custodian" && task.ownerId !== actor.managedByOwnerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (
    actor.role === "admin" &&
    task.ownerId !== actor.userId &&
    !actor.propertyScopeIds.includes(task.propertyId)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await readJsonBody(request);
  const parsed = taskUpdate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid task payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updateData: Record<string, unknown> = {};
  if (isTasksV2Enabled()) {
    // v2: status moves go through POST /tasks/[id]/status (transition rules,
    // approvals, complaint sync); this route only edits details.
    if (parsed.data.status !== undefined && parsed.data.status !== task.status) {
      return NextResponse.json(
        { error: "Change the status with the status action" },
        { status: 409 },
      );
    }
    if (
      parsed.data.assignedTo !== undefined ||
      parsed.data.assignedToName !== undefined ||
      parsed.data.completedAt !== undefined
    ) {
      return NextResponse.json(
        { error: "Use the assign action to change who does the task" },
        { status: 409 },
      );
    }
    const extra = taskV2UpdateFields.safeParse(body ?? {});
    if (!extra.success) {
      return NextResponse.json(
        { error: "Invalid task payload", issues: extra.error.flatten() },
        { status: 400 },
      );
    }
    if (extra.data.category !== undefined) updateData.category = extra.data.category;
    if (extra.data.scheduledFor !== undefined) updateData.scheduledFor = extra.data.scheduledFor;
    if (extra.data.location !== undefined) {
      const location = await loadTaskLocation(task.propertyId, extra.data.location);
      if ("error" in location) return NextResponse.json({ error: location.error }, { status: 400 });
      updateData.location = location;
    }
  }
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
  if (parsed.data.status !== undefined) {
    updateData.status = parsed.data.status;
    if (parsed.data.status === "done") {
      updateData.completedAt = new Date().toISOString();
    } else {
      updateData.completedAt = "";
    }
  }
  if (parsed.data.assignedTo !== undefined) updateData.assignedTo = parsed.data.assignedTo;
  if (parsed.data.assignedToName !== undefined)
    updateData.assignedToName = parsed.data.assignedToName;
  if (parsed.data.dueDate !== undefined) updateData.dueDate = parsed.data.dueDate;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.completedAt !== undefined) updateData.completedAt = parsed.data.completedAt;

  const updated = await Task.findOneAndUpdate(
    { _id: id, ownerId: task.ownerId, propertyId: task.propertyId },
    updateData,
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!updated) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const titles = await propertyTitleMap([updated.propertyId]);
  return NextResponse.json({
    data: isTasksV2Enabled()
      ? serializeTaskV2(updated as TaskDoc, titles)
      : serializeTask(updated, titles),
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  const authError = await requirePermission(request, "task:manage");
  if (authError) return authError;

  await connectToDatabase();
  const task = await Task.findById(id).lean();
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const actor = await resolveDashboardActor(request, "task:manage");
  if (actor instanceof NextResponse) return actor;

  if (actor.role === "caretaker" && !actor.assignedPropertyIds.includes(task.propertyId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (actor.role === "custodian" && task.ownerId !== actor.managedByOwnerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (
    actor.role === "admin" &&
    task.ownerId !== actor.userId &&
    !actor.propertyScopeIds.includes(task.propertyId)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Scope the mutation to the loaded task (matching PATCH's predicate) so a
  // concurrent owner/property change cannot be deleted by id alone.
  await Task.deleteOne({ _id: id, ownerId: task.ownerId, propertyId: task.propertyId });
  if ((task.complaintIds ?? []).length > 0) {
    // Keep complaints consistent: they no longer point at a deleted task.
    await Complaint.updateMany({ _id: { $in: task.complaintIds } }, { $pull: { taskIds: id } });
  }
  return NextResponse.json({ data: { id } });
}
