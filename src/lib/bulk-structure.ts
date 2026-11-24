import type { BlockInputPayload, FloorInputPayload } from "@/hooks/use-properties";
import {
  buildLayoutUnitNames,
  normalizeUpperFloorMode,
  resolveBlockLayout,
  type UpperFloorMode,
} from "@/lib/duplex-layout";
import { MAX_UNITS_PER_PROPERTY } from "@/lib/schemas/structure";

export interface BulkFloorSpec {
  floorCount: number;
  unitsPerFloor: number;
  includeGroundFloor: boolean;
  startLevel?: number;
  floorRentOverride?: number | null;
  customUnitNames?: string[];
  duplex?: boolean | null;
  /** What duplexes do to the floor above (keep | consume | full). */
  upperFloorMode?: UpperFloorMode | null;
}

export interface BulkBlockSpec {
  name: string;
  duplex: boolean;
  floors: BulkFloorSpec;
  rentOverride?: number | null;
}

export interface BulkGenerationInput {
  blocks: BulkBlockSpec[];
  existingUnitCount?: number;
  /** Names of blocks already on the property; generated blocks must not reuse them. */
  existingBlockNames?: string[];
  /**
   * Bulk generation only ever appends: existing blocks, floors and units are
   * never replaced. Kept for call-site compatibility; "append" is the only mode.
   */
  mode?: "append";
}

export class BulkStructureError extends Error {
  name = "BulkStructureError";
}

export function validateBulkGeneration(input: BulkGenerationInput): string[] {
  const errors: string[] = [];
  const seenNames = new Set<string>();
  const existingNames = new Set(
    (input.existingBlockNames ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean),
  );

  for (const block of input.blocks) {
    const name = block.name.trim();
    if (!name) {
      errors.push("Every block needs a name.");
    } else {
      const key = name.toLowerCase();
      if (seenNames.has(key)) errors.push(`Duplicate block name: ${name}`);
      if (existingNames.has(key)) {
        errors.push(
          `A block named "${name}" already exists. Choose a new name — bulk generate only adds blocks.`,
        );
      }
      seenNames.add(key);
    }

    const spec = block.floors;
    if (spec.floorCount < 0 || !Number.isInteger(spec.floorCount)) {
      errors.push("Floor count must be a non-negative integer.");
    }
    if (spec.unitsPerFloor < 0 || !Number.isInteger(spec.unitsPerFloor)) {
      errors.push("Units per floor must be a non-negative integer.");
    }
    if (spec.floorCount > 200) {
      errors.push("A block may have at most 200 floors.");
    }
    if (spec.unitsPerFloor > 200) {
      errors.push("A floor may have at most 200 units.");
    }
  }

  // Cap check against existing + generated units. Duplexes that take slots on
  // the floor above are accounted for, so the count matches what gets created.
  let generatedUnits = 0;
  if (errors.length === 0) {
    for (const block of input.blocks) {
      try {
        generatedUnits += generateBulkFloors(block.floors).reduce(
          (sum, floor) => sum + (floor.unitNames?.length ?? 0),
          0,
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Invalid floor layout.");
      }
    }
  }
  const existing = input.existingUnitCount ?? 0;
  if (existing + generatedUnits > MAX_UNITS_PER_PROPERTY) {
    errors.push(
      `A property may have at most ${MAX_UNITS_PER_PROPERTY} units (this change would create ${existing + generatedUnits}).`,
    );
  }

  return errors;
}

export function generateBulkFloors(spec: BulkFloorSpec): FloorInputPayload[] {
  if (spec.floorCount < 0 || !Number.isInteger(spec.floorCount)) {
    throw new BulkStructureError("Floor count must be a non-negative integer.");
  }
  if (spec.unitsPerFloor < 0 || !Number.isInteger(spec.unitsPerFloor)) {
    throw new BulkStructureError("Units per floor must be a non-negative integer.");
  }
  if (spec.floorCount > 200) {
    throw new BulkStructureError("A block may have at most 200 floors.");
  }
  if (spec.unitsPerFloor > 200) {
    throw new BulkStructureError("A floor may have at most 200 units.");
  }

  if (spec.floorCount <= 0) return [];

  const startLevel = spec.startLevel ?? 1;
  const upperFloorCount = spec.floorCount - (spec.includeGroundFloor ? 1 : 0);
  const levels: number[] = [];
  if (spec.includeGroundFloor) levels.push(0);
  for (let i = 0; i < upperFloorCount; i++) levels.push(startLevel + i);

  const upperFloorMode = normalizeUpperFloorMode(spec.upperFloorMode);

  // A floor can only be duplex if there is a floor above to span into, so the
  // top floor is explicitly simplex when the block is duplex.
  const floors: FloorInputPayload[] = levels.map((level, index) => {
    const canBeDuplex = index < levels.length - 1;
    const isDuplex = spec.duplex === true && canBeDuplex;
    return {
      level,
      label: "",
      unitsPerFloor: spec.unitsPerFloor,
      unitNames: [],
      rentOverride: spec.floorRentOverride ?? null,
      purpose: null,
      duplex: isDuplex ? true : spec.duplex === true ? false : (spec.duplex ?? null),
      upperFloorMode,
    };
  });

  // Resolve the real layout (duplexes may take slots above) so the names and
  // counts shown before saving are exactly what the server will create.
  const layouts = resolveBlockLayout(floors, spec.duplex === true);
  return floors.map((floor, index) => ({
    ...floor,
    unitNames: buildLayoutUnitNames(
      floor.level,
      index + 1 < floors.length ? floors[index + 1].level : null,
      layouts[index].duplexFlags,
      spec.customUnitNames,
    ),
  }));
}

export function generateBulkBlock(spec: BulkBlockSpec): BlockInputPayload {
  const floors = generateBulkFloors(spec.floors);
  return {
    name: spec.name.trim() || "Block A",
    rentOverride: spec.rentOverride ?? null,
    purpose: null,
    duplex: spec.duplex,
    floors,
  };
}

export function generateBulkStructure(input: BulkGenerationInput): BlockInputPayload[] {
  const errors = validateBulkGeneration(input);
  if (errors.length > 0) {
    throw new BulkStructureError(errors.join(" "));
  }

  return input.blocks.map((block) => generateBulkBlock(block));
}
