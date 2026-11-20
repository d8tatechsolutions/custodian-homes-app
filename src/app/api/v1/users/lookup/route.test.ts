/** @vitest-environment node */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken } from "@/test/utils/api-request";
import { makeObjectId, makeUser } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

const { rateLimitMock } = vi.hoisted(() => ({ rateLimitMock: vi.fn() }));

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  rateLimitHeaders: vi.fn((response: unknown) => response),
  checkSameOrigin: vi.fn(() => null),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));

import { GET } from "@/app/api/v1/users/lookup/route";
import { writeAuditEvent } from "@/lib/audit";

const { user } = getModelStubs();

const SYS_ADMIN_ID = makeObjectId("sysadmin");
const TARGET_ID = makeObjectId("target");
const VALID_CODE = "C4K7M2Q";

const rateCounts = new Map<string, number>();

function adminDoc() {
  return makeUser({ _id: SYS_ADMIN_ID, role: "system-admin", tokenVersion: 0 });
}

function targetDoc(overrides: Record<string, unknown> = {}) {
  return {
    ...makeUser({
      _id: TARGET_ID,
      name: "Target Tenant",
      email: "target@keja.co",
      phone: "+254712345678",
      role: "tenant",
      isActive: true,
    }),
    userCode: VALID_CODE,
    ...overrides,
  };
}

