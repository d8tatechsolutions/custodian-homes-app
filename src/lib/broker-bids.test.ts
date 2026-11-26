/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildQuery } from "@/test/utils/model-mocks";

const s = vi.hoisted(() => {
  const model = () => ({
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    exists: vi.fn(),
  });
  return {
    bid: model(),
    profile: model(),
    listing: model(),
    publisher: model(),
    property: model(),
    agreement: model(),
    authorization: model(),
    user: model(),
    brokers: {
      authorizeBroker: vi.fn(),
      createCommissionAgreement: vi.fn(),
      createBrokerListingPublisher: vi.fn(),
    },
    approver: vi.fn(),
  };
});

vi.mock("@/models/BrokerBid", () => ({
  BrokerBid: s.bid,
  OPEN_BID_STATUSES: ["pending", "countered"],
}));
vi.mock("@/models/BrokerProfile", () => ({ BrokerProfile: s.profile }));
vi.mock("@/models/Listing", () => ({ Listing: s.listing }));
vi.mock("@/models/ListingPublisher", () => ({ ListingPublisher: s.publisher }));
vi.mock("@/models/Property", () => ({ Property: s.property }));
vi.mock("@/models/CommissionAgreement", () => ({ CommissionAgreement: s.agreement }));
vi.mock("@/models/BrokerAuthorization", () => ({ BrokerAuthorization: s.authorization }));
vi.mock("@/models/User", () => ({ User: s.user }));
vi.mock("@/lib/brokers", () => s.brokers);
vi.mock("@/lib/maintenance/approver", () => ({ resolveCostApprover: s.approver }));

import {
  awaiting,
  BidError,
  decideBid,
  expireBids,
  isOpen,
  normaliseTerms,
  placeBid,
  respondToBid,
} from "@/lib/broker-bids";
import { dHashFromPixels, hammingDistance, isFingerprintableUrl } from "@/lib/listing-fingerprint";

const NOW = new Date("2026-11-26T08:00:00Z");
const LATER = new Date("2026-12-05T08:00:00Z");
const terms = {
  basis: "percentage_of_rent" as const,
  rateBps: 1000,
  fixedAmountMinor: 0,
  currency: "KES" as const,
};

function bid(overrides: Record<string, unknown> = {}) {
  return {
    _id: "bid-1",
    listingId: "l-1",
    unitId: "u-1",
    propertyId: "p-1",
    ownerId: "owner-1",
    brokerUserId: "broker-1",
    offers: [{ ...terms, by: "broker", byUserId: "broker-1", at: NOW }],
    status: "pending",
    approverUserId: "owner-1",
    expiresAt: LATER,
    ...overrides,
  };
}

