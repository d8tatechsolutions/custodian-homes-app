import { randomBytes } from "node:crypto";
import { writeAuditEvent } from "@/lib/audit";
import type { AttributionSource } from "@/lib/domain-enums";
import type { Lean } from "@/lib/lean";
import { connectToDatabase } from "@/lib/mongoose";
import type { Role } from "@/lib/permissions";
import { Application, type ApplicationDocument } from "@/models/Application";
import { Attribution, type AttributionDocument } from "@/models/Attribution";
import {
  BrokerAuthorization,
  type BrokerAuthorizationDocument,
} from "@/models/BrokerAuthorization";
import { BrokerProfile, type BrokerProfileDocument } from "@/models/BrokerProfile";
import {
  CommissionAgreement,
  type CommissionAgreementDocument,
} from "@/models/CommissionAgreement";
import { type ILease, Lease } from "@/models/Lease";
import { Listing, type ListingDocument } from "@/models/Listing";
import { ListingPublisher, type ListingPublisherDocument } from "@/models/ListingPublisher";
import { toRedactedProspectView } from "./brokers";

/** A share-code touch only attributes a tenancy for 30 days. */
export const ATTRIBUTION_TOUCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Provisional touch records are discarded after 90 days. */
export const ATTRIBUTION_PROVISIONAL_LIFESPAN_MS = 90 * 24 * 60 * 60 * 1000;

interface TouchResultBase {
  reason?: string;
  brokerUserId?: string;
  commissionAgreementId?: string;
  source: AttributionSource;
}

/** A valid touch always carries its publisher and listing. */
export type ValidateTouchResult =
  | (TouchResultBase & {
      valid: true;
      publisher: Lean<ListingPublisherDocument>;
      listing: Lean<ListingDocument>;
    })
  | (TouchResultBase & {
      valid: false;
      publisher?: Lean<ListingPublisherDocument>;
      listing?: Lean<ListingDocument>;
    });

export type ProvisionalTouchResult = ValidateTouchResult & {
  touchToken?: string;
  touchedAt?: Date;
  expiresAt?: Date;
};

export async function validateShareCode(
  shareCode: string,
  unitId: string,
): Promise<ValidateTouchResult> {
  await connectToDatabase();

  if (!shareCode?.trim()) {
    return { valid: false, reason: "Missing shareCode", source: "direct" };
  }

  const publisher = (await ListingPublisher.findOne({
    shareCode: shareCode.trim(),
    state: "active",
  }).lean()) as Lean<ListingPublisherDocument> | null;

  if (!publisher) {
    return { valid: false, reason: "Share code is invalid or inactive", source: "direct" };
  }

  const listing = (await Listing.findById(
    publisher.listingId,
  ).lean()) as Lean<ListingDocument> | null;
  if (listing?.state !== "active" || listing.deletedAt) {
    return { valid: false, reason: "Listing is no longer active", source: "direct" };
  }

  if (listing.unitId !== unitId) {
    return { valid: false, reason: "Share code belongs to a different unit", source: "direct" };
  }

  if (publisher.publisherRole === "broker") {
    const brokerProfile = (await BrokerProfile.findOne({
      userId: publisher.publisherUserId,
    }).lean()) as Lean<BrokerProfileDocument> | null;

    if (brokerProfile?.status !== "verified") {
      return { valid: false, reason: "Broker profile is not verified", source: "direct" };
    }

    // Verify active authorization
    const authorization = (await BrokerAuthorization.findOne({
      brokerId: publisher.publisherUserId,
      status: "active",
      $or: [
        { scopeType: "unit", scopeId: unitId },
        ...(listing.blockId ? [{ scopeType: "block", scopeId: listing.blockId }] : []),
        { scopeType: "property", scopeId: listing.propertyId },
      ],
    }).lean()) as Lean<BrokerAuthorizationDocument> | null;

    if (!authorization) {
      return {
        valid: false,
        reason: "Broker authorization is no longer active",
        source: "direct",
      };
    }

    // Find active agreement
    const agreement = (await CommissionAgreement.findOne({
      brokerId: publisher.publisherUserId,
      status: "active",
      $or: [
        { scopeType: "unit", scopeId: unitId },
        ...(listing.blockId ? [{ scopeType: "block", scopeId: listing.blockId }] : []),
        { scopeType: "property", scopeId: listing.propertyId },
      ],
    }).lean()) as Lean<CommissionAgreementDocument> | null;

    return {
      valid: true,
      publisher,
      listing,
      brokerUserId: publisher.publisherUserId,
      commissionAgreementId: agreement ? String(agreement._id) : undefined,
      source: "broker",
    };
  }

  return {
    valid: true,
    publisher,
    listing,
    source: publisher.publisherRole === "admin" ? "admin" : "platform",
  };
}

