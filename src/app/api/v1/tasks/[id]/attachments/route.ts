import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { MAX_TASK_ATTACHMENTS } from "@/lib/maintenance/enums";
import { guardMutation, loadScopedTask, respondWithTask } from "@/lib/maintenance/route-helpers";
import { attachmentInput } from "@/lib/schemas/maintenance";
import { Task } from "@/models/Task";

/**
 * Adds or removes a file (quote PDF, invoice, receipt) on a task. Anyone who
 * can manage the task may add; only the uploader or a supervisor may remove.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:manage");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = attachmentInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid file request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const field = parsed.data.target;
  const noun = field === "receipts" ? "receipt" : "file";
  const who = { userId: actor.userId, role: actor.role, name: actorName };

  if (parsed.data.action === "add") {
    const name = parsed.data.media.name || "";
    const result = await Task.updateOne(
      { _id: task._id, [`${field}.${MAX_TASK_ATTACHMENTS - 1}`]: { $exists: false } },
      {
        $push: {
          [field]: {
            ...parsed.data.media,
            kind: /\.(png|jpe?g|webp|gif|heic)$/i.test(name) ? "image" : "document",
            uploadedBy: actor.userId,
            uploadedAt: new Date(),
          },
        },
      },
    );
    if (result.modifiedCount === 0) {
      return NextResponse.json(
        { error: `A task can have at most ${MAX_TASK_ATTACHMENTS} ${noun}s` },
        { status: 409 },
      );
    }
    await recordTaskActivity(task, who, "attachment", `Added a ${noun}${name ? `: ${name}` : ""}`, {
      field,
    });
    return respondWithTask(task._id);
  }

  const { mediaId } = parsed.data;
  const existing = (task[field] ?? []).find(
    (m) => String((m as { _id?: unknown })._id) === mediaId,
  );
  if (!existing) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const supervisor =
    actor.role === "admin" || actor.role === "custodian" || actor.role === "system-admin";
  if (!supervisor && existing.uploadedBy !== actor.userId) {
    return NextResponse.json(
      { error: "Only the person who uploaded it can remove this file" },
      { status: 403 },
    );
  }
  await Task.updateOne({ _id: task._id }, { $pull: { [field]: { _id: mediaId } } });
  await recordTaskActivity(task, who, "attachment", `Removed a ${noun}`, { field });
  return respondWithTask(task._id);
}
