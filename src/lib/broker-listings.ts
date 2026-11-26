import { z } from "zod";
import { isValidE164 } from "@/lib/phone";
import {
  BROKER_LISTING_LIFETIME_DAYS,
  type BrokerListingStatus,
  MIN_BROKER_LISTING_PHOTOS,
} from "@/models/BrokerListing";

const uploadUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((u) => /^https:\/\/([a-z0-9-]+\.)*(ufs\.sh|utfs\.io|uploadthing\.com)\//i.test(u), {
    message: "Files must be uploaded through the app",
  });

/** Draft fields; everything may be incomplete until submission. */
export const brokerListingInput = z.object({
  purpose: z.enum(["rent", "sale"]),
  title: z.string().trim().min(3, "Add a title").max(160),
  description: z.string().trim().max(5000).optional().default(""),
  propertyType: z.string().trim().max(60).optional().default(""),
  county: z.string().trim().min(2, "Choose the county").max(80),
  area: z.string().trim().min(2, "Enter the area / estate").max(120),
  price: z.coerce.number().finite().min(1, "Enter the price").max(10_000_000_000),
  serviceCharge: z.coerce.number().finite().min(0).max(100_000_000).optional().default(0),
  depositMonths: z.coerce.number().int().min(0).max(24).optional().default(0),
  bedrooms: z.coerce.number().int().min(0).max(100).optional().default(0),
  bathrooms: z.coerce.number().int().min(0).max(100).optional().default(0),
  sizeSqm: z.coerce.number().finite().min(0).max(1_000_000).optional().default(0),
  amenities: z.array(z.string().trim().min(1).max(60)).max(40).optional().default([]),
  photos: z
    .array(z.object({ url: uploadUrl, key: z.string().trim().max(200).optional().default("") }))
    .max(20)
    .optional()
    .default([]),
  exactLocation: z
    .object({
      address: z.string().trim().max(300).optional().default(""),
      latitude: z.coerce.number().min(-90).max(90).nullable().optional().default(null),
      longitude: z.coerce.number().min(-180).max(180).nullable().optional().default(null),
    })
    .optional()
    .default({ address: "", latitude: null, longitude: null }),
  mandateDocument: z
    .object({
      url: uploadUrl.or(z.literal("")),
      key: z.string().trim().max(200).optional().default(""),
      name: z.string().trim().max(200).optional().default(""),
    })
    .optional()
    .default({ url: "", key: "", name: "" }),
  ownerContact: z
    .object({
      name: z.string().trim().max(120).optional().default(""),
      phone: z.string().trim().max(32).optional().default(""),
    })
    .optional()
    .default({ name: "", phone: "" }),
});
export type BrokerListingInput = z.infer<typeof brokerListingInput>;

export interface BrokerListingDoc extends BrokerListingInput {
  _id: unknown;
  brokerUserId: string;
  status: BrokerListingStatus;
  submittedAt?: Date | null;
  reviewedByUserId?: string;
  reviewedAt?: Date | null;
  reviewNote?: string;
  approvedAt?: Date | null;
  expiresAt?: Date | null;
  renewals?: number;
  duplicateFlags?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** What still blocks submission (client decision: mandate, owner contact, exact location, 3+ photos). */
export function submissionProblems(
  doc: Pick<BrokerListingDoc, "photos" | "mandateDocument" | "ownerContact" | "exactLocation">,
): string[] {
  const problems: string[] = [];
  if ((doc.photos ?? []).length < MIN_BROKER_LISTING_PHOTOS) {
    problems.push(`Add at least ${MIN_BROKER_LISTING_PHOTOS} photos`);
  }
  if (!doc.mandateDocument?.url) problems.push("Upload the owner's mandate letter");
  if (!doc.ownerContact?.name) problems.push("Enter the owner's name");
  if (!doc.ownerContact?.phone || !isValidE164(doc.ownerContact.phone)) {
    problems.push("Enter the owner's phone with its country code");
  }
  if (!doc.exactLocation?.address) problems.push("Enter the exact address");
  return problems;
}

export function expiryFromNow(now = new Date()): Date {
  return new Date(now.getTime() + BROKER_LISTING_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
}

/** Live on the marketplace right now. */
export function isLive(
  doc: Pick<BrokerListingDoc, "status" | "expiresAt">,
  now = new Date(),
): boolean {
  return (
    doc.status === "approved" && Boolean(doc.expiresAt) && new Date(doc.expiresAt as Date) > now
  );
}

/** Public projection: no owner contact, exact address, mandate or review notes. */
export function toPublicBrokerListing(
  doc: BrokerListingDoc,
  broker: { name?: string; agency?: string } = {},
) {
  return {
    id: String(doc._id),
    source: "broker" as const,
    purpose: doc.purpose,
    title: doc.title,
    description: doc.description,
    propertyType: doc.propertyType,
    county: doc.county,
    area: doc.area,
    price: doc.price,
    serviceCharge: doc.serviceCharge,
    depositMonths: doc.depositMonths,
    bedrooms: doc.bedrooms,
    bathrooms: doc.bathrooms,
    sizeSqm: doc.sizeSqm,
    amenities: doc.amenities,
    photos: (doc.photos ?? []).map((p) => p.url),
    listedBy: broker.agency || broker.name || "Broker",
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt).toISOString() : null,
  };
}

/** Broker / system-admin projection: everything, ids as strings. */
export function toPrivateBrokerListing(doc: BrokerListingDoc, now = new Date()) {
  const expired = doc.status === "approved" && doc.expiresAt && new Date(doc.expiresAt) <= now;
  return {
    ...doc,
    _id: String(doc._id),
    status: expired ? ("expired" as const) : doc.status,
    photos: (doc.photos ?? []).map((p) => ({
      ...p,
      _id: String((p as { _id?: unknown })._id ?? ""),
    })),
    submissionProblems: submissionProblems(doc),
  };
}