/**
 * Validates a public share code and persists a short-lived provisional touch.
 * The returned token lets the application submission prove when the tenant
 * last touched the link, which is what the 30-day attribution window checks.
 */
export async function recordProvisionalTouch(
  shareCode: string,
  unitId: string,
): Promise<ProvisionalTouchResult> {
  const result = await validateShareCode(shareCode, unitId);
  if (!result.valid || !result.publisher || !result.listing) {
    return result;
  }

  const touchedAt = new Date();
  const expiresAt = new Date(touchedAt.getTime() + ATTRIBUTION_PROVISIONAL_LIFESPAN_MS);
  const touchToken = `att_${randomBytes(16).toString("hex")}`;

  await Attribution.create({
    unitId,
    propertyId: String(result.listing.propertyId),
    listingId: String(result.listing._id),
    publisherId: String(result.publisher._id),
    publisherUserId: result.publisher.publisherUserId,
    brokerUserId: result.brokerUserId || "",
    commissionAgreementId: result.commissionAgreementId || "",
    shareCode: shareCode.trim(),
    touchToken,
    touchExpiresAt: expiresAt,
    source: result.source,
    status: "provisional",
    touchTimestamp: touchedAt,
  });

  return { ...result, touchToken, touchedAt, expiresAt };
}

export interface BindApplicationAttributionInput {
  applicationId: string;
  shareCode?: string;
  touchToken?: string;
  unitId: string;
  propertyId: string;
  listingId?: string;
  actorUserId?: string;
}

async function writeAttributionLocked(
  attribution: Lean<AttributionDocument>,
  input: BindApplicationAttributionInput,
) {
  await writeAuditEvent({
    actor: {
      userId: input.actorUserId || "system",
      role: attribution.source === "broker" ? "broker" : "applicant",
    },
    action: "attribution.locked",
    entityType: "attribution",
    entityId: String(attribution._id),
    scope: {
      propertyId: input.propertyId,
      unitId: input.unitId,
    },
    after: attribution,
  });
}

