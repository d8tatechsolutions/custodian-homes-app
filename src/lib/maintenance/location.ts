import type { TaskLocationKind } from "@/lib/maintenance/enums";

export interface LocationInput {
  kind: TaskLocationKind;
  blockId?: string;
  floorId?: string;
  unitId?: string;
  commonAreaId?: string;
}

export interface ResolvedLocation {
  kind: TaskLocationKind;
  blockId: string;
  floorId: string;
  unitId: string;
  commonAreaId: string;
  label: string;
}

interface PropertyShape {
  blocks?: {
    _id: unknown;
    name: string;
    floors?: { _id: unknown; level: number; label?: string }[];
  }[];
}

interface UnitShape {
  _id: unknown;
  propertyId: string;
  name: string;
  blockId: string;
  floorId: string;
}

interface CommonAreaShape {
  _id: unknown;
  name: string;
  isActive?: boolean;
}

export function floorName(floor: { level: number; label?: string }): string {
  return floor.label || (floor.level === 0 ? "Ground" : `Floor ${floor.level}`);
}

/**
 * Validates that a task location belongs to the property and builds its
 * breadcrumb label ("Block A › Floor 3 › 3B", "Common area: Main gate").
 * Returns a user-facing error string instead of throwing.
 */
export function resolveTaskLocation(
  propertyId: string,
  input: LocationInput | undefined,
  property: PropertyShape,
  unit: UnitShape | null,
  commonAreas: CommonAreaShape[],
): ResolvedLocation | { error: string } {
  const empty: ResolvedLocation = {
    kind: "property",
    blockId: "",
    floorId: "",
    unitId: "",
    commonAreaId: "",
    label: "",
  };
  if (!input || input.kind === "property") return empty;

  if (input.kind === "common_area") {
    const area = commonAreas.find(
      (a) => String(a._id) === input.commonAreaId && a.isActive !== false,
    );
    if (!area) return { error: "Choose a common area of this property" };
    return {
      ...empty,
      kind: "common_area",
      commonAreaId: String(area._id),
      label: `Common area: ${area.name}`,
    };
  }

  if (input.kind === "unit") {
    if (!unit || unit.propertyId !== propertyId)
      return { error: "That unit is not part of this property" };
    const block = property.blocks?.find((b) => String(b._id) === unit.blockId);
    const floor = block?.floors?.find((f) => String(f._id) === unit.floorId);
    return {
      ...empty,
      kind: "unit",
      unitId: String(unit._id),
      blockId: unit.blockId,
      floorId: unit.floorId,
      label: [block?.name, floor ? floorName(floor) : "", unit.name].filter(Boolean).join(" › "),
    };
  }

  const block = property.blocks?.find((b) => String(b._id) === input.blockId);
  if (!block) return { error: "Choose a block of this property" };
  if (input.kind === "block") {
    return { ...empty, kind: "block", blockId: String(block._id), label: block.name };
  }

  const floor = block.floors?.find((f) => String(f._id) === input.floorId);
  if (!floor) return { error: "Choose a floor of that block" };
  return {
    ...empty,
    kind: "floor",
    blockId: String(block._id),
    floorId: String(floor._id),
    label: `${block.name} › ${floorName(floor)}`,
  };
}
