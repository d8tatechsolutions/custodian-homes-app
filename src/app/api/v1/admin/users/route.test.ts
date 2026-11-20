/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken } from "@/test/utils/api-request";
import { makeObjectId, makeUser } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));

import { GET } from "@/app/api/v1/admin/users/route";

const models = getModelStubs();
const SYS_ADMIN_ID = makeObjectId("sysadmin");
const OWNER_ID = makeObjectId("admin");

function sysAdminDoc() {
  return makeUser({ _id: SYS_ADMIN_ID, role: "system-admin" });
}

describe("GET /api/v1/admin/users", () => {
  beforeEach(() => {
    resetModelStubs();
    process.env.ROLE_MANAGEMENT_ENABLED = "true";
    models.user.findById.mockReturnValue(buildQuery(sysAdminDoc()));
  });

  afterEach(() => {
    delete process.env.ROLE_MANAGEMENT_ENABLED;
  });

  it("401 when unauthenticated", async () => {
    const res = await GET(buildRequest("/api/v1/admin/users"));
    expect(res.status).toBe(401);
  });

  it("404 when the feature flag is disabled", async () => {
    process.env.ROLE_MANAGEMENT_ENABLED = "false";
    const res = await GET(buildRequest("/api/v1/admin/users", { token: signToken(SYS_ADMIN_ID) }));
    expect(res.status).toBe(404);
  });

  it("403 for a non-system-admin actor", async () => {
    models.user.findById.mockReturnValue(buildQuery(makeUser({ _id: OWNER_ID, role: "admin" })));
    const res = await GET(buildRequest("/api/v1/admin/users", { token: signToken(OWNER_ID) }));
    expect(res.status).toBe(403);
  });

  it("401 when the token is stale (tokenVersion mismatch)", async () => {
    const res = await GET(
      buildRequest("/api/v1/admin/users", {
        token: signToken(SYS_ADMIN_ID, { tokenVersion: 99 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("lists users with pagination", async () => {
    const users = [
      makeUser({ _id: makeObjectId("u1"), name: "User One", role: "tenant" }),
      makeUser({ _id: makeObjectId("u2"), name: "User Two", role: "admin" }),
    ];
    models.user.find.mockReturnValue(buildQuery(users));
    models.user.countDocuments.mockResolvedValue(2);

    const res = await GET(buildRequest("/api/v1/admin/users", { token: signToken(SYS_ADMIN_ID) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      pagination: { total: number; page: number; limit: number };
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ name: "User One", role: "tenant" });
    expect(body.pagination.total).toBe(2);
  });

  it("applies role and search filters", async () => {
    models.user.find.mockReturnValue(buildQuery([]));
    models.user.countDocuments.mockResolvedValue(0);

    const res = await GET(
      buildRequest("/api/v1/admin/users", {
        token: signToken(SYS_ADMIN_ID),
        query: { role: "caretaker", search: "ann", page: "2", limit: "5" },
      }),
    );
    expect(res.status).toBe(200);
    const filter = models.user.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(filter.role).toBe("caretaker");
    expect(filter.$or).toBeDefined();
  });

  it("treats a code-shaped search as an exact userCode match and skips the count", async () => {
    const found = makeUser({
      _id: makeObjectId("coded"),
      name: "Coded Tenant",
      role: "tenant",
    });
    models.user.find.mockReturnValue(buildQuery([{ ...found, userCode: "C4K7M2Q" }]));

    const res = await GET(
      buildRequest("/api/v1/admin/users", {
        token: signToken(SYS_ADMIN_ID),
        query: { search: "c4k7m2q" },
      }),
    );
    expect(res.status).toBe(200);

    const filter = models.user.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(filter.userCode).toEqual({ $eq: "C4K7M2Q", $gt: "" });
    // The text scan must not be built for a code-shaped term.
    expect(filter.$or).toBeUndefined();
    expect(models.user.countDocuments).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      pagination: { total: number };
    };
    expect(body.data[0]).toMatchObject({ userCode: "C4K7M2Q" });
    expect(body.pagination.total).toBe(1);
  });

  it("keeps the name/email/phone regex for a term that is not a code", async () => {
    models.user.find.mockReturnValue(buildQuery([]));
    models.user.countDocuments.mockResolvedValue(0);

    const res = await GET(
      buildRequest("/api/v1/admin/users", {
        token: signToken(SYS_ADMIN_ID),
        query: { search: "Chandra Mwangi" },
      }),
    );
    expect(res.status).toBe(200);

    const filter = models.user.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(filter.userCode).toBeUndefined();
    expect(filter.$or).toEqual([
      { name: expect.any(RegExp) },
      { email: expect.any(RegExp) },
      { phone: expect.any(RegExp) },
    ]);
    expect(models.user.countDocuments).toHaveBeenCalledTimes(1);
  });

  it("projects and serialises userCode without widening the projection", async () => {
    models.user.find.mockReturnValue(buildQuery([]));
    models.user.countDocuments.mockResolvedValue(0);

    await GET(buildRequest("/api/v1/admin/users", { token: signToken(SYS_ADMIN_ID) }));

    const chain = models.user.find.mock.results[0]?.value as {
      select: { mock: { calls: unknown[][] } };
    };
    const projection = chain.select.mock.calls[0]?.[0] as string;
    expect(projection).toContain("userCode");
    expect(projection).not.toContain("nationalId");
    expect(projection).not.toContain("passwordHash");
    expect(projection).not.toContain("verificationToken");
  });
});
