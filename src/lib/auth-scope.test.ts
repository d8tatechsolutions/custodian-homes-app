/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken } from "@/test/utils/api-request";
import { makeObjectId } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));

import { authenticateSession } from "@/lib/auth-scope";

const { user } = getModelStubs();
const USER_ID = makeObjectId("session-user");

function request(tokenVersion: number | undefined, role = "admin") {
  return buildRequest("/api/v1/contact", {
    token: signToken(USER_ID, { role, ...(tokenVersion === undefined ? {} : { tokenVersion }) }),
  });
}

describe("authenticateSession", () => {
  beforeEach(() => {
    resetModelStubs();
  });

  it("returns the user while the account is active and the token is current", async () => {
    user.findById.mockReturnValue(
      buildQuery({ _id: USER_ID, role: "admin", isActive: true, tokenVersion: 2 }),
    );
    const session = await authenticateSession(request(2));
    expect(session?.userId).toBe(USER_ID);
    expect(session?.role).toBe("admin");
  });

  it("treats a missing tokenVersion as 0 on both sides", async () => {
    user.findById.mockReturnValue(buildQuery({ _id: USER_ID, role: "tenant", isActive: true }));
    expect(await authenticateSession(request(undefined, "tenant"))).not.toBeNull();
  });

  it("refuses a token revoked by sign-out everywhere, a role change or a reset", async () => {
    user.findById.mockReturnValue(
      buildQuery({ _id: USER_ID, role: "admin", isActive: true, tokenVersion: 3 }),
    );
    expect(await authenticateSession(request(2))).toBeNull();
  });

  it("refuses a deactivated or deleted account", async () => {
    user.findById.mockReturnValue(
      buildQuery({ _id: USER_ID, role: "admin", isActive: false, tokenVersion: 0 }),
    );
    expect(await authenticateSession(request(0))).toBeNull();

    user.findById.mockReturnValue(buildQuery(null));
    expect(await authenticateSession(request(0))).toBeNull();
  });

  it("uses the role on the account, not the one in the token", async () => {
    user.findById.mockReturnValue(
      buildQuery({ _id: USER_ID, role: "tenant", isActive: true, tokenVersion: 0 }),
    );
    expect((await authenticateSession(request(0, "admin")))?.role).toBe("tenant");
  });

  it("returns null without a valid token and never queries the database", async () => {
    expect(await authenticateSession(buildRequest("/api/v1/contact"))).toBeNull();
    expect(
      await authenticateSession(buildRequest("/api/v1/contact", { token: "not-a-jwt" })),
    ).toBeNull();
    expect(user.findById).not.toHaveBeenCalled();
  });
});
