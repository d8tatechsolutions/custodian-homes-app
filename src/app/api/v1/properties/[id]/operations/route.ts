import { isValidObjectId, Types } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { DashboardActor } from "@/app/api/v1/_helpers";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { catalogActor } from "@/lib/maintenance/catalog-helpers";
import { guardMutation } from "@/lib/maintenance/route-helpers";
import { operationsInput } from "@/lib/schemas/maintenance";
import { Property } from "@/models/Property";
import { PropertyOperations } from "@/models/PropertyOperations";

function canView(actor: DashboardActor, propertyId: string, ownerId: string): boolean {
  if (actor.role === "system-admin") return true;
  if (actor.role === "admin")
    return ownerId === actor.userId || actor.propertyScopeIds.includes(propertyId);
  if (actor.role === "custodian") return ownerId === actor.managedByOwnerId;
  if (actor.role === "caretaker") return actor.assignedPropertyIds.includes(propertyId);
  return false;
}

async function loadProperty(request: NextRequest, id: string) {
  const actor = await catalogActor(request);
  if (actor instanceof NextResponse) return actor;
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid property id" }, { status: 400 });
  const property = (await Property.findOne({ _id: id, deletedAt: null })
    .select("ownerId")
    .lean()) as {
    ownerId?: string;
  } | null;
  const ownerId = String(property?.ownerId ?? "");
  if (!property || !canView(actor, id, ownerId)) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }
  return { actor, ownerId };
}

function serialize(
  doc: {
    approvalThreshold?: number | null;
    commonAreas?: { _id: unknown; name: string; isActive?: boolean }[];
  } | null,
) {
  return {
    approvalThreshold: doc?.approvalThreshold ?? null,
    commonAreas: (doc?.commonAreas ?? []).map((a) => ({
      _id: String(a._id),
      name: a.name,
      isActive: a.isActive !== false,
    })),
  };
}

/** Maintenance settings for a property: approval threshold and common areas. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadProperty(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const doc = await PropertyOperations.findOne({ propertyId: id }).lean();
  return NextResponse.json({ data: serialize(doc as Parameters<typeof serialize>[0]) });
}

/**
 * Updates the settings (owner admin only). Common areas keep their ids so
 * tasks that point at them stay valid; removing an area hides it (inactive)
 * rather than deleting it.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;
  const loaded = await loadProperty(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const { actor, ownerId } = loaded;
  if (!(actor.role === "admin" && ownerId === actor.userId)) {
    return NextResponse.json(
      { error: "Only the property's owner can change these settings" },
      { status: 403 },
    );
  }

  const parsed = operationsInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const set: Record<string, unknown> = { updatedBy: actor.userId, ownerId };
  if (parsed.data.approvalThreshold !== undefined)
    set.approvalThreshold = parsed.data.approvalThreshold;
  if (parsed.data.commonAreas) {
    const existing = (await PropertyOperations.findOne({ propertyId: id })
      .select("commonAreas")
      .lean()) as {
      commonAreas?: { _id: unknown; name: string }[];
    } | null;
    const known = new Set((existing?.commonAreas ?? []).map((a) => String(a._id)));
    const incoming = parsed.data.commonAreas;
    const names = incoming.filter((a) => a.isActive !== false).map((a) => a.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      return NextResponse.json({ error: "Two common areas have the same name" }, { status: 400 });
    }
    const keptIds = new Set(incoming.map((a) => a._id).filter(Boolean));
    const next = incoming.map((a) => ({
      _id: a._id && known.has(a._id) ? new Types.ObjectId(a._id) : new Types.ObjectId(),
      name: a.name,
      isActive: a.isActive !== false,
    }));
    // Areas missing from the request are kept but hidden, never deleted.
    for (const old of existing?.commonAreas ?? []) {
      if (!keptIds.has(String(old._id))) {
        next.push({ _id: new Types.ObjectId(String(old._id)), name: old.name, isActive: false });
      }
    }
    set.commonAreas = next;
  }

  const doc = await PropertyOperations.findOneAndUpdate(
    { propertyId: id },
    { $set: set, $setOnInsert: { propertyId: id } },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  return NextResponse.json({ data: serialize(doc as Parameters<typeof serialize>[0]) });
}
