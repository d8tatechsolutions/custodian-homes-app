/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken } from "@/test/utils/api-request";
import { activeAssignment } from "@/test/utils/assignment-mocks";
import {
  makeChatRequest,
  makeChatThread,
  makeObjectId,
  makeProperty,
  makeTenant,
  makeUser,
} from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));
vi.mock("@/models/Tenant", () => ({ Tenant: getModelStubs().tenant }));
vi.mock("@/models/ChatThread", () => ({ ChatThread: getModelStubs().chatthread }));
vi.mock("@/models/ChatMessage", () => ({ ChatMessage: getModelStubs().chatmessage }));
vi.mock("@/models/ChatRequest", () => ({ ChatRequest: getModelStubs().chatrequest }));
vi.mock("@/models/ManagementAssignment", () => ({
  ManagementAssignment: getModelStubs().managementAssignment,
}));
vi.mock("@/models/Unit", () => ({ Unit: getModelStubs().unit }));
vi.mock("@/models/Lease", () => ({ Lease: getModelStubs().lease }));
vi.mock("@/lib/chat/shared-property", () => ({ sharedPropertyIds: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  notifyChatRequest: vi.fn().mockResolvedValue(true),
  notifyChatRequestDecided: vi.fn().mockResolvedValue(true),
}));

import { GET, POST } from "@/app/api/v1/chat/threads/route";
import { sharedPropertyIds } from "@/lib/chat/shared-property";
import { notifyChatRequest } from "@/lib/notifications";

const {
  user,
  property,
  tenant,
  chatthread,
  chatmessage,
  chatrequest,
  managementAssignment,
  unit,
  lease,
} = getModelStubs();

const USER_ID = makeObjectId("user");
const OWNER_ID = makeObjectId("admin");
const CUSTODIAN_ID = makeObjectId("custodian");
const AGENT_ID = makeObjectId("agent");
const TENANT_ID = makeObjectId("tenant");
const PROPERTY_ID = makeObjectId("p1");
const THREAD_ID = makeObjectId("thread");

function tenantUser() {
  return makeUser({ _id: USER_ID, role: "tenant" });
}

function caretakerUser(privileges: string[]) {
  return makeUser({ _id: AGENT_ID, role: "caretaker", privileges: privileges as never });
}

function custodianUser() {
  return makeUser({ _id: CUSTODIAN_ID, role: "custodian" });
}

function threadRow() {
  return makeChatThread({
    _id: THREAD_ID,
    tenantId: TENANT_ID,
    propertyId: PROPERTY_ID,
    ownerId: OWNER_ID,
    agentUserId: AGENT_ID,
    agentRole: "caretaker",
  });
}

