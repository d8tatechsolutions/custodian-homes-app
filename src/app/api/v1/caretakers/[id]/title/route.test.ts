/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken, withParams } from "@/test/utils/api-request";
import { makeObjectId, makeUser } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

// These route tests stub the database per test. authenticateSession also checks the
// account is active and the token is not revoked (covered in auth-scope.test.ts);
// here it reads the token only, as the routes did before that check existed.
vi.mock("@/lib/auth-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-scope")>();
  const { authenticate } = await import("@/lib/permissions");
  return { ...actual, authenticateSession: async (request: Request) => authenticate(request) };
});

const mocks = vi.hoisted(() => ({
  getManagedOwnerId: vi.fn(),
  getAdminAssignmentScope: vi.fn(),
}));

vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/managed-owner", () => ({ getManagedOwnerId: mocks.getManagedOwnerId }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getAdminAssignmentScope: mocks.getAdminAssignmentScope,
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));

const { PUT } = await import("@/app/api/v1/caretakers/[id]/title/route");
const { writeAuditEvent } = await import("@/lib/audit");

const { user, property } = getModelStubs();
const OWNER_ID = makeObjectId("owner");
const OTHER_OWNER_ID = makeObjectId("other");
const SYS_ID = makeObjectId("sys");
const CARE_ID = makeObjectId("care");
const PROP_ID = makeObjectId("prop");

function stubActorAndTarget(actorRole: string, actorId: string, targetRole = "caretaker") {
  user.findById
    .mockReturnValueOnce(buildQuery(makeUser({ _id: actorId, role: actorRole as never })))
    .mockReturnValueOnce(buildQuery(makeUser({ _id: CARE_ID, role: targetRole as never })));
}

function put(token: string, body: unknown, id = CARE_ID) {
  return PUT(
    buildRequest(`/api/v1/caretakers/${id}/title`, {
      method: "PUT",
      token,
      body: body as Record<string, unknown>,
    }),
    withParams(id),
  );
}

describe("PUT /api/v1/caretakers/[id]/title", () => {
  beforeEach(() => {
    resetModelStubs();
    mocks.getManagedOwnerId.mockReset();
    mocks.getAdminAssignmentScope.mockReset();
    mocks.getAdminAssignmentScope.mockResolvedValue({ assignedPropertyIds: [] });
    vi.mocked(writeAuditEvent).mockClear();
    user.updateOne.mockResolvedValue({ acknowledged: true });
  });

  it("401 without a session", async () => {
    const res = await PUT(
      buildRequest(`/api/v1/caretakers/${CARE_ID}/title`, { method: "PUT", body: { agent: true } }),
      withParams(CARE_ID),
    );
    expect(res.status).toBe(401);
  });

  it("400 for an invalid id", async () => {
    const res = await put(signToken(OWNER_ID), { agent: true }, "nope");
    expect(res.status).toBe(400);
  });

  it("lets the owner the caretaker works for mark them as agent", async () => {
    stubActorAndTarget("admin", OWNER_ID);
    mocks.getManagedOwnerId.mockResolvedValue(OWNER_ID);
    const res = await put(signToken(OWNER_ID), { agent: true });
    expect(res.status).toBe(200);
    expect((await res.json()).data.staffTitle).toBe("agent");
    expect(user.updateOne).toHaveBeenCalledWith(
      { _id: CARE_ID },
      { $set: { staffTitle: "agent" } },
    );
    expect(writeAuditEvent).toHaveBeenCalledOnce();
  });

  it("clears the title when agent is false", async () => {
    stubActorAndTarget("admin", OWNER_ID);
    mocks.getManagedOwnerId.mockResolvedValue(OWNER_ID);
    const res = await put(signToken(OWNER_ID), { agent: false });
    expect(res.status).toBe(200);
    expect(user.updateOne).toHaveBeenCalledWith({ _id: CARE_ID }, { $set: { staffTitle: "" } });
  });

  it("allows an admin delegated on the caretaker's owner's property", async () => {
    stubActorAndTarget("admin", OTHER_OWNER_ID);
    mocks.getManagedOwnerId.mockResolvedValue(OWNER_ID);
    mocks.getAdminAssignmentScope.mockResolvedValue({ assignedPropertyIds: [PROP_ID] });
    property.find.mockReturnValue(buildQuery([{ _id: PROP_ID, ownerId: OWNER_ID }]));
    const res = await put(signToken(OTHER_OWNER_ID), { agent: true });
    expect(res.status).toBe(200);
  });

  it("403 for another owner's caretaker", async () => {
    stubActorAndTarget("admin", OTHER_OWNER_ID);
    mocks.getManagedOwnerId.mockResolvedValue(OWNER_ID);
    const res = await put(signToken(OTHER_OWNER_ID), { agent: true });
    expect(res.status).toBe(403);
    expect(user.updateOne).not.toHaveBeenCalled();
  });

  it("403 for an unbound caretaker", async () => {
    stubActorAndTarget("admin", OWNER_ID);
    mocks.getManagedOwnerId.mockResolvedValue("");
    const res = await put(signToken(OWNER_ID), { agent: true });
    expect(res.status).toBe(403);
  });

  it("403 for custodians and caretakers", async () => {
    for (const role of ["custodian", "caretaker", "tenant", "broker"]) {
      user.findById.mockReturnValueOnce(
        buildQuery(makeUser({ _id: OWNER_ID, role: role as never })),
      );
      const res = await put(signToken(OWNER_ID), { agent: true });
      expect(res.status).toBe(403);
    }
    expect(user.updateOne).not.toHaveBeenCalled();
  });

  it("lets the system-admin set the title", async () => {
    stubActorAndTarget("system-admin", SYS_ID);
    const res = await put(signToken(SYS_ID), { agent: true });
    expect(res.status).toBe(200);
    expect(mocks.getManagedOwnerId).not.toHaveBeenCalled();
  });

  it("400 when the target is not a caretaker", async () => {
    stubActorAndTarget("admin", OWNER_ID, "custodian");
    const res = await put(signToken(OWNER_ID), { agent: true });
    expect(res.status).toBe(400);
  });

  it("400 for a bad body", async () => {
    user.findById.mockReturnValueOnce(buildQuery(makeUser({ _id: OWNER_ID, role: "admin" })));
    const res = await put(signToken(OWNER_ID), { agent: "yes" });
    expect(res.status).toBe(400);
  });
});
