import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { canManageCatalog } from "@/lib/maintenance/access";
import { catalogActor, catalogOwnerId, propertiesOwnedBy } from "@/lib/maintenance/catalog-helpers";
import { guardMutation } from "@/lib/maintenance/route-helpers";
import { vendorInput } from "@/lib/schemas/maintenance";
import { Vendor } from "@/models/Vendor";

function serialize(v: Record<string, unknown>) {
  return { ...v, _id: String(v._id) };
}

/**
 * Vendor list. Admins see their own; custodians/caretakers see their admin's
 * (to assign work). `?propertyId=` narrows to vendors serving that property;
 * `?active=1` hides inactive vendors.
 */
export async function GET(request: NextRequest) {
  const actor = await catalogActor(request);
  if (actor instanceof NextResponse) return actor;
  const ownerId = catalogOwnerId(actor);
  if (!ownerId) return NextResponse.json({ data: [] });

  const filter: Record<string, unknown> = { ownerId };
  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (propertyId) filter.propertyIds = propertyId;
  if (request.nextUrl.searchParams.get("active") === "1") filter.isActive = true;

  const rows = await Vendor.find(filter).sort({ isActive: -1, name: 1 }).limit(500).lean();
  return NextResponse.json({ data: rows.map((r) => serialize(r as Record<string, unknown>)) });
}

/** Adds a vendor to the calling admin's list. */
export async function POST(request: NextRequest) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const actor = await catalogActor(request);
  if (actor instanceof NextResponse) return actor;
  if (!canManageCatalog(actor) || actor.role !== "admin") {
    return NextResponse.json({ error: "Only the owner can manage service providers" }, { status: 403 });
  }

  const parsed = vendorInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the service provider details", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (!(await propertiesOwnedBy(actor.userId, parsed.data.propertyIds))) {
    return NextResponse.json({ error: "Pick only your own properties" }, { status: 400 });
  }
  const vendor = await Vendor.create({
    ...parsed.data,
    trades: [...new Set(parsed.data.trades)],
    propertyIds: [...new Set(parsed.data.propertyIds)],
    ownerId: actor.userId,
    createdBy: actor.userId,
  });
  return NextResponse.json({ data: serialize(vendor.toObject()) }, { status: 201 });
}