function dmFilter(userId: string, legacy: Record<string, unknown> = {}) {
  return { $or: [{ participants: userId }, { participants: { $exists: false }, ...legacy }] };
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/v1/chat/threads", () => {
  beforeEach(() => {
    resetModelStubs();
  });

  it("401 when unauthenticated", async () => {
    const res = await GET(buildRequest("/api/v1/chat/threads"));
    expect(res.status).toBe(401);
  });

  it("scopes threads to the tenant and computes per-thread unread", async () => {
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    tenant.find.mockReturnValue(
      buildQuery([
        makeTenant({
          _id: TENANT_ID,
          propertyId: PROPERTY_ID,
          userId: USER_ID,
          name: "Amina Otieno",
        }),
      ]),
    );
    const row = threadRow();
    chatthread.find.mockReturnValue(
      buildQuery([row]).sort({ lastMessageAt: -1 }).skip(0).limit(20),
    );
    chatthread.countDocuments.mockResolvedValue(1);
    user.find.mockReturnValue(buildQuery([{ _id: AGENT_ID, name: "John Kiprono" }]));
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, title: "Sunlit Studio" }]));
    chatmessage.find.mockReturnValue(
      buildQuery([
        { threadId: THREAD_ID, createdAt: new Date("2026-09-02T08:30:00.000Z") },
        { threadId: THREAD_ID, createdAt: new Date("2026-09-02T09:00:00.000Z") },
      ]),
    );

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(USER_ID) }));
    expect(res.status).toBe(200);
    expect(chatthread.find).toHaveBeenCalledWith(
      dmFilter(USER_ID, { tenantId: { $in: [TENANT_ID] } }),
    );
    expect(chatmessage.find).toHaveBeenCalledWith({
      threadId: { $in: [THREAD_ID] },
      senderUserId: { $ne: USER_ID },
      createdAt: { $gt: row.tenantLastReadAt },
    });
    expect(chatmessage.countDocuments).not.toHaveBeenCalled();
    const body = await json(res);
    const data = body.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]._id).toBe(THREAD_ID);
    expect(data[0].contact).toBe("John Kiprono");
    expect(data[0].role).toBe("Caretaker");
    expect(data[0].property).toBe("Sunlit Studio");
    expect(data[0].unread).toBe(2);
    expect(data[0].lastMessageText).toBe(row.lastMessageText);
  });

  it("owner sees threads on their properties", async () => {
    user.findById.mockReturnValue(buildQuery(makeUser({ _id: OWNER_ID, role: "admin" })));
    managementAssignment.find.mockReturnValue(
      buildQuery([
        activeAssignment({
          principalUserId: OWNER_ID,
          accessRole: "admin",
          propertyId: PROPERTY_ID,
          permissions: ["chat:read-own", "chat:send"],
        }),
      ]),
    );
    const row = threadRow();
    chatthread.find.mockReturnValue(
      buildQuery([row]).sort({ lastMessageAt: -1 }).skip(0).limit(20),
    );
    chatthread.countDocuments.mockResolvedValue(1);
    user.find.mockReturnValue(buildQuery([{ _id: AGENT_ID, name: "John Kiprono" }]));
    tenant.find.mockReturnValue(buildQuery([{ _id: TENANT_ID, name: "Amina Otieno" }]));
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, title: "Sunlit Studio" }]));
    chatmessage.find.mockReturnValue(buildQuery([]));

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(OWNER_ID) }));
    expect(res.status).toBe(200);
    expect(chatthread.find).toHaveBeenCalledWith(
      dmFilter(OWNER_ID, { propertyId: { $in: [PROPERTY_ID] } }),
    );
    expect(chatmessage.find).toHaveBeenCalledWith({
      threadId: { $in: [THREAD_ID] },
      senderUserId: { $ne: OWNER_ID },
      createdAt: { $gt: row.agentLastReadAt },
    });
  });

  it("batches unread counts across threads in one query", async () => {
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    tenant.find.mockReturnValue(
      buildQuery([
        makeTenant({ _id: TENANT_ID, propertyId: PROPERTY_ID, userId: USER_ID }),
        makeTenant({ _id: makeObjectId("tenant2"), propertyId: PROPERTY_ID, userId: USER_ID }),
      ]),
    );
    const secondId = makeObjectId("thread2");
    const first = threadRow();
    const second = makeChatThread({
      _id: secondId,
      tenantId: TENANT_ID,
      propertyId: PROPERTY_ID,
      ownerId: OWNER_ID,
      agentUserId: AGENT_ID,
      tenantLastReadAt: new Date("2026-09-02T09:30:00.000Z"),
    });
    chatthread.find.mockReturnValue(
      buildQuery([first, second]).sort({ lastMessageAt: -1 }).skip(0).limit(20),
    );
    chatthread.countDocuments.mockResolvedValue(2);
    user.find.mockReturnValue(buildQuery([{ _id: AGENT_ID, name: "John Kiprono" }]));
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, title: "Sunlit Studio" }]));
    chatmessage.find.mockReturnValue(
      buildQuery([
        { threadId: THREAD_ID, createdAt: new Date("2026-09-02T08:15:00.000Z") },
        { threadId: secondId, createdAt: new Date("2026-09-02T09:00:00.000Z") },
        { threadId: secondId, createdAt: new Date("2026-09-02T10:00:00.000Z") },
      ]),
    );

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(USER_ID) }));
    expect(res.status).toBe(200);
    expect(chatmessage.find).toHaveBeenCalledTimes(1);
    expect(chatmessage.find).toHaveBeenCalledWith({
      threadId: { $in: [THREAD_ID, secondId] },
      senderUserId: { $ne: USER_ID },
      createdAt: { $gt: first.tenantLastReadAt },
    });
    expect(chatmessage.countDocuments).not.toHaveBeenCalled();

    const body = await json(res);
    const data = body.data as Array<{ _id: string; unread: number }>;
    expect(data).toHaveLength(2);
    expect(data.find((t) => t._id === THREAD_ID)?.unread).toBe(1);
    expect(data.find((t) => t._id === secondId)?.unread).toBe(1);
  });

  it("uses per-user reads for DM threads", async () => {
    const otherId = makeObjectId("other");
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    tenant.find.mockReturnValue(buildQuery([makeTenant({ _id: TENANT_ID, userId: USER_ID })]));
    const dm = makeChatThread({
      _id: THREAD_ID,
      participants: [USER_ID, otherId],
      pairKey: `${USER_ID}:${otherId}`,
      kind: "dm",
      status: "active",
      tenantLastReadAt: new Date("2026-01-01T00:00:00.000Z"),
      reads: [{ userId: USER_ID, lastReadAt: new Date("2026-09-02T09:30:00.000Z") }],
    });
    chatthread.find.mockReturnValue(buildQuery([dm]).sort({}).skip(0).limit(20));
    chatthread.countDocuments.mockResolvedValue(1);
    user.find.mockReturnValue(buildQuery([{ _id: otherId, name: "Other User" }]));
    tenant.find.mockReturnValue(buildQuery([]));
    property.find.mockReturnValue(buildQuery([]));
    chatmessage.find.mockReturnValue(
      buildQuery([
        { threadId: THREAD_ID, createdAt: new Date("2026-09-02T09:00:00.000Z") },
        { threadId: THREAD_ID, createdAt: new Date("2026-09-02T10:00:00.000Z") },
      ]),
    );

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(USER_ID) }));
    expect(res.status).toBe(200);
    expect(chatmessage.find).toHaveBeenCalledWith({
      threadId: { $in: [THREAD_ID] },
      senderUserId: { $ne: USER_ID },
      createdAt: { $gt: dm.reads?.[0].lastReadAt },
    });
    const body = await json(res);
    expect((body.data as Array<{ unread: number }>)[0].unread).toBe(1);
  });

  it("caretaker sees only threads where they are the agent", async () => {
    user.findById.mockReturnValue(buildQuery(caretakerUser([])));
    managementAssignment.find.mockReturnValue(
      buildQuery([
        activeAssignment({
          principalUserId: AGENT_ID,
          accessRole: "caretaker",
          propertyId: PROPERTY_ID,
          permissions: ["chat:read-own"],
        }),
      ]),
    );
    chatthread.find.mockReturnValue(buildQuery([]).sort({}).skip(0).limit(20));
    chatthread.countDocuments.mockResolvedValue(0);
    user.find.mockReturnValue(buildQuery([]));
    tenant.find.mockReturnValue(buildQuery([]));
    property.find.mockReturnValue(buildQuery([]));

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(AGENT_ID) }));
    expect(res.status).toBe(200);
    expect(chatthread.find).toHaveBeenCalledWith(dmFilter(AGENT_ID, { agentUserId: AGENT_ID }));
  });

  it("scopes an assignment-backed custodian to threads on assigned properties", async () => {
    user.findById.mockReturnValue(buildQuery(custodianUser()));
    managementAssignment.find.mockReturnValue(
      buildQuery([
        activeAssignment({
          principalUserId: CUSTODIAN_ID,
          accessRole: "custodian",
          propertyId: PROPERTY_ID,
          permissions: ["chat:read-own"],
        }),
      ]),
    );
    chatthread.find.mockReturnValue(buildQuery([]).sort({}).skip(0).limit(20));
    chatthread.countDocuments.mockResolvedValue(0);
    user.find.mockReturnValue(buildQuery([]));
    tenant.find.mockReturnValue(buildQuery([]));
    property.find.mockReturnValue(buildQuery([]));

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(CUSTODIAN_ID) }));
    expect(res.status).toBe(200);
    expect(chatthread.find).toHaveBeenCalledWith(
      dmFilter(CUSTODIAN_ID, { propertyId: { $in: [PROPERTY_ID] } }),
    );
  });

  it("custodian sees every thread in the managed owner's portfolio", async () => {
    user.findById.mockReturnValue(buildQuery(custodianUser()));
    managementAssignment.find.mockReturnValue(
      buildQuery([
        activeAssignment({
          principalUserId: CUSTODIAN_ID,
          accessRole: "custodian",
          propertyId: PROPERTY_ID,
          permissions: ["chat:read-own", "chat:send"],
        }),
      ]),
    );
    chatthread.find.mockReturnValue(buildQuery([]).sort({}).skip(0).limit(20));
    chatthread.countDocuments.mockResolvedValue(0);
    user.find.mockReturnValue(buildQuery([]));
    tenant.find.mockReturnValue(buildQuery([]));
    property.find.mockReturnValue(buildQuery([]));

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(CUSTODIAN_ID) }));
    expect(res.status).toBe(200);
    expect(chatthread.find).toHaveBeenCalledWith(
      dmFilter(CUSTODIAN_ID, { propertyId: { $in: [PROPERTY_ID] } }),
    );
  });

  it("scopes a unit-only admin to threads for tenants on the assigned unit", async () => {
    const ADMIN_ID = makeObjectId("unit-admin");
    const UNIT_ID = makeObjectId("assigned-unit");
    user.findById.mockReturnValue(buildQuery(makeUser({ _id: ADMIN_ID, role: "admin" })));
    managementAssignment.find.mockReturnValue(
      buildQuery([
        activeAssignment({
          principalUserId: ADMIN_ID,
          accessRole: "admin",
          propertyId: PROPERTY_ID,
          scopeType: "unit",
          blockId: makeObjectId("assigned-block"),
          unitId: UNIT_ID,
          permissions: ["chat:read-own"],
        }),
      ]),
    );
    unit.find.mockReturnValue(buildQuery([{ _id: UNIT_ID }]));
    lease.find.mockReturnValue(buildQuery([{ tenantId: TENANT_ID }]));
    chatthread.find.mockReturnValue(buildQuery([]).sort({}).skip(0).limit(20));
    chatthread.countDocuments.mockResolvedValue(0);
    user.find.mockReturnValue(buildQuery([]));
    tenant.find.mockReturnValue(buildQuery([]));
    property.find.mockReturnValue(buildQuery([]));

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(ADMIN_ID) }));
    expect(res.status).toBe(200);
    expect(chatthread.find).toHaveBeenCalledWith(
      dmFilter(ADMIN_ID, { tenantId: { $in: [TENANT_ID] } }),
    );
    expect(unit.find).toHaveBeenCalledWith({
      $or: [{ _id: UNIT_ID, propertyId: PROPERTY_ID }],
    });
  });

  it("tenant with no bound rows still gets their DM threads", async () => {
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    tenant.find.mockReturnValue(buildQuery([]));
    chatthread.find.mockReturnValue(buildQuery([]).sort({}).skip(0).limit(20));
    chatthread.countDocuments.mockResolvedValue(0);
    user.find.mockReturnValue(buildQuery([]));
    property.find.mockReturnValue(buildQuery([]));

    const res = await GET(buildRequest("/api/v1/chat/threads", { token: signToken(USER_ID) }));
    expect(res.status).toBe(200);
    expect(chatthread.find).toHaveBeenCalledWith(dmFilter(USER_ID, { tenantId: { $in: [] } }));
    expect((await json(res)).data).toEqual([]);
  });
});

