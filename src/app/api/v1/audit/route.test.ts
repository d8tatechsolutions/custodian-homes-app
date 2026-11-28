/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken, withParams } from "@/test/utils/api-request";
import { makeObjectId } from "@/test/utils/factories";
import { buildQuery } from "@/test/utils/model-mocks";

const m = vi.hoisted(() => ({
  ctx: null as null | Record<string, unknown>,
  eventFind: vi.fn(),
  eventCount: vi.fn(),
  eventFindById: vi.fn(),
  noteFind: vi.fn(),
  noteCreate: vi.fn(),
  userFind: vi.fn(),
  propertyFind: vi.fn(),
  invoiceFind: vi.fn(),
  leaseFind: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/auth-scope", () => ({ resolveRequestContext: vi.fn(async () => m.ctx) }));
vi.mock("@/lib/audit-records", () => ({ recordAudit: m.recordAudit }));
vi.mock("@/models/AuditEvent", () => ({
  AuditEvent: { find: m.eventFind, countDocuments: m.eventCount, findById: m.eventFindById },
}));
vi.mock("@/models/AuditNote", () => ({ AuditNote: { find: m.noteFind, create: m.noteCreate } }));
vi.mock("@/models/User", () => ({ User: { find: m.userFind } }));
vi.mock("@/models/Property", () => ({ Property: { find: m.propertyFind } }));
vi.mock("@/models/Invoice", () => ({ Invoice: { find: m.invoiceFind } }));
vi.mock("@/models/Lease", () => ({ Lease: { find: m.leaseFind } }));

const { GET } = await import("@/app/api/v1/audit/route");
const { POST: ADD_NOTE } = await import("@/app/api/v1/audit/[id]/notes/route");

const USER = makeObjectId("viewer");
const EVENT = makeObjectId("event");

function signedIn(role: string, extra: Record<string, unknown> = {}) {
  m.ctx = {
    auth: { userId: USER },
    user: { _id: USER, role, isActive: true, name: "Viewer" },
    assignments: vi.fn(async () => []),
    tenantRows: vi.fn(async () => []),
    ...extra,
  };
}

function lastFilter() {
  return m.eventFind.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  m.eventFind.mockReturnValue(buildQuery([]));
  m.eventCount.mockResolvedValue(0);
  m.noteFind.mockReturnValue(buildQuery([]));
  m.userFind.mockReturnValue(buildQuery([]));
  m.propertyFind.mockReturnValue(buildQuery([]));
  m.invoiceFind.mockReturnValue(buildQuery([]));
  m.leaseFind.mockReturnValue(buildQuery([]));
});

describe("GET /api/v1/audit", () => {
  it("401 when signed out", async () => {
    m.ctx = { auth: null, user: null };
    const res = await GET(buildRequest("/api/v1/audit"));
    expect(res.status).toBe(401);
  });

  it("system admin queries everything and may add notes", async () => {
    signedIn("system-admin");
    const res = await GET(buildRequest("/api/v1/audit", { token: signToken(USER) }));
    expect(res.status).toBe(200);
    expect(lastFilter()).toEqual({});
    const body = await res.json();
    expect(body.canAddNotes).toBe(true);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("an owner is limited to owned and assigned properties", async () => {
    signedIn("admin", { assignments: vi.fn(async () => [{ propertyId: "p-assigned" }]) });
    m.propertyFind.mockReturnValueOnce(buildQuery([{ _id: "p-owned" }]));
    const res = await GET(buildRequest("/api/v1/audit", { token: signToken(USER) }));
    expect(res.status).toBe(200);
    expect(m.propertyFind).toHaveBeenCalledWith({ ownerId: USER });
    expect(lastFilter()).toEqual({
      $or: [{ actorUserId: USER }, { "scope.propertyId": { $in: ["p-assigned", "p-owned"] } }],
    });
    expect((await res.json()).canAddNotes).toBe(false);
  });

  it("a tenant is limited to their own invoices and leases", async () => {
    signedIn("tenant", { tenantRows: vi.fn(async () => [{ _id: "tenant-row" }]) });
    m.invoiceFind.mockReturnValueOnce(buildQuery([{ _id: "inv-1" }]));
    m.leaseFind.mockReturnValueOnce(buildQuery([{ _id: "lease-1" }]));
    await GET(buildRequest("/api/v1/audit", { token: signToken(USER) }));
    expect(m.invoiceFind).toHaveBeenCalledWith({ tenantId: { $in: ["tenant-row"] } });
    expect(lastFilter().$or).toContainEqual({
      entityType: "invoice",
      entityId: { $in: ["inv-1"] },
    });
    expect(lastFilter().$or).toContainEqual({
      entityType: "lease",
      entityId: { $in: ["lease-1"] },
    });
  });

  it("never selects request fingerprints", async () => {
    signedIn("system-admin");
    const select = vi.fn().mockReturnThis();
    m.eventFind.mockReturnValue({ ...buildQuery([]), select });
    await GET(buildRequest("/api/v1/audit", { token: signToken(USER) }));
    expect(select).toHaveBeenCalledWith("-ipHash -userAgentHash -requestId");
  });

  it("rejects operator-like filters and bad dates", async () => {
    signedIn("system-admin");
    const bad = await GET(
      buildRequest("/api/v1/audit", { token: signToken(USER), query: { type: "$ne" } }),
    );
    expect(bad.status).toBe(400);
    const badDate = await GET(
      buildRequest("/api/v1/audit", { token: signToken(USER), query: { from: "yesterday" } }),
    );
    expect(badDate.status).toBe(400);
    const proto = await GET(
      buildRequest("/api/v1/audit", { token: signToken(USER), query: { type: "constructor" } }),
    );
    expect(proto.status).toBe(400);
  });

  it("applies the entity and date filters inside the visibility rule", async () => {
    signedIn("caretaker", { assignments: vi.fn(async () => [{ propertyId: "p1" }]) });
    await GET(
      buildRequest("/api/v1/audit", {
        token: signToken(USER),
        query: { type: "invoice", from: "2026-11-01", to: "2026-11-30" },
      }),
    );
    const filter = lastFilter();
    expect(filter.$and[0]).toEqual({
      $or: [{ actorUserId: USER }, { "scope.propertyId": { $in: ["p1"] } }],
    });
    expect(filter.$and[1]).toEqual({ entityType: { $in: ["invoice", "invoice-run"] } });
    expect(filter.$and[2].createdAt.$gte.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(filter.$and[2].createdAt.$lt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("POST /api/v1/audit/:id/notes", () => {
  function addNote(text: unknown, id = EVENT) {
    return ADD_NOTE(
      buildRequest(`/api/v1/audit/${id}/notes`, {
        method: "POST",
        token: signToken(USER),
        body: { text },
      }),
      withParams(id),
    );
  }

  it("only the system admin can add a note", async () => {
    signedIn("admin");
    const res = await addNote("Checked");
    expect(res.status).toBe(403);
    expect(m.noteCreate).not.toHaveBeenCalled();
  });

  it("stores the note beside the entry and records that it was added", async () => {
    signedIn("system-admin");
    m.eventFindById.mockReturnValue(buildQuery({ _id: EVENT, scope: { propertyId: "p1" } }));
    m.noteCreate.mockResolvedValue({
      _id: "n1",
      authorName: "Viewer",
      text: "Checked with the owner",
      createdAt: new Date("2026-11-28T10:00:00Z"),
    });
    const res = await addNote("  Checked with the owner  ");
    expect(res.status).toBe(201);
    expect(m.noteCreate).toHaveBeenCalledWith({
      auditEventId: EVENT,
      authorUserId: USER,
      authorName: "Viewer",
      text: "Checked with the owner",
    });
    expect(m.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "audit.note_added", entityId: EVENT }),
    );
  });

  it("rejects empty, oversized and non-text notes, and unknown entries", async () => {
    signedIn("system-admin");
    expect((await addNote("")).status).toBe(400);
    expect((await addNote("x".repeat(1001))).status).toBe(400);
    expect((await addNote({ $gt: "" })).status).toBe(400);
    expect((await addNote("ok", "not-an-id")).status).toBe(400);
    m.eventFindById.mockReturnValue(buildQuery(null));
    expect((await addNote("ok")).status).toBe(404);
  });
});