export async function bindApplicationAttribution(input: BindApplicationAttributionInput) {
  await connectToDatabase();

  // Attribution is per unit/listing; property-level applications have none.
  if (!input.unitId) {
    return null;
  }

  // If attribution already locked for this application, return it
  const existing = (await Attribution.findOne({
    applicationId: input.applicationId,
    status: { $in: ["provisional", "locked", "confirmed"] },
  }).lean()) as Lean<AttributionDocument> | null;

  if (existing) {
    return existing;
  }

  // Prefer the persisted touch token: it proves when the tenant last touched
  // the shared link, so stale touches fall back to an unattributed application.
  if (input.touchToken) {
    const touch = (await Attribution.findOne({
      touchToken: input.touchToken,
      status: "provisional",
    }).lean()) as Lean<AttributionDocument> | null;

    if (touch) {
      const now = Date.now();
      const touchedAt = new Date(touch.touchTimestamp ?? touch.createdAt ?? now).getTime();
      const expiresAt = touch.touchExpiresAt
        ? new Date(touch.touchExpiresAt).getTime()
        : touchedAt + ATTRIBUTION_PROVISIONAL_LIFESPAN_MS;
      const withinTouchWindow = now - touchedAt <= ATTRIBUTION_TOUCH_WINDOW_MS;
      const withinLifespan = now <= expiresAt;
      const matchesUnit = String(touch.unitId) === input.unitId;

      const validation: ValidateTouchResult =
        withinTouchWindow && withinLifespan && matchesUnit && touch.shareCode
          ? await validateShareCode(touch.shareCode, input.unitId)
          : { valid: false, source: "direct" as AttributionSource };

      if (validation.valid && validation.publisher && validation.listing) {
        const lockedAt = new Date();
        await Attribution.updateOne(
          { _id: touch._id, status: "provisional" },
          {
            $set: {
              applicationId: input.applicationId,
              propertyId: input.propertyId,
              listingId: String(validation.listing._id),
              publisherId: String(validation.publisher._id),
              publisherUserId: validation.publisher.publisherUserId,
              brokerUserId: validation.brokerUserId || "",
              commissionAgreementId: validation.commissionAgreementId || "",
              source: validation.source,
              status: "locked",
              lockedAt,
              touchExpiresAt: null,
            },
          },
        );

        const locked = (await Attribution.findById(touch._id).lean()) as Lean<AttributionDocument>;
        await writeAttributionLocked(locked, input);
        return locked;
      }

      // Expired/invalid touch: retire it so it can never be attributed later.
      await Attribution.updateOne(
        { _id: touch._id, status: "provisional" },
        {
          $set: {
            status: "reversed",
            reversedAt: new Date(),
            reversalReason: !withinTouchWindow
              ? "Touch fell outside the 30-day attribution window"
              : !withinLifespan
                ? "Provisional attribution lifespan expired"
                : "Share code or broker authorization no longer valid",
            touchExpiresAt: null,
          },
        },
      );
    }
  }

  let source: AttributionSource = "direct";
  let publisherId = "";
  let publisherUserId = "";
  let brokerUserId = "";
  let commissionAgreementId = "";
  let listingId = input.listingId || "";

  if (input.shareCode) {
    const touch = await validateShareCode(input.shareCode, input.unitId);
    if (touch.valid) {
      source = touch.source;
      publisherId = String(touch.publisher._id);
      publisherUserId = touch.publisher.publisherUserId;
      brokerUserId = touch.brokerUserId || "";
      commissionAgreementId = touch.commissionAgreementId || "";
      listingId = String(touch.listing._id);
    }
  }

  const created = await Attribution.create({
    applicationId: input.applicationId,
    unitId: input.unitId,
    propertyId: input.propertyId,
    listingId,
    publisherId,
    publisherUserId,
    brokerUserId,
    commissionAgreementId,
    shareCode: input.shareCode || "",
    source,
    status: "locked",
    touchTimestamp: new Date(),
    lockedAt: new Date(),
  });

  const createdDoc = (await Attribution.findById(created._id).lean()) as Lean<AttributionDocument>;
  await writeAttributionLocked(createdDoc, input);

  return createdDoc;
}

export async function confirmAttributionForLease(
  unitId: string,
  leaseId: string,
  applicationId?: string,
  actorUserId = "system",
) {
  await connectToDatabase();

  // Look for locked attribution by applicationId or unitId
  const query: Record<string, unknown> = { status: "locked" };
  if (applicationId) {
    query.applicationId = applicationId;
  } else {
    query.unitId = unitId;
  }

  const attribution = (await Attribution.findOne(query)
    .sort({ lockedAt: -1 })
    .lean()) as Lean<AttributionDocument> | null;

  if (attribution) {
    await Attribution.updateOne(
      { _id: attribution._id },
      {
        $set: {
          status: "confirmed",
          confirmedAt: new Date(),
          leaseId,
        },
      },
    );

    const updated = (await Attribution.findById(
      attribution._id,
    ).lean()) as Lean<AttributionDocument>;

    await writeAuditEvent({
      actor: { userId: actorUserId, role: "system" },
      action: "attribution.confirmed",
      entityType: "attribution",
      entityId: String(attribution._id),
      scope: {
        propertyId: attribution.propertyId,
        unitId: attribution.unitId,
      },
      before: { status: "locked" },
      after: { status: "confirmed", leaseId, confirmedAt: updated.confirmedAt },
    });

    return updated;
  }

  // A lease may only ever have one confirmed attribution.
  const alreadyConfirmed = (await Attribution.findOne({
    leaseId,
    status: "confirmed",
  }).lean()) as Lean<AttributionDocument> | null;
  if (alreadyConfirmed) {
    return alreadyConfirmed;
  }

  // If no locked attribution existed, create a direct confirmed attribution
  const lease = (await Lease.findById(leaseId).lean()) as Lean<ILease> | null;
  const propertyId = lease?.propertyId || "";

  const created = await Attribution.create({
    applicationId: applicationId || "",
    leaseId,
    unitId,
    propertyId,
    source: "direct",
    status: "confirmed",
    confirmedAt: new Date(),
    touchTimestamp: new Date(),
    lockedAt: new Date(),
  });

  const createdDoc = (await Attribution.findById(created._id).lean()) as Lean<AttributionDocument>;

  await writeAuditEvent({
    actor: { userId: actorUserId, role: "system" },
    action: "attribution.confirmed_direct",
    entityType: "attribution",
    entityId: String(createdDoc._id),
    scope: { propertyId, unitId },
    after: createdDoc,
  });

  return createdDoc;
}

