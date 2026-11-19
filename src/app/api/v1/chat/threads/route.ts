import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap, readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import {
  countUnreadByThread,
  readWatermark,
  serializeThread,
  type ThreadEnrichment,
} from "@/lib/chat";
import { serializeRequest, serializeThreadDoc, startConversation } from "@/lib/chat/dm";
import { buildThreadFilter } from "@/lib/chat/participants";
import { connectToDatabase } from "@/lib/mongoose";
import { buildPaginationResult, parsePagination } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { chatThreadInput } from "@/lib/schemas";
import { ChatMessage } from "@/models/ChatMessage";
import { ChatThread } from "@/models/ChatThread";
import { Tenant } from "@/models/Tenant";
import { User } from "@/models/User";

export async function GET(request: NextRequest) {
  const { page, limit } = parsePagination({
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  const skip = (page - 1) * limit;

  const authError = await requirePermission(request, "chat:read-own");
  if (authError) return authError;

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "chat:read-own");
  if (actor instanceof NextResponse) return actor;

  const filter = buildThreadFilter(actor);

  const [threads, total] = await Promise.all([
    ChatThread.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(limit).lean(),
    ChatThread.countDocuments(filter),
  ]);

  const agentNames = new Map(
    (
      await User.find({ _id: { $in: threads.map((thread) => thread.agentUserId) } })
        .select("name")
        .lean()
    ).map((user) => [String(user._id), user.name]),
  );
  const tenantNames = new Map(
    (
      await Tenant.find({ _id: { $in: threads.map((thread) => thread.tenantId) } })
        .select("name")
        .lean()
    ).map((tenant) => [String(tenant._id), tenant.name]),
  );
  const titles = await propertyTitleMap(threads.map((thread) => thread.propertyId));

  // Batched unread counts: one candidate-messages fetch replaces the old
  // per-thread `countDocuments` loop. Candidates are other-side messages in
  // this page's threads newer than the page's oldest read watermark;
  // per-thread counting then applies each thread's own watermark.
  let oldestReadAt: Date | null = null;
  for (const thread of threads) {
    const readAt = readWatermark(thread, actor.role, actor.userId);
    if (readAt && (oldestReadAt === null || readAt < oldestReadAt)) oldestReadAt = readAt;
  }
  const unreadFilter: Record<string, unknown> = {
    threadId: { $in: threads.map((thread) => String(thread._id)) },
    senderUserId: { $ne: actor.userId },
  };
  if (oldestReadAt) unreadFilter.createdAt = { $gt: oldestReadAt };
  const candidateMessages = threads.length
    ? await ChatMessage.find(unreadFilter).select("threadId createdAt").lean()
    : [];
  const unreadByThread = countUnreadByThread(threads, actor.role, candidateMessages, actor.userId);

  const data: ReturnType<typeof serializeThread>[] = [];
  for (const thread of threads) {
    const enrichment: ThreadEnrichment = {
      agentName: agentNames.get(thread.agentUserId) ?? "Property team",
      tenantName: tenantNames.get(thread.tenantId) ?? "Tenant",
      propertyTitle: titles.get(thread.propertyId) ?? "",
      unread: unreadByThread.get(String(thread._id)) ?? 0,
    };
    data.push(serializeThread(thread, enrichment, actor.role));
  }

  return NextResponse.json(buildPaginationResult(data, total, page, limit));
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 10 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const authError = await requirePermission(request, "chat:send");
  if (authError) return authError;

  const body = await readJsonBody(request);
  const parsed = chatThreadInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid thread payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "chat:send");
  if (actor instanceof NextResponse) return actor;

  const { recipientId, role, propertyId } = parsed.data;
  if (recipientId === actor.userId) {
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
  }

  const result = await startConversation({
    actorUserId: actor.userId,
    recipientId,
    propertyId,
    preferredRole: role,
    tenantId: actor.tenantIds[0] ?? "",
  });
  if (!result) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  if (result.kind === "thread") {
    const thread = serializeThreadDoc(result.thread);
    console.info(
      `[chat] start-thread actor=${actor.userId} role=${actor.role} thread=${String(thread._id)}`,
    );
    return NextResponse.json({ data: thread, thread }, { status: 201 });
  }
  const chatRequest = serializeRequest(result.request);
  return NextResponse.json(
    { data: chatRequest, request: chatRequest },
    { status: result.deduped ? 200 : 201 },
  );
}
