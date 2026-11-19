/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken } from "@/test/utils/api-request";
import {
  makeChatRequest,
  makeChatThread,
  makeObjectId,
  makeTenant,
  makeUser,
} from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/Tenant", () => ({ Tenant: getModelStubs().tenant }));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));
vi.mock("@/models/ChatThread", () => ({ ChatThread: getModelStubs().chatthread }));
vi.mock("@/models/ChatRequest", () => ({ ChatRequest: getModelStubs().chatrequest }));
vi.mock("@/models/ManagementAssignment", () => ({
  ManagementAssignment: getModelStubs().managementAssignment,
}));
vi.mock("@/lib/chat/shared-property", () => ({ sharedPropertyIds: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  notifyChatRequest: vi.fn().mockResolvedValue(true),
  notifyChatRequestDecided: vi.fn().mockResolvedValue(true),
}));

import { GET, POST } from "@/app/api/v1/chat/requests/route";
import { sharedPropertyIds } from "@/lib/chat/shared-property";
import { notifyChatRequest } from "@/lib/notifications";

const { user, tenant, property, chatthread, chatrequest } = getModelStubs();
const REQUESTER = makeObjectId("requester");
const RECIPIENT = makeObjectId("recipient");
const PROPERTY_ID = makeObjectId("prop");
const THREAD_ID = makeObjectId("thread");

function requester() {
  return makeUser({ _id: REQUESTER, role: "tenant" });
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/v1/chat/requests", () => {
  beforeEach(() => {
    resetModelStubs();
    tenant.find.mockReturnValue(
      buildQuery([makeTenant({ _id: makeObjectId("tenant"), userId: REQUESTER })]),
    );
    user.findById.mockReturnValue(buildQuery(requester()));
  });

  it("401 when unauthenticated", async () => {
    const res = await GET(buildRequest("/api/v1/chat/requests"));
    expect(res.status).toBe(401);
  });

  it("400 for an invalid status filter", async () => {
    const res = await GET(
      buildRequest("/api/v1/chat/requests", {
        token: signToken(REQUESTER),
        query: { status: "bogus" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("lists pending requests for the current recipient", async () => {
    user.findById.mockReturnValue(buildQuery(requester()));
    const rows = [makeChatRequest({ recipientId: REQUESTER, requesterId: RECIPIENT })];
    chatrequest.find.mockReturnValue(buildQuery(rows).sort({}).skip(0).limit(10));
    chatrequest.countDocuments.mockResolvedValue(1);

    const res = await GET(
      buildRequest("/api/v1/chat/requests", {
        token: signToken(REQUESTER),
        query: { page: "1", limit: "10" },
      }),
    );
    expect(res.status).toBe(200);
    expect(chatrequest.find).toHaveBeenCalledWith({
      recipientId: REQUESTER,
      status: "pending",
    });
    const body = await json(res);
    expect((body.data as Array<{ _id: string }>)[0]._id).toBe(rows[0]._id);
    expect((body.pagination as { total: number }).total).toBe(1);
  });

  it("honours an explicit status filter", async () => {
    user.findById.mockReturnValue(buildQuery(requester()));
    chatrequest.find.mockReturnValue(buildQuery([]).sort({}).skip(0).limit(10));
    chatrequest.countDocuments.mockResolvedValue(0);

    const res = await GET(
      buildRequest("/api/v1/chat/requests", {
        token: signToken(REQUESTER),
        query: { status: "approved" },
      }),
    );
    expect(res.status).toBe(200);
    expect(chatrequest.find).toHaveBeenCalledWith({
      recipientId: REQUESTER,
      status: "approved",
    });
  });
});

describe("POST /api/v1/chat/requests", () => {
  const sharedMock = vi.mocked(sharedPropertyIds);
  const notifyMock = vi.mocked(notifyChatRequest);

  beforeEach(() => {
    resetModelStubs();
    sharedMock.mockReset().mockResolvedValue([]);
    notifyMock.mockReset().mockResolvedValue(true);
    tenant.find.mockReturnValue(
      buildQuery([makeTenant({ _id: makeObjectId("tenant"), userId: REQUESTER })]),
    );
  });

  function recipient(id: string, role = "admin", isActive = true) {
    return makeUser({ _id: id, role: role as never, isActive });
  }

  it("401 when unauthenticated", async () => {
    const res = await POST(buildRequest("/api/v1/chat/requests", { method: "POST", body: {} }));
    expect(res.status).toBe(401);
  });

  it("400 for an invalid payload", async () => {
    user.findById.mockReturnValue(buildQuery(requester()));
    const res = await POST(
      buildRequest("/api/v1/chat/requests", {
        method: "POST",
        token: signToken(REQUESTER),
        body: { recipientId: "bad" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("404 for an inactive recipient", async () => {
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === REQUESTER ? requester() : recipient(RECIPIENT, "tenant", false)),
    );
    const res = await POST(
      buildRequest("/api/v1/chat/requests", {
        method: "POST",
        token: signToken(REQUESTER),
        body: { recipientId: RECIPIENT },
      }),
    );
    expect(res.status).toBe(404);
    expect(chatrequest.create).not.toHaveBeenCalled();
  });

  it("opens a thread immediately when a property is shared", async () => {
    sharedMock.mockResolvedValue([PROPERTY_ID]);
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === REQUESTER ? requester() : recipient(RECIPIENT)),
    );
    property.findById.mockReturnValue(buildQuery({ _id: PROPERTY_ID, ownerId: RECIPIENT }));
    chatthread.create.mockResolvedValue(makeChatThread({ _id: THREAD_ID }));

    const res = await POST(
      buildRequest("/api/v1/chat/requests", {
        method: "POST",
        token: signToken(REQUESTER),
        body: { recipientId: RECIPIENT, propertyId: PROPERTY_ID },
      }),
    );
    expect(res.status).toBe(201);
    expect(chatthread.create).toHaveBeenCalled();
    expect(chatrequest.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect((await json(res)).thread).toBeTruthy();
  });

  it("creates a pending request and notifies when cross-property", async () => {
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === REQUESTER ? requester() : recipient(RECIPIENT, "caretaker")),
    );
    chatrequest.findOne.mockReturnValue(buildQuery(null));
    const created = makeChatRequest({ requesterId: REQUESTER, recipientId: RECIPIENT });
    chatrequest.create.mockResolvedValue(created);

    const res = await POST(
      buildRequest("/api/v1/chat/requests", {
        method: "POST",
        token: signToken(REQUESTER),
        body: { recipientId: RECIPIENT },
      }),
    );
    expect(res.status).toBe(201);
    expect(notifyMock).toHaveBeenCalledWith(
      created,
      RECIPIENT,
      "/dashboard/caretaker/communications",
    );
    const body = await json(res);
    expect((body.request as { status: string }).status).toBe("pending");
  });

  it("returns 200 for a duplicate pending request", async () => {
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === REQUESTER ? requester() : recipient(RECIPIENT)),
    );
    chatrequest.findOne.mockReturnValue(
      buildQuery(makeChatRequest({ requesterId: REQUESTER, recipientId: RECIPIENT })),
    );

    const res = await POST(
      buildRequest("/api/v1/chat/requests", {
        method: "POST",
        token: signToken(REQUESTER),
        body: { recipientId: RECIPIENT },
      }),
    );
    expect(res.status).toBe(200);
    expect(chatrequest.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