export interface ResolveDisputeInput {
  newBrokerUserId?: string;
  newAgreementId?: string;
  newSource?: AttributionSource;
  reason: string;
}

export async function resolveAttributionDispute(
  systemAdminActor: { userId: string; role: Role },
  attributionId: string,
  input: ResolveDisputeInput,
) {
  await connectToDatabase();

  if (systemAdminActor.role !== "system-admin") {
    throw new Error("Only system administrators can resolve attribution disputes");
  }

  const original = (await Attribution.findById(
    attributionId,
  ).lean()) as Lean<AttributionDocument> | null;
  if (!original) {
    throw new Error("Attribution record not found");
  }

  // Create superseding record first
  const superseding = await Attribution.create({
    applicationId: original.applicationId,
    leaseId: original.leaseId,
    unitId: original.unitId,
    propertyId: original.propertyId,
    listingId: original.listingId,
    publisherUserId: input.newBrokerUserId || original.publisherUserId,
    brokerUserId: input.newBrokerUserId || original.brokerUserId,
    commissionAgreementId: input.newAgreementId || original.commissionAgreementId,
    source: input.newSource || (input.newBrokerUserId ? "broker" : original.source),
    status: "confirmed",
    touchTimestamp: original.touchTimestamp,
    lockedAt: original.lockedAt,
    confirmedAt: new Date(),
    metadata: {
      supersedesAttributionId: String(original._id),
      disputeReason: input.reason,
    },
  });

  const supersedingDoc = (await Attribution.findById(
    superseding._id,
  ).lean()) as Lean<AttributionDocument>;

  // Update original record as disputed and mark superseding reference
  await Attribution.updateOne(
    { _id: attributionId },
    {
      $set: {
        status: "disputed",
        disputeReason: input.reason,
        disputedByUserId: systemAdminActor.userId,
        disputeResolvedAt: new Date(),
        supersededByAttributionId: String(supersedingDoc._id),
      },
    },
  );

  const updatedOriginal = (await Attribution.findById(
    attributionId,
  ).lean()) as Lean<AttributionDocument>;

  await writeAuditEvent({
    actor: { userId: systemAdminActor.userId, role: systemAdminActor.role },
    action: "attribution.dispute_resolved",
    entityType: "attribution",
    entityId: attributionId,
    scope: {
      propertyId: original.propertyId,
      unitId: original.unitId,
    },
    before: { status: original.status, brokerUserId: original.brokerUserId },
    after: {
      status: "disputed",
      supersededByAttributionId: String(supersedingDoc._id),
      newBrokerUserId: input.newBrokerUserId,
      reason: input.reason,
    },
  });

  return {
    original: updatedOriginal,
    superseding: supersedingDoc,
  };
}

export async function getBrokerProspects(
  brokerUserId: string,
  pagination: { page: number; limit: number },
) {
  await connectToDatabase();

  const skip = (pagination.page - 1) * pagination.limit;
  const filter = {
    brokerUserId,
    applicationId: { $gt: "" },
  };

  const [total, attributions] = await Promise.all([
    Attribution.countDocuments(filter),
    Attribution.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean() as Promise<Lean<AttributionDocument>[]>,
  ]);

  const appIds = attributions.map((a) => a.applicationId);
  const applications = (await Application.find({
    _id: { $in: appIds },
  }).lean()) as Lean<ApplicationDocument>[];

  const appMap = new Map(applications.map((app) => [String(app._id), app]));

  const prospects = attributions.map((attr) => {
    const app = appMap.get(String(attr.applicationId));
    return toRedactedProspectView({
      _id: attr.applicationId,
      status: app?.status || attr.status,
      appliedAt: attr.lockedAt || attr.createdAt,
      unitHeadline: `Unit ${attr.unitId.slice(-4)}`,
    });
  });

  return {
    prospects,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit) || 1,
    },
  };
}