function lookupRequest(code?: string, token: string = signToken(SYS_ADMIN_ID)) {
  return buildRequest("/api/v1/users/lookup", {
    token,
    query: code === undefined ? {} : { code },
  });
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/v1/users/lookup", () => {
  beforeEach(() => {
    resetModelStubs();
    rateCounts.clear();
    rateLimitMock.mockReset();
    vi.mocked(writeAuditEvent).mockReset();
    vi.mocked(writeAuditEvent).mockResolvedValue(undefined);

    // Mirrors the real limiter's contract: per-key counters, a 429 response
    // once the limit is exceeded, and no rate-limit headers on success.
    rateLimitMock.mockImplementation(
      async (_request: unknown, options?: { windowMs?: number; limit?: number; key?: string }) => {
        const key = options?.key ?? "unkeyed";
        const count = (rateCounts.get(key) ?? 0) + 1;
        rateCounts.set(key, count);
        const limit = options?.limit ?? 10;
        if (count > limit) {
          return NextResponse.json(
            { error: "Too many requests. Please try again later." },
            { status: 429 },
          );
        }
        return { remaining: limit - count, reset: Date.now() + (options?.windowMs ?? 60_000) };
      },
    );

    user.findById.mockReturnValue(buildQuery(adminDoc()));
    user.findOne.mockReturnValue(buildQuery(null));
  });

  it("401 when unauthenticated", async () => {
    const res = await GET(buildRequest("/api/v1/users/lookup", { query: { code: VALID_CODE } }));
    expect(res.status).toBe(401);
    // The actor is resolved before the limiter, so nothing is throttled or queried.
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(user.findOne).not.toHaveBeenCalled();
  });

  it.each(["tenant", "admin", "caretaker", "custodian", "broker"] as const)(
    "403 for the non-allowlisted role %s",
    async (role) => {
      user.findById.mockReturnValue(buildQuery(makeUser({ _id: SYS_ADMIN_ID, role })));

      const res = await GET(lookupRequest(VALID_CODE));
      expect(res.status).toBe(403);
      expect(rateLimitMock).not.toHaveBeenCalled();
      expect(user.findOne).not.toHaveBeenCalled();
    },
  );

  it("403 for an inactive system-admin", async () => {
    user.findById.mockReturnValue(
      buildQuery(makeUser({ _id: SYS_ADMIN_ID, role: "system-admin", isActive: false })),
    );

    const res = await GET(lookupRequest(VALID_CODE));
    expect(res.status).toBe(403);
    expect(user.findOne).not.toHaveBeenCalled();
  });

  it("401 when the actor token is stale (tokenVersion mismatch)", async () => {
    const res = await GET(
      buildRequest("/api/v1/users/lookup", {
        token: signToken(SYS_ADMIN_ID, { tokenVersion: 99 }),
        query: { code: VALID_CODE },
      }),
    );
    expect(res.status).toBe(401);
    expect(user.findOne).not.toHaveBeenCalled();
  });

  it.each(["C12345", "C1234567", "X123456", "CI23456"])(
    "400 for the malformed code %s without touching the database",
    async (code) => {
      const res = await GET(lookupRequest(code));
      expect(res.status).toBe(400);
      expect(user.findOne).not.toHaveBeenCalled();
      expect(user.find).not.toHaveBeenCalled();
      expect(user.countDocuments).not.toHaveBeenCalled();
      expect(writeAuditEvent).not.toHaveBeenCalled();
    },
  );

  it("returns exactly the five allowlisted fields on a hit", async () => {
    user.findOne.mockReturnValue(buildQuery(targetDoc()));

    const res = await GET(lookupRequest(VALID_CODE));
    expect(res.status).toBe(200);

    const body = await json(res);
    expect(body).toEqual({
      data: [
        {
          id: TARGET_ID,
          name: "Target Tenant",
          role: "tenant",
          isActive: true,
          userCode: VALID_CODE,
        },
      ],
    });

    const [row] = body.data as Array<Record<string, unknown>>;
    expect(Object.keys(row).sort()).toEqual(["id", "isActive", "name", "role", "userCode"]);
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("phone");
    expect(res.headers.get("x-ratelimit-remaining")).toBeNull();
  });

  it("normalises lowercase input before querying", async () => {
    user.findOne.mockReturnValue(buildQuery(targetDoc()));

    const res = await GET(lookupRequest("c4k7m2q"));
    expect(res.status).toBe(200);
    expect(user.findOne).toHaveBeenCalledWith({
      userCode: { $eq: VALID_CODE, $gt: "" },
    });
  });

  it("returns a uniform empty result and warns on a miss", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await GET(lookupRequest(VALID_CODE));
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ data: [] });
      expect(warn).toHaveBeenCalledWith("[user-code] lookup miss", {
        actorUserId: SYS_ADMIN_ID,
        code: VALID_CODE,
      });
      expect(writeAuditEvent).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("writes the lookup audit event on a hit", async () => {
    user.findOne.mockReturnValue(buildQuery(targetDoc()));

    await GET(lookupRequest(VALID_CODE));

    expect(writeAuditEvent).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { userId: SYS_ADMIN_ID, role: "system-admin" },
        action: "user.code_lookup",
        entityType: "user",
        entityId: TARGET_ID,
        after: { userCode: VALID_CODE, surface: "lookup" },
      }),
    );
  });

  it("fails the request when the audit write fails", async () => {
    user.findOne.mockReturnValue(buildQuery(targetDoc()));
    vi.mocked(writeAuditEvent).mockRejectedValueOnce(new Error("audit unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await GET(lookupRequest(VALID_CODE));
      expect(res.status).toBe(500);
      expect(await json(res)).not.toHaveProperty("data");
    } finally {
      error.mockRestore();
    }
  });

  it("keys both limiter buckets to the actor and 429s the 11th call in the window", async () => {
    user.findOne.mockReturnValue(buildQuery(null));

    let res: Response | undefined;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      res = await GET(lookupRequest(VALID_CODE));
    }

    expect(res?.status).toBe(429);
    expect(res?.headers.get("x-ratelimit-remaining")).toBeNull();

    const keys = rateLimitMock.mock.calls.map(
      ([, options]) => (options as { key?: string } | undefined)?.key,
    );
    expect(keys).toContain(`user-code-lookup:${SYS_ADMIN_ID}`);
    expect(keys).toContain(`user-code-lookup-day:${SYS_ADMIN_ID}`);
    // No bucket may fall back to the spoofable IP path.
    expect(keys.every((key) => typeof key === "string" && key.startsWith("user-code-lookup"))).toBe(
      true,
    );
  });
});
