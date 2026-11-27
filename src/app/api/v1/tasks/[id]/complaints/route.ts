import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { guardMutation, loadScopedTask, respondWithTask } from "@/lib/maintenance/route-helpers";
import { complaintLinkInput } from "@/lib/schemas/maintenance";
import { Complaint } from "@/models/Complaint";
import { Task } from "@/models/Task";

const MAX_LINKED = 20;

/**
 * Links or unlinks a tenant complaint (one task can cover several complaints
 * and one complaint can have several tasks). Both sides are updated. Only
 * complaints of the same owner and property can be linked.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:manage");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = complaintLinkInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { complaintId, action } = parsed.data;
  const complaint = (await Complaint.findById(complaintId)
    .select("ownerId propertyId subject")
    .lean()) as {
    ownerId: string;
    propertyId: string;
    subject: string;
  } | null;
  if (
    !complaint ||
    complaint.ownerId !== task.ownerId ||
    complaint.propertyId !== task.propertyId
  ) {
    return NextResponse.json({ error: "Complaint not found on this property" }, { status: 404 });
  }

  const who = { userId: actor.userId, role: actor.role, name: actorName };
  if (action === "link") {
    const result = await Task.updateOne(
      { _id: task._id, [`complaintIds.${MAX_LINKED - 1}`]: { $exists: false } },
      { $addToSet: { complaintIds: complaintId } },
    );
    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: `A task can cover at most ${MAX_LINKED} complaints` },
        { status: 409 },
      );
    }
    await Complaint.updateOne({ _id: complaintId }, { $addToSet: { taskIds: String(task._id) } });
    await recordTaskActivity(
      task,
      who,
      "complaint_link",
      `Linked complaint: ${complaint.subject}`,
      { complaintId },
    );
  } else {
    await Task.updateOne({ _id: task._id }, { $pull: { complaintIds: complaintId } });
    await Complaint.updateOne({ _id: complaintId }, { $pull: { taskIds: String(task._id) } });
    await recordTaskActivity(
      task,
      who,
      "complaint_link",
      `Unlinked complaint: ${complaint.subject}`,
      {
        complaintId,
      },
    );
  }
  return respondWithTask(task._id);
}
