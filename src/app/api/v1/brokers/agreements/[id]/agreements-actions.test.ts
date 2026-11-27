/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken } from "@/test/utils/api-request";
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
vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/CommissionAgreement", () => ({
  CommissionAgreement: getModelStubs().commissionAgreement,
}));

import { POST as acceptAgreement } from "@/app/api/v1/brokers/agreements/[id]/accept/route";
import { POST as terminateAgreement } from "@/app/api/v1/brokers/agreements/[id]/terminate/route";

const { user, commissionAgreement } = getModelStubs();
const ADMIN_ID = makeObjectId("admin");
const BROKER_ID = makeObjectId("broker");

describe("/api/v1/brokers/agreements/[id] actions", () => {
  beforeEach(() => {
    resetModelStubs();
  });

  describe("accept", () => {
    it("allows broker to accept their agreement", async () => {
      commissionAgreement.findById
        .mockReturnValueOnce(
          buildQuery({
            _id: "6a0000000000000000000a01",
            brokerId: BROKER_ID,
            status: "draft",
          }),
        )
        .mockReturnValueOnce(
          buildQuery({
            _id: "6a0000000000000000000a01",
            brokerId: BROKER_ID,
            status: "active",
          }),
        );
      commissionAgreement.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const res = await acceptAgreement(
        buildRequest("/api/v1/brokers/agreements/6a0000000000000000000a01/accept", {
          method: "POST",
          token: signToken(BROKER_ID),
        }),
        { params: Promise.resolve({ id: "6a0000000000000000000a01" }) },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.agreement.status).toBe("active");
    });
  });

  describe("terminate", () => {
    it("terminates agreement when called by system-admin", async () => {
      user.findById.mockReturnValue(buildQuery(makeUser({ _id: ADMIN_ID, role: "system-admin" })));
      commissionAgreement.findById
        .mockReturnValueOnce(
          buildQuery({
            _id: "6a0000000000000000000a01",
            brokerId: BROKER_ID,
            propertyId: "prop-1",
            scopeType: "property",
            scopeId: "prop-1",
            status: "active",
          }),
        )
        .mockReturnValueOnce(
          buildQuery({
            _id: "6a0000000000000000000a01",
            brokerId: BROKER_ID,
            status: "terminated",
          }),
        );
      commissionAgreement.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const res = await terminateAgreement(
        buildRequest("/api/v1/brokers/agreements/6a0000000000000000000a01/terminate", {
          method: "POST",
          token: signToken(ADMIN_ID),
          body: { reason: "Terms ended" },
        }),
        { params: Promise.resolve({ id: "6a0000000000000000000a01" }) },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.agreement.status).toBe("terminated");
    });
  });
});
