/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildQuery } from "@/test/utils/model-mocks";

const m = vi.hoisted(() => ({
  user: { findById: vi.fn(), find: vi.fn() },
  notifyUser: vi.fn(),
}));
vi.mock("@/models/User", () => ({ User: m.user }));
vi.mock("@/lib/notifications", () => ({ notifyUser: m.notifyUser }));

const { describeTerms, notifyBidEvent, notifyBrokerListingReviewed, notifyListingFlagged } =
  await import("@/lib/broker-notify");

const view = {
  _id: "bid-1",
  listingId: "l1",
  listingHeadline: "2BR in Kilimani",
  askingRent: 60000,
  propertyId: "p1",
  property: "Palm Court",
  unitId: "u1",
  status: "pending",
  awaiting: "owner" as const,
  expiresAt: "",
  createdAt: "",
  offers: [
    {
      by: "broker" as const,
      basis: "percentage_of_rent" as const,
      rateBps: 1000,
      fixedAmountMinor: 0,
      currency: "KES" as const,
      at: new Date(),
    },
  ],
  decisionNote: "",
  shareCode: "",
  broker: { id: "broker-1", name: "Jo", agency: "Prime Homes", tenantsBrought: 2 },
};

beforeEach(() => {
  m.user.findById.mockReset();
  m.user.find.mockReset();
  m.notifyUser.mockReset().mockResolvedValue(true);
});

describe("describeTerms", () => {
  it("reads each commission basis in plain words", () => {
    expect(describeTerms({ basis: "first_month_rent" })).toBe("First month's rent");
    expect(describeTerms({ basis: "percentage_of_rent", rateBps: 1250 })).toBe("12.5% of rent");
    expect(describeTerms({ basis: "fixed", fixedAmountMinor: 1_500_000, currency: "USD" })).toBe(
      "USD 15,000 fixed",
    );
  });
});

describe("notifyBidEvent", () => {
  it("sends a new request to the approver's own review page", async () => {
    m.user.findById.mockReturnValue(buildQuery({ role: "custodian", isActive: true }));
    await notifyBidEvent(view, "cust-1", "placed");
    const [userId, input] = m.notifyUser.mock.calls[0];
    expect(userId).toBe("cust-1");
    expect(input.link).toBe("/dashboard/custodian/brokers");
    expect(input.body).toContain("Prime Homes");
    expect(input.body).toContain("10% of rent");
  });

  it("does not notify a deactivated approver", async () => {
    m.user.findById.mockReturnValue(buildQuery({ role: "admin", isActive: false }));
    await notifyBidEvent(view, "owner-1", "placed");
    expect(m.notifyUser).not.toHaveBeenCalled();
  });

  it("tells the broker about a rejection with the reason, without owner details", async () => {
    await notifyBidEvent({ ...view, decisionNote: "Already let" }, "owner-1", "rejected");
    const [userId, input] = m.notifyUser.mock.calls[0];
    expect(userId).toBe("broker-1");
    expect(input.link).toBe("/dashboard/broker?tab=requests");
    expect(input.body).toContain("Already let");
    expect(JSON.stringify(input)).not.toContain("owner-1");
  });
});

describe("listing notices", () => {
  it("alerts every active platform admin about flagged photos (in-app only)", async () => {
    m.user.find.mockReturnValue(buildQuery([{ _id: "sa-1" }, { _id: "sa-2" }]));
    await notifyListingFlagged("l1", 2);
    expect(m.notifyUser).toHaveBeenCalledTimes(2);
    expect(m.notifyUser.mock.calls[0][1]).toMatchObject({
      type: "listing:flagged",
      channels: ["in-app"],
    });
  });

  it("tells the broker their listing review outcome", async () => {
    await notifyBrokerListingReviewed({
      _id: "bl1",
      brokerUserId: "broker-1",
      title: "Villa",
      status: "rejected",
      reviewNote: "Blurry photos",
    });
    expect(m.notifyUser.mock.calls[0][1].body).toContain("Blurry photos");
  });
});
