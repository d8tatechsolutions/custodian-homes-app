import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap, readJsonBody, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { serializeRequest, serializeThreadDoc, startConversation } from "@/lib/chat/dm";
import { CHAT_REQUEST_STATUSES } from "@/lib/domain-enums";
import { connectToDatabase } from "@/lib/mongoose";
import { buildPaginationResult, parsePagination } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { chatRequestInput } from "@/lib/schemas";
import { ChatRequest } from "@/models/ChatRequest";
import { User } from "@/models/User";

export async function GET(request: NextRequest) {
  const authError = await requirePermission(request, "chat:read-own");
  if (authError) return authError;

  const { page, limit } = parsePagination({
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  const status = request.nextUrl.searchParams.get("status") ?? "pending";
  if (!CHAT_REQUEST_STATUSES.includes(status as (typeof CHAT_REQUEST_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "chat:read-own");
  if (actor instanceof NextResponse) return actor;

  const filter = { recipientId: actor.userId, status };
  const [rows, total] = await Promise.all([
    ChatRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ChatRequest.countDocuments(filter),
  ]);

  const requesterIds = [...new Set(rows.map((row) => row.requesterId))];
  const requesters = requesterIds.length
    ? await User.find({ _id: { $in: requesterIds } })
        .select("name")
        .lean()
    : [];
  const requesterNames = new Map(requesters.map((user) => [String(user._id), user.name]));
  const titles = await propertyTitleMap(rows.map((row) => row.propertyId));

  const data = rows.map((row) => ({
    ...serializeRequest(row),
    requesterName: requesterNames.get(row.requesterId) ?? "Someone",
    propertyTitle: titles.get(row.propertyId) ?? "",
  }));
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
  const parsed = chatRequestInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "chat:send");
  if (actor instanceof NextResponse) return actor;

  const { recipientId } = parsed.data;
  if (recipientId === actor.userId) {
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
  }

  const result = await startConversation({
    actorUserId: actor.userId,
    recipientId,
    propertyId: parsed.data.propertyId,
    tenantId: actor.tenantIds[0] ?? "",
  });
  if (!result) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  if (result.kind === "thread") {
    const thread = serializeThreadDoc(result.thread);
    return NextResponse.json({ data: thread, thread }, { status: 201 });
  }
  const chatRequest = serializeRequest(result.request);
  return NextResponse.json(
    { data: chatRequest, request: chatRequest },
    { status: result.deduped ? 200 : 201 },
  );
}
