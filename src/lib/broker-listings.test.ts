/** @vitest-environment node */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken, withParams } from "@/test/utils/api-request";
import { buildQuery } from "@/test/utils/model-mocks";

const s = vi.hoisted(() => {
  const model = () => ({
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    updateOne: vi.fn(),
    create: vi.fn(),
    countDocuments: vi.fn(),
  });
  return { listing: model(), enquiry: model(), profile: model(), user: model(), flag: model() };
});
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/BrokerListing", async (orig) => ({
  ...(await orig<typeof import("@/models/BrokerListing")>()),
  BrokerListing: s.listing,
}));
vi.mock("@/models/BrokerEnquiry", () => ({ BrokerEnquiry: s.enquiry }));
vi.mock("@/models/BrokerProfile", () => ({ BrokerProfile: s.profile }));
vi.mock("@/models/User", () => ({ User: s.user }));
vi.mock("@/models/ListingFlag", () => ({ ListingFlag: s.flag }));
vi.mock("@/lib/listing-fingerprint", () => ({ checkListingPhotos: vi.fn().mockResolvedValue(0) }));

import { PATCH } from "@/app/api/v1/broker-listings/[id]/route";
import { POST as SUBMIT } from "@/app/api/v1/broker-listings/[id]/submit/route";
import { POST as ENQUIRE } from "@/app/api/v1/marketplace/broker-listings/[id]/enquiry/route";
import { isLive, submissionProblems, toPublicBrokerListing } from "@/lib/broker-listings";

const ID = "64b7f0c2a1b2c3d4e5f60718";
const ORIGINAL = process.env.BROKER_BIDS_ENABLED;
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.BROKER_BIDS_ENABLED;
  else process.env.BROKER_BIDS_ENABLED = ORIGINAL;
});

function doc(overrides: Record<string, unknown> = {}) {
  return {
    _id: ID,
    brokerUserId: "broker-1",
    purpose: "rent",
    title: "2-bed in Kilimani",
    description: "Bright flat",
    propertyType: "Apartment",
    county: "Nairobi",
    area: "Kilimani",
    price: 85000,
    serviceCharge: 5000,
    depositMonths: 2,
    bedrooms: 2,
    bathrooms: 2,
    sizeSqm: 90,
    amenities: ["Parking"],
    photos: [
      { url: "https://a.ufs.sh/f/1" },
      { url: "https://a.ufs.sh/f/2" },
      { url: "https://a.ufs.sh/f/3" },
    ],
    exactLocation: { address: "Plot 12, Argwings Kodhek Rd", latitude: -1.29, longitude: 36.78 },
    mandateDocument: { url: "https://a.ufs.sh/f/m.pdf", key: "m", name: "mandate.pdf" },
    ownerContact: { name: "Jane Owner", phone: "+254712345678" },
    status: "draft",
    ...overrides,
  };
}

beforeEach(() => {
  for (const group of Object.values(s)) for (const fn of Object.values(group)) fn.mockReset();
  process.env.BROKER_BIDS_ENABLED = "true";
  s.user.findById.mockReturnValue(buildQuery({ role: "broker", isActive: true }));
  s.profile.findOne.mockReturnValue(buildQuery({ status: "verified" }));
  s.listing.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
});

describe("rules", () => {
  it("requires mandate, owner contact, exact address and 3+ photos to submit", () => {
    expect(submissionProblems(doc() as never)).toEqual([]);
    const problems = submissionProblems(
      (doc as (o: Record<string, unknown>) => never)({
        photos: [],
        mandateDocument: { url: "" },
        ownerContact: { name: "", phone: "07" },
        exactLocation: { address: "" },
      }),
    );
    expect(problems).toEqual([
      "Add at least 3 photos",
      "Upload the owner's mandate letter",
      "Enter the owner's name",
      "Enter the owner's phone with its country code",
      "Enter the exact address",
    ]);
  });

  it("never exposes private evidence publicly", () => {
    const view = toPublicBrokerListing(doc() as never, { agency: "Prime Homes" });
    const text = JSON.stringify(view);
    expect(text).not.toContain("Jane Owner");
    expect(text).not.toContain("+254712345678");
    expect(text).not.toContain("Argwings");
    expect(text).not.toContain("mandate");
    expect(view).toMatchObject({
      area: "Kilimani",
      listedBy: "Prime Homes",
      photos: ["https://a.ufs.sh/f/1", "https://a.ufs.sh/f/2", "https://a.ufs.sh/f/3"],
    });
  });

  it("is live only while approved and unexpired", () => {
    const now = new Date("2026-11-26T00:00:00Z");
    expect(isLive({ status: "approved", expiresAt: new Date("2026-12-01") }, now)).toBe(true);
    expect(isLive({ status: "approved", expiresAt: new Date("2026-11-01") }, now)).toBe(false);
    expect(isLive({ status: "submitted", expiresAt: null }, now)).toBe(false);
  });
});

describe("routes", () => {
  it("editing an approved listing takes it offline until re-approved", async () => {
    s.listing.findById
      .mockReturnValueOnce(
        buildQuery(doc({ status: "approved", expiresAt: new Date("2027-01-01") })),
      )
      .mockReturnValue(buildQuery(doc({ status: "draft" })));
    const res = await PATCH(
      buildRequest(`/api/v1/broker-listings/${ID}`, {
        method: "PATCH",
        token: signToken("broker-1"),
        body: doc(),
      }),
      withParams(ID),
    );
    expect(res.status).toBe(200);
    const [, update] = s.listing.updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({ status: "draft", expiresAt: null, approvedAt: null });
    expect((await res.json()).notice).toMatch(/again for approval/);
  });

  it("refuses to submit without the required evidence", async () => {
    s.listing.findById.mockReturnValue(buildQuery(doc({ photos: [] })));
    const res = await SUBMIT(
      buildRequest(`/api/v1/broker-listings/${ID}/submit`, {
        method: "POST",
        token: signToken("broker-1"),
      }),
      withParams(ID),
    );
    expect(res.status).toBe(400);
    expect(s.listing.updateOne).not.toHaveBeenCalled();
  });

  it("other brokers cannot touch someone else's listing", async () => {
    s.listing.findById.mockReturnValue(buildQuery(doc({ brokerUserId: "someone-else" })));
    const res = await SUBMIT(
      buildRequest(`/api/v1/broker-listings/${ID}/submit`, {
        method: "POST",
        token: signToken("broker-1"),
      }),
      withParams(ID),
    );
    expect(res.status).toBe(404);
  });

  it("silently drops bot enquiries (honeypot) and stores real ones", async () => {
    const body = { name: "Visitor", phone: "+254700000001", website: "http://spam" };
    const bot = await ENQUIRE(
      buildRequest(`/api/v1/marketplace/broker-listings/${ID}/enquiry`, { method: "POST", body }),
      withParams(ID),
    );
    expect(bot.status).toBe(201);
    expect(s.enquiry.create).not.toHaveBeenCalled();

    s.listing.findById.mockReturnValue(
      buildQuery({
        status: "approved",
        expiresAt: new Date(Date.now() + 86_400_000),
        brokerUserId: "broker-1",
      }),
    );
    const real = await ENQUIRE(
      buildRequest(`/api/v1/marketplace/broker-listings/${ID}/enquiry`, {
        method: "POST",
        body: { ...body, website: "" },
      }),
      withParams(ID),
    );
    expect(real.status).toBe(201);
    expect(s.enquiry.create).toHaveBeenCalledWith(
      expect.objectContaining({ brokerUserId: "broker-1", name: "Visitor" }),
    );
  });
});