beforeEach(() => {
  for (const group of [
    s.bid,
    s.profile,
    s.listing,
    s.publisher,
    s.property,
    s.agreement,
    s.authorization,
    s.user,
  ]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  for (const fn of Object.values(s.brokers)) fn.mockReset();
  s.approver.mockReset();
  s.bid.updateOne.mockResolvedValue({ modifiedCount: 1 });
  s.bid.updateMany.mockResolvedValue({ modifiedCount: 0 });
});

describe("terms and state", () => {
  it("keeps currency only on fixed amounts", () => {
    expect(normaliseTerms({ ...terms, currency: "USD" })).toMatchObject({
      currency: "KES",
      fixedAmountMinor: 0,
    });
    expect(
      normaliseTerms({ basis: "fixed", rateBps: 500, fixedAmountMinor: 10_000, currency: "USD" }),
    ).toMatchObject({
      currency: "USD",
      rateBps: 0,
    });
  });
  it("knows whose turn it is and when a request has lapsed", () => {
    expect(awaiting({ status: "pending" })).toBe("owner");
    expect(awaiting({ status: "countered" })).toBe("broker");
    expect(awaiting({ status: "accepted" })).toBeNull();
    expect(isOpen({ status: "pending", expiresAt: LATER }, NOW)).toBe(true);
    expect(isOpen({ status: "pending", expiresAt: NOW }, LATER)).toBe(false);
  });
});

describe("placeBid", () => {
  it("only verified brokers may request", async () => {
    s.profile.findOne.mockReturnValue(buildQuery({ status: "pending" }));
    await expect(placeBid("broker-1", "l-1", terms, NOW)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects listings that are not live on the marketplace", async () => {
    s.profile.findOne.mockReturnValue(buildQuery({ status: "verified" }));
    s.listing.findById.mockReturnValue(
      buildQuery({ _id: "l-1", state: "draft", propertyId: "p-1", unitId: "u-1" }),
    );
    await expect(placeBid("broker-1", "l-1", terms, NOW)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a second open request and an already-approved broker", async () => {
    s.profile.findOne.mockReturnValue(buildQuery({ status: "verified" }));
    s.listing.findById.mockReturnValue(
      buildQuery({ _id: "l-1", state: "active", propertyId: "p-1", unitId: "u-1" }),
    );
    s.property.findById.mockReturnValue(buildQuery({ ownerId: "owner-1" }));
    s.publisher.exists.mockResolvedValueOnce({ _id: "pub" });
    await expect(placeBid("broker-1", "l-1", terms, NOW)).rejects.toThrow(/already approved/);
    s.publisher.exists.mockResolvedValueOnce(null);
    s.bid.exists.mockResolvedValueOnce({ _id: "open" });
    await expect(placeBid("broker-1", "l-1", terms, NOW)).rejects.toThrow(/open request/);
  });

  it("creates a pending bid for the property's approver with a 14-day expiry", async () => {
    s.profile.findOne.mockReturnValue(buildQuery({ status: "verified" }));
    s.listing.findById.mockReturnValue(
      buildQuery({ _id: "l-1", state: "active", propertyId: "p-1", unitId: "u-1" }),
    );
    s.property.findById.mockReturnValue(buildQuery({ ownerId: "owner-1" }));
    s.publisher.exists.mockResolvedValue(null);
    s.bid.exists.mockResolvedValue(null);
    s.approver.mockResolvedValue({ userId: "owner-1", source: "property-owner" });
    s.bid.create.mockImplementation(async (doc: unknown) => doc);
    const created = (await placeBid("broker-1", "l-1", terms, NOW)) as Record<string, unknown>;
    expect(created).toMatchObject({ status: "pending", approverUserId: "owner-1", unitId: "u-1" });
    expect((created.expiresAt as Date).toISOString()).toBe("2026-12-10T08:00:00.000Z");
  });
});

describe("decideBid", () => {
  const owner = { userId: "owner-1", role: "admin" as const };

  it("only the approver (or system-admin) can decide", async () => {
    s.bid.findById.mockReturnValue(buildQuery(bid()));
    await expect(
      decideBid({ userId: "x", role: "admin" }, "bid-1", { action: "approve" }, NOW),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("approval creates authorisation, agreement and share link with the broker's terms", async () => {
    s.bid.findById.mockReturnValue(buildQuery(bid()));
    s.bid.findOneAndUpdate.mockReturnValue(buildQuery({ ...bid(), status: "accepted" }));
    s.brokers.authorizeBroker.mockResolvedValue({ _id: "auth-1" });
    s.agreement.findOne.mockReturnValue(buildQuery(null));
    s.brokers.createCommissionAgreement.mockResolvedValue({ _id: "agr-1" });
    s.agreement.updateOne.mockResolvedValue({});
    s.brokers.createBrokerListingPublisher.mockResolvedValue({ _id: "pub-1", shareCode: "brk_1" });
    await decideBid(owner, "bid-1", { action: "approve" }, NOW);
    expect(s.brokers.authorizeBroker).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ brokerId: "broker-1", scopeType: "unit", scopeId: "u-1" }),
    );
    expect(s.brokers.createCommissionAgreement).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ basis: "percentage_of_rent", rateBps: 1000, autoActivate: true }),
    );
    expect(s.bid.updateOne).toHaveBeenCalledWith(
      { _id: "bid-1" },
      {
        $set: {
          result: {
            authorizationId: "auth-1",
            agreementId: "agr-1",
            publisherId: "pub-1",
            shareCode: "brk_1",
          },
        },
      },
    );
  });

  it("a custodian approver grants the records on behalf of the property's owner", async () => {
    const custodian = { userId: "cust-1", role: "custodian" as const };
    s.bid.findById.mockReturnValue(buildQuery(bid({ approverUserId: "cust-1" })));
    s.bid.findOneAndUpdate.mockReturnValue(buildQuery({ ...bid(), status: "accepted" }));
    s.brokers.authorizeBroker.mockResolvedValue({ _id: "auth-1" });
    s.agreement.findOne.mockReturnValue(buildQuery(null));
    s.brokers.createCommissionAgreement.mockResolvedValue({ _id: "agr-1" });
    s.agreement.updateOne.mockResolvedValue({});
    s.brokers.createBrokerListingPublisher.mockResolvedValue({ _id: "pub-1", shareCode: "brk_1" });
    await decideBid(custodian, "bid-1", { action: "approve" }, NOW);
    expect(s.brokers.authorizeBroker).toHaveBeenCalledWith(
      { userId: "owner-1", role: "admin" },
      expect.objectContaining({ brokerId: "broker-1" }),
    );
    expect(s.bid.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "bid-1", status: "pending" },
      { $set: expect.objectContaining({ status: "accepted", decidedByUserId: "cust-1" }) },
      { new: true },
    );
  });

  it("re-opens the request when approval fails part-way", async () => {
    s.bid.findById.mockReturnValue(buildQuery(bid()));
    s.bid.findOneAndUpdate.mockReturnValue(buildQuery({ ...bid(), status: "accepted" }));
    s.brokers.authorizeBroker.mockRejectedValue(
      new Error("Unauthorized to grant broker authorization"),
    );
    await expect(decideBid(owner, "bid-1", { action: "approve" }, NOW)).rejects.toBeInstanceOf(
      BidError,
    );
    expect(s.bid.updateOne).toHaveBeenCalledWith(
      { _id: "bid-1" },
      { $set: { status: "pending", decidedByUserId: "", decidedAt: null } },
    );
  });

  it("rejecting needs a reason; countering hands the turn to the broker", async () => {
    s.bid.findById.mockReturnValue(buildQuery(bid()));
    await expect(decideBid(owner, "bid-1", { action: "reject" }, NOW)).rejects.toMatchObject({
      status: 400,
    });
    await decideBid(owner, "bid-1", { action: "counter", terms: { ...terms, rateBps: 800 } }, NOW);
    const [, update] = s.bid.updateOne.mock.calls.at(-1) as [
      unknown,
      Record<string, Record<string, unknown>>,
    ];
    expect(update.$set.status).toBe("countered");
    expect(update.$push.offers).toMatchObject({ by: "owner", rateBps: 800 });
  });

  it("cannot decide while waiting for the broker", async () => {
    s.bid.findById.mockReturnValue(buildQuery(bid({ status: "countered" })));
    await expect(decideBid(owner, "bid-1", { action: "approve" }, NOW)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("respondToBid", () => {
  it("accepting a counter finalises with the owner's terms and the owner as granter", async () => {
    const counter = { ...terms, rateBps: 800, by: "owner", byUserId: "owner-1", at: NOW };
    s.bid.findById.mockReturnValue(
      buildQuery(bid({ status: "countered", offers: [bid().offers[0], counter] })),
    );
    s.bid.findOneAndUpdate.mockReturnValue(buildQuery({ status: "accepted" }));
    s.user.findById.mockReturnValue(buildQuery({ role: "admin" }));
    s.brokers.authorizeBroker.mockResolvedValue({ _id: "auth-1" });
    s.agreement.findOne.mockReturnValue(buildQuery(null));
    s.brokers.createCommissionAgreement.mockResolvedValue({ _id: "agr-1" });
    s.agreement.updateOne.mockResolvedValue({});
    s.brokers.createBrokerListingPublisher.mockResolvedValue({ _id: "pub-1", shareCode: "brk_1" });
    await respondToBid("broker-1", "bid-1", "accept", NOW);
    expect(s.brokers.createCommissionAgreement).toHaveBeenCalledWith(
      { userId: "owner-1", role: "admin" },
      expect.objectContaining({ rateBps: 800 }),
    );
  });

  it("brokers cannot answer someone else's request or accept without a counter", async () => {
    s.bid.findById.mockReturnValue(buildQuery(bid()));
    await expect(respondToBid("other", "bid-1", "withdraw", NOW)).rejects.toMatchObject({
      status: 404,
    });
    await expect(respondToBid("broker-1", "bid-1", "accept", NOW)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("expires lapsed requests", async () => {
    s.bid.updateMany.mockResolvedValue({ modifiedCount: 3 });
    expect(await expireBids(NOW)).toEqual({ expired: 3 });
  });
});

describe("photo fingerprints", () => {
  it("only fetches images from our upload hosts", () => {
    expect(isFingerprintableUrl("https://abc.ufs.sh/f/x")).toBe(true);
    expect(isFingerprintableUrl("https://utfs.io/f/x")).toBe(true);
    expect(isFingerprintableUrl("http://abc.ufs.sh/f/x")).toBe(false);
    expect(isFingerprintableUrl("https://ufs.sh.evil.com/x")).toBe(false);
    expect(isFingerprintableUrl("http://169.254.169.254/latest")).toBe(false);
  });

  it("hashes gradients deterministically and measures distance", () => {
    const rising = new Uint8Array(72).map((_, i) => (i % 9) * 10);
    const falling = new Uint8Array(72).map((_, i) => 200 - (i % 9) * 10);
    expect(dHashFromPixels(rising)).toBe("0000000000000000");
    expect(dHashFromPixels(falling)).toBe("ffffffffffffffff");
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("00000000000000ff", "0000000000000000")).toBe(8);
    expect(hammingDistance("bad", "0000000000000000")).toBe(64);
  });
});
