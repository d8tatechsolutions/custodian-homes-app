import { dmKey as buildDmKey, pairKey as buildPairKey, canTransition } from "@/lib/chat/approval";
import { sharedPropertyIds } from "@/lib/chat/shared-property";
import type { ChatAgentRole, ChatRequestStatus } from "@/lib/domain-enums";
import { connectToDatabase } from "@/lib/mongoose";
import { notifyChatRequest, notifyChatRequestDecided } from "@/lib/notifications";
import { ChatRequest } from "@/models/ChatRequest";
import { ChatThread } from "@/models/ChatThread";
import { Property } from "@/models/Property";
import { User } from "@/models/User";

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export function agentRoleFor(role?: string): ChatAgentRole {
  if (role === "caretaker" || role === "custodian") return role;
  return "owner";
}

export function chatLinkForRole(role?: string): string {
  if (role === "tenant") return "/dashboard/tenant/messages";
  if (role === "caretaker" || role === "custodian") return `/dashboard/${role}/communications`;
  if (role === "admin" || role === "owner") return "/dashboard/admin/communications";
  if (role === "broker") return "/dashboard/broker";
  return "/dashboard/system-admin";
}

export type StoredDoc = { _id: unknown; lastMessageAt?: Date } & Record<string, unknown>;

export interface ConversationStartInput {
  actorUserId: string;
  recipientId: string;
  propertyId?: string;
  preferredRole?: string;
  tenantId?: string;
}

export type ConversationStart =
  | { kind: "thread"; thread: StoredDoc; status: 200 | 201 }
  | { kind: "request"; request: StoredDoc; deduped: boolean };

/** `null` means the recipient is missing or inactive. */
export async function startConversation(
  input: ConversationStartInput,
): Promise<ConversationStart | null> {
  await connectToDatabase();
  const recipient = await User.findById(input.recipientId).select("role isActive").lean();
  if (!recipient || recipient.isActive === false) return null;

  const key = buildPairKey(input.actorUserId, input.recipientId);
  const propertyId = input.propertyId ?? "";
  const shared = await sharedPropertyIds(input.actorUserId, input.recipientId);
  if (shared.length > 0) {
    return { kind: "thread", thread: await createDmThread(input, key, propertyId), status: 201 };
  }

  const pendingFilter = {
    requesterId: input.actorUserId,
    recipientId: input.recipientId,
    status: "pending" as ChatRequestStatus,
  };
  const existing = await ChatRequest.findOne(pendingFilter).lean();
  if (existing) {
    return { kind: "request", request: existing, deduped: true };
  }

  try {
    const request = await ChatRequest.create({
      requesterId: input.actorUserId,
      recipientId: input.recipientId,
      pairKey: key,
      propertyId,
      status: "pending",
    });
    await notifyChatRequest(
      request,
      input.recipientId,
      chatLinkForRole(String(recipient.role ?? "")),
    );
    return { kind: "request", request, deduped: false };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const raced = await ChatRequest.findOne(pendingFilter).lean();
    if (!raced) throw error;
    return { kind: "request", request: raced, deduped: true };
  }
}

async function createDmThread(
  input: ConversationStartInput,
  key: string,
  propertyId: string,
): Promise<StoredDoc> {
  const now = new Date();
  const property = propertyId ? await Property.findById(propertyId).select("ownerId").lean() : null;
  const payload = {
    participants: [input.actorUserId, input.recipientId],
    pairKey: key,
    dmKey: buildDmKey(key),
    reads: [
      { userId: input.actorUserId, lastReadAt: now },
      { userId: input.recipientId, lastReadAt: now },
    ],
    kind: "dm",
    status: "active",
    tenantId: input.tenantId ?? "",
    propertyId,
    ownerId: property?.ownerId ?? input.recipientId,
    agentUserId: input.recipientId,
    agentRole: agentRoleFor(input.preferredRole),
    lastMessageAt: now,
    lastMessageText: "",
    tenantLastReadAt: now,
    agentLastReadAt: now,
  };
  try {
    return await ChatThread.create(payload);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await ChatThread.findOne({ dmKey: buildDmKey(key) }).lean();
    if (!existing) throw error;
    return existing;
  }
}

