import {
  type LocationInput,
  type ResolvedLocation,
  resolveTaskLocation,
} from "@/lib/maintenance/location";
import { Property } from "@/models/Property";
import { PropertyOperations } from "@/models/PropertyOperations";
import { Unit } from "@/models/Unit";

/** Loads what `resolveTaskLocation` needs from the database and resolves the input. */
export async function loadTaskLocation(
  propertyId: string,
  input: LocationInput | undefined,
): Promise<ResolvedLocation | { error: string }> {
  if (!input || input.kind === "property") {
    return resolveTaskLocation(propertyId, input, {}, null, []);
  }
  const [property, unit, operations] = await Promise.all([
    input.kind === "block" || input.kind === "floor" || input.kind === "unit"
      ? Property.findById(propertyId)
          .select(
            "blocks._id blocks.name blocks.floors._id blocks.floors.level blocks.floors.label",
          )
          .lean()
      : Promise.resolve(null),
    input.kind === "unit" && input.unitId
      ? Unit.findOne({ _id: input.unitId, deletedAt: null })
          .select("propertyId name blockId floorId")
          .lean()
      : Promise.resolve(null),
    input.kind === "common_area"
      ? PropertyOperations.findOne({ propertyId }).select("commonAreas").lean()
      : Promise.resolve(null),
  ]);
  return resolveTaskLocation(
    propertyId,
    input,
    (property ?? {}) as Parameters<typeof resolveTaskLocation>[2],
    (unit ?? null) as Parameters<typeof resolveTaskLocation>[3],
    (operations as { commonAreas?: Parameters<typeof resolveTaskLocation>[4] } | null)
      ?.commonAreas ?? [],
  );
}