describe("POST /api/v1/chat/threads", () => {
  const sharedMock = vi.mocked(sharedPropertyIds);
  const notifyMock = vi.mocked(notifyChatRequest);

  beforeEach(() => {
    resetModelStubs();
    sharedMock.mockReset().mockResolvedValue([]);
    notifyMock.mockReset().mockResolvedValue(true);
    tenant.find.mockReturnValue(
      buildQuery([makeTenant({ _id: TENANT_ID, propertyId: PROPERTY_ID, userId: USER_ID })]),
    );
  });

  function recipientUser(id: string, role = "admin", isActive = true) {
    return makeUser({ _id: id, role: role as never, isActive });
  }

  it("401 when unauthenticated", async () => {
    const res = await POST(buildRequest("/api/v1/chat/threads", { method: "POST", body: {} }));
    expect(res.status).toBe(401);
  });

  it("400 when the payload is invalid", async () => {
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    const res = await POST(
      buildRequest("/api/v1/chat/threads", {
        method: "POST",
        token: signToken(USER_ID),
        body: { recipientId: "short", role: "owner" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when the recipient role is not an allowed chat role", async () => {
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    const res = await POST(
      buildRequest("/api/v1/chat/threads", {
        method: "POST",
        token: signToken(USER_ID),
        body: { recipientId: OWNER_ID, role: "system-admin" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when messaging yourself", async () => {
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    const res = await POST(
      buildRequest("/api/v1/chat/threads", {
        method: "POST",
        token: signToken(USER_ID),
        body: { recipientId: USER_ID, role: "owner" },
      }),
    );
    expect(res.status).toBe(400);
    expect(chatthread.create).not.toHaveBeenCalled();
  });

  it("404 when the recipient is missing or inactive", async () => {
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === USER_ID ? tenantUser() : recipientUser(OWNER_ID, "admin", false)),
    );
    const res = await POST(
      buildRequest("/api/v1/chat/threads", {
        method: "POST",
        token: signToken(USER_ID),
        body: { recipientId: OWNER_ID, role: "owner" },
      }),
    );
    expect(res.status).toBe(404);
    expect(chatthread.create).not.toHaveBeenCalled();
  });

  it("creates an active DM thread immediately when a property is shared", async () => {
    sharedMock.mockResolvedValue([PROPERTY_ID]);
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === USER_ID ? tenantUser() : recipientUser(OWNER_ID)),
    );
    property.findById.mockReturnValue(buildQuery(makeProperty({ _id: PROPERTY_ID })));
    const created = makeChatThread({
      _id: THREAD_ID,
      participants: [USER_ID, OWNER_ID],
      propertyId: PROPERTY_ID,
      kind: "dm",
      status: "active",
    });
    chatthread.create.mockResolvedValue(created);

    const res = await POST(
      buildRequest("/api/v1/chat/threads", {
        method: "POST",
        token: signToken(USER_ID),
        body: { recipientId: OWNER_ID, role: "owner", propertyId: PROPERTY_ID },
      }),
    );
    expect(res.status).toBe(201);
    const payload = chatthread.create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.kind).toBe("dm");
    expect(payload.status).toBe("active");
    expect(payload.participants).toEqual([USER_ID, OWNER_ID]);
    expect(payload.dmKey).toMatch(/^dm:/);
    expect((payload.reads as unknown[]).length).toBe(2);
    expect(notifyMock).not.toHaveBeenCalled();
    const body = await json(res);
    expect((body.thread as { _id: string })._id).toBe(THREAD_ID);
  });

  it("creates a pending request and notifies the recipient when no property is shared", async () => {
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === USER_ID ? tenantUser() : recipientUser(OWNER_ID)),
    );
    chatrequest.findOne.mockReturnValue(buildQuery(null));
    const request = makeChatRequest({ requesterId: USER_ID, recipientId: OWNER_ID });
    chatrequest.create.mockResolvedValue(request);

    const res = await POST(
      buildRequest("/api/v1/chat/threads", {
        method: "POST",
        token: signToken(USER_ID),
        body: { recipientId: OWNER_ID, role: "owner" },
      }),
    );
    expect(res.status).toBe(201);
    expect(chatthread.create).not.toHaveBeenCalled();
    expect(chatrequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ requesterId: USER_ID, recipientId: OWNER_ID, status: "pending" }),
    );
    expect(notifyMock).toHaveBeenCalledWith(request, OWNER_ID, "/dashboard/admin/communications");
    const body = await json(res);
    expect((body.request as { status: string }).status).toBe("pending");
  });

  it("returns the existing pending request without re-notifying on dedupe", async () => {
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === USER_ID ? tenantUser() : recipientUser(OWNER_ID)),
    );
    const existing = makeChatRequest({ requesterId: USER_ID, recipientId: OWNER_ID });
    chatrequest.findOne.mockReturnValue(buildQuery(existing));

    const res = await POST(
      buildRequest("/api/v1/chat/threads", {
        method: "POST",
        token: signToken(USER_ID),
        body: { recipientId: OWNER_ID, role: "owner" },
      }),
    );
    expect(res.status).toBe(200);
    expect(chatrequest.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("lets a non-tenant initiate a conversation", async () => {
    sharedMock.mockResolvedValue([PROPERTY_ID]);
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === AGENT_ID ? caretakerUser(["chat:send"]) : recipientUser(OWNER_ID)),
    );
    managementAssignment.find.mockReturnValue(
      buildQuery([
        activeAssignment({
          principalUserId: AGENT_ID,
          accessRole: "caretaker",
          propertyId: PROPERTY_ID,
          permissions: ["chat:read-own", "chat:send"],
        }),
      ]),
    );
    property.findById.mockReturnValue(buildQuery(makeProperty({ _id: PROPERTY_ID })));
    chatthread.create.mockResolvedValue(makeChatThread({ _id: THREAD_ID }));

    const res = await POST(
      buildRequest("/api/v1/chat/threads", {
        method: "POST",
        token: signToken(AGENT_ID),
        body: { recipientId: OWNER_ID, role: "owner", propertyId: PROPERTY_ID },
      }),
    );
    expect(res.status).toBe(201);
    expect(chatthread.create).toHaveBeenCalled();
  });
});
