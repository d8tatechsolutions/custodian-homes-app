import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { serializeMessage } from "@/lib/chat";
import { chatLinkForRole } from "@/lib/chat/dm";
import { isParticipant, isThreadActive } from "@/lib/chat/participants";
import { connectToDatabase } from "@/lib/mongoose";
import { notifyMessageReply } from "@/lib/notifications";
import { buildPaginationResult } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { chatMessageInput } from "@/lib/schemas";
import { ChatMessage } from "@/models/ChatMessage";
import { ChatThread } from "@/models/ChatThread";
import { Tenant } from "@/models/Tenant";
import { User } from "@/models/User";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  const messages = await ChatMessage.find({ threadId: id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const ordered = [...messages].reverse();

  return NextResponse.json(
    buildPaginationResult(
      ordered.map((message) => serializeMessage(message, actor.userId)),
      ordered.length,
      1,
      100,
    ),
  );
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 30 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
  }

  const authError = await requirePermission(request, "chat:send");
  if (authError) return authError;

  const body = await readJsonBody(request);
  const parsed = chatMessageInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid message payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "chat:send");
  if (actor instanceof NextResponse) return actor;

  const thread = await ChatThread.findById(id).lean();
  if (!thread || !isParticipant(thread, actor)) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (!isThreadActive(thread)) {
    return NextResponse.json({ error: "Thread is not active" }, { status: 403 });
  }

  const message = await ChatMessage.create({
    threadId: id,
    senderUserId: actor.userId,
    senderRole: actor.role,
    text: parsed.data.text,
  });

  const now = new Date();
  const readAtSet = actor.role === "tenant" ? { tenantLastReadAt: now } : { agentLastReadAt: now };
  const reads = [
    ...(thread.reads ?? []).filter((read: { userId: string }) => read.userId !== actor.userId),
    { userId: actor.userId, lastReadAt: now },
  ];
  await ChatThread.updateOne(
    { _id: id },
    { $set: { lastMessageAt: now, lastMessageText: parsed.data.text, ...readAtSet, reads } },
  );

  let recipientUserId = "";
  let link = "/dashboard/tenant/messages";
  if ((thread.participants?.length ?? 0) > 0 && thread.kind !== "legacy-property") {
    recipientUserId = thread.participants?.find((userId: string) => userId !== actor.userId) ?? "";
    const other = recipientUserId
      ? await User.findById(recipientUserId).select("role").lean()
      : null;
    link = chatLinkForRole(String(other?.role ?? ""));
  } else if (actor.role === "tenant") {
    recipientUserId = thread.agentUserId ?? "";
    link =
      thread.agentRole === "owner"
        ? "/dashboard/admin/communications"
        : "/dashboard/caretaker/communications";
  } else {
    try {
      const tenantRow = await Tenant.findById(thread.tenantId).select("userId").lean();
      recipientUserId = tenantRow?.userId ?? "";
    } catch (_error) {
      console.warn(`[chat] tenant lookup failed thread=${id}`);
    }
  }
  await notifyMessageReply(message, recipientUserId, link);

  console.info(`[chat] send-message actor=${actor.userId} role=${actor.role} thread=${id}`);

  return NextResponse.json({ data: serializeMessage(message, actor.userId) }, { status: 201 });
}
