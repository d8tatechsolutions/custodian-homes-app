import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateSession } from "@/lib/auth-scope";
import type { Lean } from "@/lib/lean";
import { connectToDatabase } from "@/lib/mongoose";
import { parsePagination } from "@/lib/pagination";
import {
  BrokerAuthorization,
  type BrokerAuthorizationDocument,
} from "@/models/BrokerAuthorization";
import { BrokerProfile, type BrokerProfileDocument } from "@/models/BrokerProfile";
import { Listing, type ListingDocument } from "@/models/Listing";
import { ListingPublisher, type ListingPublisherDocument } from "@/models/ListingPublisher";
import { Property } from "@/models/Property";
import { Unit } from "@/models/Unit";

/** The few property and unit fields this list shows. */
interface PropertyRow {
  _id: unknown;
  title?: string;
  name?: string;
  location?: string;
  county?: string;
}
interface UnitRow {
  _id: unknown;
  unitNumber?: string;
  beds?: number;
  baths?: number;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();

  const profile = (await BrokerProfile.findOne({
    userId: auth.userId,
  }).lean()) as Lean<BrokerProfileDocument> | null;
  if (profile?.status !== "verified") {
    return NextResponse.json(
      { error: "Forbidden: Verified broker profile required" },
      { status: 403 },
    );
  }

  // Get all active authorizations for this broker
  const authorizations = (await BrokerAuthorization.find({
    brokerId: auth.userId,
    status: "active",
  }).lean()) as Lean<BrokerAuthorizationDocument>[];

  if (authorizations.length === 0) {
    return NextResponse.json({ listings: [], total: 0 });
  }

  // Gather propertyIds, blockIds, unitIds from authorizations
  const propertyIds = new Set<string>();
  const blockIds = new Set<string>();
  const unitIds = new Set<string>();

  for (const authItem of authorizations) {
    if (authItem.scopeType === "property") {
      propertyIds.add(authItem.propertyId);
    } else if (authItem.scopeType === "block") {
      blockIds.add(authItem.scopeId);
    } else if (authItem.scopeType === "unit") {
      unitIds.add(authItem.scopeId);
    }
  }

  const queryOr: Record<string, unknown>[] = [];
  if (propertyIds.size > 0) queryOr.push({ propertyId: { $in: [...propertyIds] } });
  if (blockIds.size > 0) queryOr.push({ blockId: { $in: [...blockIds] } });
  if (unitIds.size > 0) queryOr.push({ unitId: { $in: [...unitIds] } });

  const { page, limit } = parsePagination({
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  const skip = (page - 1) * limit;

  const listingFilter = {
    state: "active",
    deletedAt: null,
    $or: queryOr,
  };

  const [total, listings] = await Promise.all([
    Listing.countDocuments(listingFilter),
    Listing.find(listingFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean() as Promise<
      Lean<ListingDocument>[]
    >,
  ]);

  // Fetch publishers for this broker on these listings
  const listingIds = listings.map((l) => String(l._id));
  const publishers = (await ListingPublisher.find({
    listingId: { $in: listingIds },
    publisherUserId: auth.userId,
    publisherRole: "broker",
    state: "active",
  }).lean()) as Lean<ListingPublisherDocument>[];

  const publisherMap = new Map<string, Lean<ListingPublisherDocument>>();
  for (const p of publishers) {
    publisherMap.set(p.listingId, p);
  }

  // Fetch properties and units to provide readable context
  const pIds = [...new Set(listings.map((l) => l.propertyId))];
  const uIds = [...new Set(listings.map((l) => l.unitId))];

  const [properties, units] = await Promise.all([
    Property.find({ _id: { $in: pIds } })
      .select("title name location county")
      .lean() as Promise<PropertyRow[]>,
    Unit.find({ _id: { $in: uIds } })
      .select("unitNumber beds baths rent")
      .lean() as Promise<UnitRow[]>,
  ]);

  const propertyMap = new Map(properties.map((p) => [String(p._id), p]));
  const unitMap = new Map(units.map((u) => [String(u._id), u]));

  const enriched = listings.map((l) => {
    const pub = publisherMap.get(String(l._id));
    const prop = propertyMap.get(String(l.propertyId));
    const un = unitMap.get(String(l.unitId));

    return {
      id: String(l._id),
      headline: l.headline,
      askingRent: l.askingRent,
      serviceCharge: l.serviceCharge,
      property: {
        id: l.propertyId,
        title: prop?.title || prop?.name || "Property",
        location: prop?.location || prop?.county || "",
      },
      unit: {
        id: l.unitId,
        unitNumber: un?.unitNumber || "",
        beds: un?.beds ?? 0,
        baths: un?.baths ?? 0,
      },
      published: Boolean(pub),
      shareCode: pub?.shareCode || null,
      shareUrl: pub?.shareCode ? `/marketplace/${l._id}?ref=${pub.shareCode}` : null,
    };
  });

  return NextResponse.json({
    listings: enriched,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
}
