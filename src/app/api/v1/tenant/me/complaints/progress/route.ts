import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveDashboardActor } from "@/app/api/v1/_helpers";
import { TASK_STATUS_LABELS, type TaskStatusV2 } from "@/lib/maintenance/enums";
import { tasksV2Disabled } from "@/lib/maintenance/route-helpers";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { Complaint } from "@/models/Complaint";
import { Task } from "@/models/Task";

interface TaskRow {
  _id: unknown;
  complaintIds?: string[];
  status: TaskStatusV2;
  scheduledFor?: string;
  completedAt?: string;
  photosBefore?: { _id: unknown; url: string }[];
  photosAfter?: { _id: unknown; url: string }[];
  assignee?: { kind?: string } | null;
}

/**
 * Progress of the work on the caller's complaints (client decisions Q5, Q14):
 * status, scheduled date and photos of the linked tasks — nothing internal
 * (no costs, vendors, notes or staff history).
 */
export async function GET(request: NextRequest) {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  const authError = await requirePermission(request, "complaint:read-own");
  if (authError) return authError;
  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "complaint:read-own");
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "tenant" || actor.tenantIds.length === 0)
    return NextResponse.json({ data: {} });

  const complaints = (await Complaint.find({ tenantId: { $in: actor.tenantIds } })
    .select("_id tenantConfirmation")
    .lean()) as { _id: unknown; tenantConfirmation?: { status?: string } }[];
  const ids = complaints.map((c) => String(c._id));
  if (ids.length === 0) return NextResponse.json({ data: {} });

  const tasks = (await Task.find({ complaintIds: { $in: ids } })
    .select("complaintIds status scheduledFor completedAt photosBefore photosAfter assignee")
    .lean()) as TaskRow[];

  const data: Record<string, unknown> = {};
  for (const c of complaints) {
    const id = String(c._id);
    const linked = tasks.filter((t) => (t.complaintIds ?? []).includes(id));
    data[id] = {
      confirmation: c.tenantConfirmation?.status ?? "none",
      tasks: linked.map((t) => ({
        id: String(t._id),
        status: t.status,
        statusLabel: TASK_STATUS_LABELS[t.status] ?? t.status,
        assigned: Boolean(t.assignee?.kind),
        scheduledFor: t.scheduledFor ?? "",
        completedAt: t.completedAt ?? "",
        photosBefore: (t.photosBefore ?? []).map((p) => ({ id: String(p._id), url: p.url })),
        photosAfter: (t.photosAfter ?? []).map((p) => ({ id: String(p._id), url: p.url })),
      })),
    };
  }
  return NextResponse.json({ data });
}
