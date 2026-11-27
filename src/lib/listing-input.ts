import { isValidObjectId } from "mongoose";

import { LISTING_VISIBILITIES } from "@/lib/domain-enums";

/**
 * Type checks for the editable listing fields, matching the Listing model's own
 * rules plus the create route's "rent above 0". Used by create and update so a
 * wrong type is a clear 400 instead of a crash, and an update can't store a value
 * the model would refuse on create (updates skip model validation).
 *
 * Returns an error message, or null when every field that is present is valid.
 */
export function listingFieldsError(fields: Record<string, unknown>): string | null {
  const has = (key: string) => fields[key] !== undefined;
  const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);

  if (has("headline") && (typeof fields.headline !== "string" || !fields.headline.trim())) {
    return "headline must be non-empty text";
  }
  if (has("description") && fields.description !== null && typeof fields.description !== "string") {
    return "description must be text";
  }
  if (has("askingRent") && (!isNumber(fields.askingRent) || (fields.askingRent as number) <= 0)) {
    return "askingRent must be a number greater than 0";
  }
  if (
    has("serviceCharge") &&
    fields.serviceCharge !== null &&
    (!isNumber(fields.serviceCharge) || (fields.serviceCharge as number) < 0)
  ) {
    return "serviceCharge must be a number of 0 or more";
  }
  if (
    has("depositMonths") &&
    fields.depositMonths !== null &&
    (!isNumber(fields.depositMonths) || (fields.depositMonths as number) < 0)
  ) {
    return "depositMonths must be a number of 0 or more";
  }
  if (
    has("minimumStayMonths") &&
    fields.minimumStayMonths !== null &&
    (!isNumber(fields.minimumStayMonths) || (fields.minimumStayMonths as number) < 1)
  ) {
    return "minimumStayMonths must be a number of 1 or more";
  }
  if (has("availableFrom") && fields.availableFrom !== null && fields.availableFrom !== "") {
    const value = fields.availableFrom;
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      Number.isNaN(new Date(value).getTime())
    ) {
      return "availableFrom must be a valid date";
    }
  }
  if (
    has("amenities") &&
    fields.amenities !== null &&
    (!Array.isArray(fields.amenities) || !fields.amenities.every((a) => typeof a === "string"))
  ) {
    return "amenities must be a list of text";
  }
  if (
    has("visibility") &&
    fields.visibility !== null &&
    fields.visibility !== "" &&
    !(LISTING_VISIBILITIES as readonly unknown[]).includes(fields.visibility)
  ) {
    return `visibility must be one of: ${LISTING_VISIBILITIES.join(", ")}`;
  }
  return null;
}

/** Property, block and unit references on create: ids as text, never query objects. */
export function listingRefsError(fields: Record<string, unknown>): string | null {
  for (const key of ["propertyId", "unitId"] as const) {
    const value = fields[key];
    if (value !== undefined && (typeof value !== "string" || !isValidObjectId(value))) {
      return `${key} must be a valid id`;
    }
  }
  // Block ids are only required to be text: older units may hold other formats.
  const blockId = fields.blockId;
  if (blockId !== undefined && blockId !== null && typeof blockId !== "string") {
    return "blockId must be text";
  }
  return null;
}
