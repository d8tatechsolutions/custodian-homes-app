/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken, withParams } from "@/test/utils/api-request";
import { makeChatRequest, makeChatThread, makeObjectId, makeUser } from "@/test/utils/factories";
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

import { POST as approve } from "@/app/api/v1/chat/requests/[id]/approve/route";
import { POST as cancel } from "@/app/api/v1/chat/requests/[id]/cancel/route";
import { POST as decline } from "@/app/api/v1/chat/requests/[id]/decline/route";
import { notifyChatRequestDecided } from "@/lib/notifications";

const { user, tenant, chatthread, chatrequest } = getModelStubs();
const REQUESTER = makeObjectId("requester");
const RECIPIENT = makeObjectId("recipient");
const REQUEST_ID = makeObjectId("request");
const THREAD_ID = makeObjectId("thread");

function recipientUser() {
  return makeUser({ _id: RECIPIENT, role: "admin" });
}

function requesterUser() {
  return makeUser({ _id: REQUESTER, role: "tenant" });
}

function pendingRequest() {
  return makeChatRequest({ _id: REQUEST_ID, requesterId: REQUESTER, recipientId: RECIPIENT });
}

function call(handler: typeof approve, id: string, actorId: string) {
  return handler(
    buildRequest(`/api/v1/chat/requests/${id}`, { method: "POST", token: signToken(actorId) }),
    withParams(id),
  );
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("POST /api/v1/chat/requests/[id]/approve", () => {
  beforeEach(() => {
    resetModelStubs();
    tenant.find.mockReturnValue(buildQuery([]));
    vi.mocked(notifyChatRequestDecided).mockReset().mockResolvedValue(true);
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === RECIPIENT ? recipientUser() : requesterUser()),
    );
  });

  it("401 when unauthenticated", async () => {
    const res = await approve(
      buildRequest(`/api/v1/chat/requests/${REQUEST_ID}`, { method: "POST" }),
      withParams(REQUEST_ID),
    );
    expect(res.status).toBe(401);
  });

  it("400 for an invalid request id", async () => {
    const res = await call(approve, "bad", RECIPIENT);
    expect(res.status).toBe(400);
  });

  it("404 for a missing request", async () => {
    chatrequest.findById.mockReturnValue(buildQuery(null));
    const res = await call(approve, REQUEST_ID, RECIPIENT);
    expect(res.status).toBe(404);
  });

  it("409 when the requester tries to approve", async () => {
    chatrequest.findById.mockReturnValue(buildQuery(pendingRequest()));
    const res = await call(approve, REQUEST_ID, REQUESTER);
    expect(res.status).toBe(409);
    expect(chatthread.create).not.toHaveBeenCalled();
  });

  it("creates the DM thread, marks approved and notifies the requester", async () => {
    chatrequest.findById.mockReturnValue(buildQuery(pendingRequest()));
    chatthread.findOne.mockReturnValue(buildQuery(null));
    const thread = makeChatThread({ _id: THREAD_ID, participants: [REQUESTER, RECIPIENT] });
    chatthread.create.mockResolvedValue(thread);
    const decided = {
      ...pendingRequest(),
      status: "approved",
      decidedById: RECIPIENT,
      threadId: THREAD_ID,
    };
    chatrequest.findByIdAndUpdate.mockReturnValue(buildQuery(decided));

    const res = await call(approve, REQUEST_ID, RECIPIENT);
    expect(res.status).toBe(200);
    expect(chatthread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "dm",
        status: "active",
        participants: [REQUESTER, RECIPIENT],
      }),
    );
    const update = chatrequest.findByIdAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set.status).toBe("approved");
    expect(update.$set.decidedById).toBe(RECIPIENT);
    expect(update.$set.threadId).toBe(THREAD_ID);
    expect(vi.mocked(notifyChatRequestDecided)).toHaveBeenCalledWith(
      decided,
      REQUESTER,
      true,
      "/dashboard/tenant/messages",
    );
    expect((await json(res)).thread).toBeTruthy();
  });

  it("reuses an existing thread instead of creating a duplicate", async () => {
    chatrequest.findById.mockReturnValue(buildQuery(pendingRequest()));
    const existing = makeChatThread({ _id: THREAD_ID });
    chatthread.findOne.mockReturnValue(buildQuery(existing));
    chatrequest.findByIdAndUpdate.mockReturnValue(
      buildQuery({ ...pendingRequest(), status: "approved" }),
    );

    const res = await call(approve, REQUEST_ID, RECIPIENT);
    expect(res.status).toBe(200);
    expect(chatthread.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/chat/requests/[id]/decline", () => {
  beforeEach(() => {
    resetModelStubs();
    tenant.find.mockReturnValue(buildQuery([]));
    vi.mocked(notifyChatRequestDecided).mockReset().mockResolvedValue(true);
    user.findById.mockImplementation((id: string) =>
      buildQuery(id === RECIPIENT ? recipientUser() : requesterUser()),
    );
  });

  it("declines without creating a thread and notifies the requester", async () => {
    chatrequest.findById.mockReturnValue(buildQuery(pendingRequest()));
    const decided = { ...pendingRequest(), status: "declined", decidedById: RECIPIENT };
    chatrequest.findByIdAndUpdate.mockReturnValue(buildQuery(decided));

    const res = await call(decline, REQUEST_ID, RECIPIENT);
    expect(res.status).toBe(200);
    expect(chatthread.create).not.toHaveBeenCalled();
    const update = chatrequest.findByIdAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set.status).toBe("declined");
    expect(vi.mocked(notifyChatRequestDecided)).toHaveBeenCalledWith(
      decided,
      REQUESTER,
      false,
      "/dashboard/tenant/messages",
    );
  });

  it("409 when a requester tries to decline", async () => {
    chatrequest.findById.mockReturnValue(buildQuery(pendingRequest()));
    const res = await call(decline, REQUEST_ID, REQUESTER);
    expect(res.status).toBe(409);
  });
});

describe("POST /api/v1/chat/requests/[id]/cancel", () => {
  beforeEach(() => {
    resetModelStubs();
    tenant.find.mockReturnValue(buildQuery([]));
    vi.mocked(notifyChatRequestDecided).mockReset().mockResolvedValue(true);
  });

  it("lets the requester cancel without notifying", async () => {
    user.findById.mockReturnValue(buildQuery(requesterUser()));
    chatrequest.findById.mockReturnValue(buildQuery(pendingRequest()));
    const decided = { ...pendingRequest(), status: "cancelled", decidedById: REQUESTER };
    chatrequest.findByIdAndUpdate.mockReturnValue(buildQuery(decided));

    const res = await call(cancel, REQUEST_ID, REQUESTER);
    expect(res.status).toBe(200);
    const update = chatrequest.findByIdAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set.status).toBe("cancelled");
    expect(vi.mocked(notifyChatRequestDecided)).not.toHaveBeenCalled();
  });

  it("409 when the recipient tries to cancel", async () => {
    user.findById.mockReturnValue(buildQuery(recipientUser()));
    chatrequest.findById.mockReturnValue(buildQuery(pendingRequest()));
    const res = await call(cancel, REQUEST_ID, RECIPIENT);
    expect(res.status).toBe(409);
  });
});
