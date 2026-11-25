import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { guardMutation, loadScopedTask } from "@/lib/maintenance/route-helpers";
import { commentInput } from "@/lib/schemas/maintenance";
import { TaskActivity } from "@/models/TaskActivity";

/** Task history (oldest first). Pending-notification entries are staff-internal and included. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadScopedTask(request, id, "task:read-own");
  if (loaded instanceof NextResponse) return loaded;

  const rows = await TaskActivity.find({ taskId: id }).sort({ createdAt: 1 }).limit(500).lean();
  return NextResponse.json({
    data: rows.map((r) => ({ ...r, _id: String((r as { _id: unknown })._id) })),
  });
}

/** Adds a comment. Owners comment too (client decision Q39). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;

  const loaded = await loadScopedTask(request, id, "task:read-own");
  if (loaded instanceof NextResponse) return loaded;
  const { task, actor, actorName } = loaded;

  const parsed = commentInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Write a comment first" }, { status: 400 });
  }
  await recordTaskActivity(
    task,
    { userId: actor.userId, role: actor.role, name: actorName },
    "comment",
    parsed.data.message,
  );
  return NextResponse.json({ data: { ok: true } }, { status: 201 });
}