export interface DecidedRequest {
  _id: unknown;
  requesterId: string;
  recipientId: string;
  pairKey?: string;
  propertyId?: string;
  threadId?: string;
}

/** Creates (or reuses) the approved DM thread. Idempotent. */
export async function getOrCreateThreadForRequest(request: DecidedRequest): Promise<StoredDoc> {
  await connectToDatabase();
  const key = request.pairKey || buildPairKey(request.requesterId, request.recipientId);
  const dm = buildDmKey(key);
  const existing = await ChatThread.findOne({ dmKey: dm }).lean();
  if (existing) return existing;
  if (request.threadId) {
    const byId = await ChatThread.findById(request.threadId).lean();
    if (byId) return byId;
  }

  const recipient = await User.findById(request.recipientId).select("role").lean();
  const start: ConversationStartInput = {
    actorUserId: request.requesterId,
    recipientId: request.recipientId,
    propertyId: request.propertyId ?? "",
    preferredRole: String(recipient?.role ?? ""),
  };
  return createDmThread(start, key, start.propertyId ?? "").catch(async (error: unknown) => {
    if (!isDuplicateKeyError(error)) throw error;
    const raced = await ChatThread.findOne({ dmKey: dm }).lean();
    if (!raced) throw error;
    return raced;
  });
}

export type Decision = "approved" | "declined" | "cancelled";

export type DecideResult =
  | { error: "not-found" | "forbidden" | "conflict" }
  | { ok: true; request: StoredDoc; thread?: StoredDoc };

/** Recipient approves/declines; requester cancels. Notifies only decisions. */
export async function decideRequest(input: {
  requestId: string;
  actorUserId: string;
  decision: Decision;
}): Promise<DecideResult> {
  await connectToDatabase();
  const request = await ChatRequest.findById(input.requestId).lean();
  if (!request) return { error: "not-found" };

  const isRecipient = request.recipientId === input.actorUserId;
  const isRequester = request.requesterId === input.actorUserId;
  if (
    !canTransition(request.status as ChatRequestStatus, input.decision, isRecipient, isRequester)
  ) {
    return { error: isRecipient || isRequester ? "conflict" : "forbidden" };
  }

  const decidedAt = new Date();
  const update: Record<string, unknown> = {
    status: input.decision,
    decidedById: input.actorUserId,
    decidedAt,
  };
  let thread: StoredDoc | undefined;
  if (input.decision === "approved") {
    thread = await getOrCreateThreadForRequest(request);
    update.threadId = String(thread._id);
  }

  const updated =
    (await ChatRequest.findByIdAndUpdate(
      input.requestId,
      { $set: update },
      { returnDocument: "after" },
    ).lean()) ?? ({ ...request, ...update } as StoredDoc);

  if (input.decision !== "cancelled") {
    const requester = await User.findById(request.requesterId).select("role").lean();
    await notifyChatRequestDecided(
      updated,
      request.requesterId,
      input.decision === "approved",
      chatLinkForRole(String(requester?.role ?? "")),
    );
  }

  return { ok: true, request: updated, thread };
}

export function serializeRequest<T extends { _id: unknown }>(request: T): T & { _id: string } {
  return { ...request, _id: String(request._id) };
}

/** Keeps the pre-approval response shape so the current inbox can open a thread. */
export function serializeThreadDoc<T extends { _id: unknown; lastMessageAt?: Date }>(
  thread: T,
): T & {
  _id: string;
  lastAt: string;
  contact: string;
  role: string;
  property: string;
  unread: number;
} {
  const agentRole = (thread as { agentRole?: string }).agentRole ?? "owner";
  return {
    ...thread,
    _id: String(thread._id),
    contact: "",
    role: agentRole === "owner" ? "Landlord" : "Caretaker",
    property: "",
    lastAt: new Date(thread.lastMessageAt ?? Date.now()).toISOString(),
    unread: 0,
  };
}
