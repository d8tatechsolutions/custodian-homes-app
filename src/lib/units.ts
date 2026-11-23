import {
  buildLayoutUnitNames,
  type LayoutFloorSpec,
  resolveBlockLayout,
} from "@/lib/duplex-layout";
import type { BlockInput, PersistedBlock, UnitInsert } from "@/lib/schemas/structure";
import { MAX_UNITS_PER_PROPERTY } from "@/lib/schemas/structure";
import { assertUniqueUnitNames, letterLabel } from "@/lib/unit-naming";

function layoutFloorsFor(block: PersistedBlock | undefined, spec: BlockInput): LayoutFloorSpec[] {
  return spec.floors.map((floorSpec, floorIndex) => {
    const persisted = block?.floors[floorIndex];
    return {
      level: floorSpec.level,
      unitsPerFloor: floorSpec.unitsPerFloor ?? persisted?.unitsPerFloor ?? 0,
      duplex: floorSpec.duplex != null ? floorSpec.duplex : (persisted?.duplex ?? null),
      unitDuplex: floorSpec.unitDuplex ?? persisted?.unitDuplex ?? [],
      upperFloorMode: floorSpec.upperFloorMode ?? persisted?.upperFloorMode ?? null,
    };
  });
}

/**
 * Build the `Unit` documents for a newly created property. `persisted` is the
 * property's saved `blocks` array (subdoc ids), `specs` is the validated create
 * payload; they are zipped by index.
 *
 * Duplex vs simplex is resolved per unit (unit -> floor -> block) and the floor
 * above a duplex follows the floor's `upperFloorMode` — see lib/duplex-layout.ts.
 */
export function buildUnitInserts(
  propertyId: string,
  ownerId: string,
  persisted: PersistedBlock[],
  specs: BlockInput[],
): UnitInsert[] {
  const inserts: UnitInsert[] = [];

  persisted.forEach((block, blockIndex) => {
    const spec = specs[blockIndex];
    if (!spec) return;

    const blockDuplex = spec.duplex ?? block.duplex ?? false;
    const layouts = resolveBlockLayout(layoutFloorsFor(block, spec), blockDuplex, {
      blockName: spec.name,
    });

    const blockNames: string[] = [];
    block.floors.forEach((floor, floorIndex) => {
      const layout = layouts[floorIndex];
      if (!layout) return;
      const nextFloor = floorIndex + 1 < block.floors.length ? block.floors[floorIndex + 1] : null;
      const names = buildLayoutUnitNames(
        floor.level,
        nextFloor?.level ?? null,
        layout.duplexFlags,
        spec.floors[floorIndex]?.unitNames,
      );
      blockNames.push(...names);

      names.forEach((name, unitIndex) => {
        const isDuplex = layout.duplexFlags[unitIndex] === true && nextFloor != null;
        inserts.push({
          propertyId,
          ownerId,
          blockId: String(block._id),
          blockName: block.name,
          floorId: String(floor._id),
          floorLevel: floor.level,
          floorLabel: floor.label ?? "",
          name,
          letter: letterLabel(unitIndex),
          status: "available",
          rent: null,
          purpose: null,
          spanFloors: isDuplex ? 2 : 1,
          secondaryFloorId: isDuplex ? String(nextFloor?._id ?? "") : "",
          secondaryFloorLevel: isDuplex ? (nextFloor?.level ?? 0) : 0,
          tenantId: [],
        });
      });
    });
    // Unit names are unique per block.
    assertUniqueUnitNames(blockNames);
  });

  if (inserts.length > MAX_UNITS_PER_PROPERTY) {
    throw new Error(`A property may have at most ${MAX_UNITS_PER_PROPERTY} units`);
  }
  return inserts;
}

/**
 * Validate every block's duplex layout before anything is written. Returns the
 * first human-readable error, or null when the layout is valid.
 */
export function validateBlockLayouts(specs: BlockInput[]): string | null {
  for (const block of specs) {
    try {
      resolveBlockLayout(layoutFloorsFor(undefined, block), block.duplex ?? false, {
        blockName: block.name,
      });
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid duplex layout";
    }
  }
  return null;
}

/**
 * Total units the create payload would generate (used for pre-insert
 * validation). Duplexes that take slots on the floor above are accounted for;
 * an invalid layout falls back to the raw entered counts so the caller's cap
 * check stays conservative and the layout error surfaces at generation time.
 */
export function countRequestedUnits(specs: BlockInput[]): number {
  return specs.reduce((total, block) => {
    try {
      const layouts = resolveBlockLayout(layoutFloorsFor(undefined, block), block.duplex ?? false);
      return total + layouts.reduce((sum, layout) => sum + layout.count, 0);
    } catch {
      return total + block.floors.reduce((sum, floor) => sum + (floor.unitsPerFloor ?? 0), 0);
    }
  }, 0);
}
