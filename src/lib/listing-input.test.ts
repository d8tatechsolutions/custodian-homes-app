import { describe, expect, it } from "vitest";

import { listingFieldsError, listingRefsError } from "@/lib/listing-input";

const ID = "64b7f0c2a1b2c3d4e5f60718";

describe("listingFieldsError", () => {
  it("accepts the fields the units page and listing editor send", () => {
    expect(
      listingFieldsError({
        headline: "Two-bed with balcony",
        description: "",
        askingRent: 25000,
        serviceCharge: 0,
        depositMonths: 1,
        minimumStayMonths: 12,
        availableFrom: "2026-12-01",
        amenities: ["Parking"],
        visibility: "unlisted",
      }),
    ).toBeNull();
    expect(listingFieldsError({})).toBeNull();
  });

  it("refuses values the model or the create rules would refuse", () => {
    expect(listingFieldsError({ headline: "   " })).toMatch(/headline/);
    expect(listingFieldsError({ headline: 42 })).toMatch(/headline/);
    expect(listingFieldsError({ askingRent: 0 })).toMatch(/askingRent/);
    expect(listingFieldsError({ askingRent: -5 })).toMatch(/askingRent/);
    expect(listingFieldsError({ askingRent: "25000" })).toMatch(/askingRent/);
    expect(listingFieldsError({ serviceCharge: -1 })).toMatch(/serviceCharge/);
    expect(listingFieldsError({ minimumStayMonths: 0 })).toMatch(/minimumStayMonths/);
    expect(listingFieldsError({ availableFrom: "not a date" })).toMatch(/availableFrom/);
    expect(listingFieldsError({ amenities: [{ $gt: "" }] })).toMatch(/amenities/);
    expect(listingFieldsError({ visibility: "secret" })).toMatch(/visibility/);
  });
});

describe("listingRefsError", () => {
  it("accepts ids as text", () => {
    expect(listingRefsError({ propertyId: ID, unitId: ID, blockId: "" })).toBeNull();
    expect(listingRefsError({ propertyId: ID, unitId: ID, blockId: "legacy-block" })).toBeNull();
  });

  it("refuses query objects and malformed ids", () => {
    expect(listingRefsError({ propertyId: { $ne: null }, unitId: ID })).toMatch(/propertyId/);
    expect(listingRefsError({ propertyId: ID, unitId: "nope" })).toMatch(/unitId/);
    expect(listingRefsError({ propertyId: ID, unitId: ID, blockId: { $ne: "" } })).toMatch(
      /blockId/,
    );
  });
});
