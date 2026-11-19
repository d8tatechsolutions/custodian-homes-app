import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveDashboardActor } from "@/app/api/v1/_helpers";
import { isParticipant } from "@/lib/chat/participants";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { ChatThread } from "@/models/ChatThread";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
  }

  const authError = await requirePermission(request, "chat:read-own");
  if (authError) return authError;

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "chat:read-own");
  if (actor instanceof NextResponse) return actor;

  const thread = await ChatThread.findById(id).lean();
  if (!thread || !isParticipant(thread, actor)) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const now = new Date();
  const readAtSet = actor.role === "tenant" ? { tenantLastReadAt: now } : { agentLastReadAt: now };
  const reads = [
    ...(thread.reads ?? []).filter((read: { userId: string }) => read.userId !== actor.userId),
    { userId: actor.userId, lastReadAt: now },
  ];
  await ChatThread.updateOne({ _id: id }, { $set: { ...readAtSet, reads } });

  console.info(`[chat] mark-read actor=${actor.userId} role=${actor.role} thread=${id}`);

  return NextResponse.json({ data: { readAt: now.toISOString() } });
}
