/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken } from "@/test/utils/api-request";
import { makeObjectId, makeUser } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));
vi.mock("@/models/Tenant", () => ({ Tenant: getModelStubs().tenant }));
vi.mock("@/models/ManagementAssignment", () => ({
  ManagementAssignment: getModelStubs().managementAssignment,
}));

import { GET } from "@/app/api/v1/chat/contacts/route";

const { user, tenant, property, managementAssignment } = getModelStubs();

const USER_ID = makeObjectId("user");
const OWNER_ID = makeObjectId("admin");

function tenantUser() {
  return makeUser({ _id: USER_ID, role: "tenant" });
}

it("401 when unauthenticated", async () => {
  const res = await GET(buildRequest("/api/v1/chat/contacts"));
  expect(res.status).toBe(401);
});

it("403 for a non-tenant", async () => {
  user.findById.mockReturnValue(buildQuery(makeUser({ _id: OWNER_ID, role: "admin" })));
  managementAssignment.find.mockReturnValue(buildQuery([]));

  const res = await GET(buildRequest("/api/v1/chat/contacts", { token: signToken(OWNER_ID) }));
  expect(res.status).toBe(403);
});

describe("GET /api/v1/chat/contacts", () => {
  beforeEach(() => {
    resetModelStubs();
  });

  it("returns an empty list when the tenant has no tenancy", async () => {
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    tenant.find.mockReturnValue(buildQuery([]));

    const res = await GET(buildRequest("/api/v1/chat/contacts", { token: signToken(USER_ID) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("includes custodians alongside owners and caretakers", async () => {
    const propertyId = makeObjectId("prop");
    const caretakerId = makeObjectId("care");
    const custodianId = makeObjectId("cust");
    user.findById.mockReturnValue(buildQuery(tenantUser()));
    tenant.find.mockReturnValue(buildQuery([{ propertyId }]));
    property.find.mockReturnValue(
      buildQuery([{ _id: propertyId, title: "Sunlit Studio", ownerId: OWNER_ID }]),
    );
    managementAssignment.find.mockReturnValue(
      buildQuery([
        { propertyId, principalUserId: caretakerId, accessRole: "caretaker", status: "active" },
        { propertyId, principalUserId: custodianId, accessRole: "custodian", status: "active" },
      ]),
    );
    user.find.mockReturnValue(
      buildQuery([
        makeUser({ _id: OWNER_ID, role: "admin", name: "Peter Kamau" }),
        makeUser({ _id: caretakerId, role: "caretaker", name: "John Kiprono" }),
        makeUser({ _id: custodianId, role: "custodian", name: "Mary Wanjiku" }),
      ]),
    );

    const res = await GET(buildRequest("/api/v1/chat/contacts", { token: signToken(USER_ID) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: OWNER_ID, role: "owner" }),
        expect.objectContaining({ userId: caretakerId, role: "caretaker" }),
        expect.objectContaining({ userId: custodianId, role: "custodian" }),
      ]),
    );
  });
});
