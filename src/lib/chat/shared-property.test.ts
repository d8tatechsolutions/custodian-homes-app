/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAssignedPropertyIds } from "@/lib/managed-owner";
import { makeObjectId } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/managed-owner", () => ({ getAssignedPropertyIds: vi.fn() }));
vi.mock("@/models/Tenant", () => ({ Tenant: getModelStubs().tenant }));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));

import { sharedPropertyIds } from "@/lib/chat/shared-property";

const { tenant, property } = getModelStubs();
const REQUESTER = makeObjectId("requester");
const RECIPIENT = makeObjectId("recipient");
const P1 = makeObjectId("p1");
const P2 = makeObjectId("p2");

describe("sharedPropertyIds", () => {
  beforeEach(() => {
    resetModelStubs();
    vi.mocked(getAssignedPropertyIds).mockReset().mockResolvedValue([]);
    tenant.find.mockImplementation((filter: { userId: string }) =>
      buildQuery(filter.userId === REQUESTER ? [{ propertyId: P1 }] : [{ propertyId: P2 }]),
    );
    property.find.mockReturnValue(buildQuery([]));
  });

  it("returns the intersection of tenancy properties", async () => {
    tenant.find.mockImplementation((filter: { userId: string }) =>
      buildQuery(
        filter.userId === REQUESTER
          ? [{ propertyId: P1 }, { propertyId: P2 }]
          : [{ propertyId: P2 }],
      ),
    );
    expect(await sharedPropertyIds(REQUESTER, RECIPIENT)).toEqual([P2]);
  });

  it("counts management assignments as property membership", async () => {
    vi.mocked(getAssignedPropertyIds).mockImplementation(async (userId, role) =>
      userId === RECIPIENT && role === "caretaker" ? [P1] : [],
    );
    expect(await sharedPropertyIds(REQUESTER, RECIPIENT)).toEqual([P1]);
  });

  it("counts admin ownership as property membership", async () => {
    tenant.find.mockImplementation((filter: { userId: string }) =>
      buildQuery(filter.userId === REQUESTER ? [{ propertyId: P1 }] : []),
    );
    property.find.mockImplementation((filter: { ownerId: string }) =>
      buildQuery(filter.ownerId === RECIPIENT ? [{ _id: P1 }] : []),
    );
    expect(await sharedPropertyIds(REQUESTER, RECIPIENT)).toEqual([P1]);
  });

  it("returns empty when the users share nothing", async () => {
    expect(await sharedPropertyIds(REQUESTER, RECIPIENT)).toEqual([]);
  });
});
