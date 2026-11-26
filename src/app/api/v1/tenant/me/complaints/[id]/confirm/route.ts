import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { type NoticeTask, notifyTaskNotFixed } from "@/lib/maintenance/notify";
import { guardMutation, tasksV2Disabled } from "@/lib/maintenance/route-helpers";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { tenantConfirmationInput } from "@/lib/schemas/maintenance";
import { Complaint } from "@/models/Complaint";
import { Task } from "@/models/Task";

/**
 * The tenant answers "Is it fixed?" on a resolved complaint (client decision
 * Q7). "Fixed" closes the loop. "Not fixed" reopens the complaint and the same
 * finished task(s), with the tenant's note in the task history.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid complaint id" }, { status: 400 });

  const authError = await requirePermission(request, "complaint:read-own");
  if (authError) return authError;
  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "complaint:read-own");
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "tenant") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = tenantConfirmationInput.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid answer" }, { status: 400 });

  const complaint = (await Complaint.findOne({
    _id: id,
    tenantId: { $in: actor.tenantIds },
  }).lean()) as {
    _id: unknown;
    ownerId: string;
    status: string;
    subject: string;
    taskIds?: string[];
    tenantConfirmation?: { status?: string };
  } | null;
  if (!complaint) return NextResponse.json({ error: "Complaint not found" }, { status: 404 });
  if (complaint.status !== "resolved") {
    return NextResponse.json(
      { error: "You can confirm once the work is marked done" },
      { status: 409 },
    );
  }
  if (complaint.tenantConfirmation?.status && complaint.tenantConfirmation.status !== "none") {
    return NextResponse.json(
      { error: "You have already answered for this request" },
      { status: 409 },
    );
  }

  const now = new Date();
  const who = { userId: actor.userId, role: "tenant", name: "Tenant" };
  const tasks = (await Task.find({ complaintIds: String(complaint._id) })
    .select(
      "_id ownerId status title propertyId propertyName location dueDate priority assignee createdBy",
    )
    .lean()) as (NoticeTask & { status: string })[];

  if (parsed.data.fixed) {
    await Complaint.updateOne(
      { _id: id, "tenantConfirmation.status": { $in: ["none", null] } },
      {
        $set: {
          "tenantConfirmation.status": "fixed",
          "tenantConfirmation.at": now,
          "tenantConfirmation.note": parsed.data.note,
        },
      },
    );
    for (const t of tasks) {
      await recordTaskActivity(t, who, "tenant_confirmation", "Tenant confirmed it is fixed", {
        complaintId: id,
      });
    }
  } else {
    await Complaint.updateOne(
      { _id: id, status: "resolved" },
      {
        $set: {
          status: "open",
          "tenantConfirmation.status": "not_fixed",
          "tenantConfirmation.at": now,
          "tenantConfirmation.note": parsed.data.note,
        },
        $inc: { reopenedCount: 1 },
      },
    );
    for (const t of tasks) {
      if (t.status === "done") {
        await Task.updateOne(
          { _id: t._id, status: "done" },
          { $set: { status: "open", completedAt: "" } },
        );
      }
      await recordTaskActivity(
        t,
        who,
        "tenant_confirmation",
        `Tenant says it is NOT fixed${parsed.data.note ? `: ${parsed.data.note}` : ""} — task reopened`,
        { complaintId: id },
      );
      await notifyTaskNotFixed(t, parsed.data.note ?? "");
    }
  }
  return NextResponse.json({ data: { id, fixed: parsed.data.fixed } });
}
