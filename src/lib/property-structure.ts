import { Types } from "mongoose";
import type { PropertyPurpose } from "@/lib/domain-enums";
import {
  DuplexLayoutError,
  type FloorLayout,
  normalizeUnitDuplex,
  resolveBlockLayout,
  type UpperFloorMode,
} from "@/lib/duplex-layout";
import {
  MAX_UNITS_PER_PROPERTY,
  type PersistedBlock,
  type StructureBlockInput,
  type UnitInsert,
} from "@/lib/schemas/structure";
import { defaultDuplexUnitName, defaultUnitName, letterLabel } from "@/lib/unit-naming";

/**
 * Reconciles a property's persisted `blocks` structure with an edited payload,
 * emitting the exact unit documents to create/update/soft-delete.
 *
 * Matching is id-based: a block/floor that carries an existing subdocument `id`
 * is edited in place; one without an `id` is created. Existing units are never
 * rebuilt from scratch (their `_id`s are referenced by move requests and
 * invoices), so the planner computes a minimal diff instead.
 *
 * Invariants enforced (throw `StructureError` when violated):
 * - A block/floor holding an occupied unit cannot be removed.
 * - `unitsPerFloor` cannot drop below the number of occupied units on a floor.
 * - Unit names stay unique within a block.
 * - The property never exceeds `MAX_UNITS_PER_PROPERTY`.
 */

export interface ExistingUnit {
  _id: unknown;
  blockId: string;
  floorId: string;
  name: string;
  letter: string;
  status: string;
  /** ID of the secondary floor for duplex units (empty if single-floor). */
  secondaryFloorId?: string;
  /** Floors this unit spans today (1 = simplex, 2 = duplex). */
  spanFloors?: number;
  /** Array of occupant user ids. Empty = vacant. */
  tenantId?: string[];
}

export interface NextFloor {
  _id: Types.ObjectId;
  level: number;
  label: string;
  unitsPerFloor: number;
  rentOverride: number | null;
  purpose: PropertyPurpose | null;
  duplex: boolean | null;
  unitDuplex: (boolean | null)[];
  upperFloorMode: UpperFloorMode;
}

export interface NextBlock {
  _id: Types.ObjectId;
  name: string;
  order: number;
  rentOverride: number | null;
  purpose: PropertyPurpose | null;
  duplex: boolean;
  floors: NextFloor[];
}

export interface UnitUpdate {
  id: string;
  blockId: string;
  blockName: string;
  floorId: string;
  floorLevel: number;
  floorLabel: string;
  spanFloors: number;
  secondaryFloorId: string;
  secondaryFloorLevel: number;
}

export interface StructurePlanInput {
  propertyId: string;
  ownerId: string;
  existingBlocks: PersistedBlock[];
  existingUnits: ExistingUnit[];
  specs: StructureBlockInput[];
}

export interface StructurePlan {
  blocks: NextBlock[];
  unitCreates: UnitInsert[];
  unitUpdates: UnitUpdate[];
  unitDeletes: string[];
}

export class StructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructureError";
  }
}

function isOccupied(unit: ExistingUnit): boolean {
  return unit.status === "occupied" || (unit.tenantId?.length ?? 0) > 0;
}

/** Zero-based index encoded in a unit letter: "A" -> 0, "Z" -> 25, "AA" -> 26. */
function letterIndex(letter: string): number {
  const upper = letter.trim().toUpperCase();
  if (!upper) return Number.MAX_SAFE_INTEGER;
  let value = 0;
  for (const ch of upper) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) return Number.MAX_SAFE_INTEGER;
    value = value * 26 + code;
  }
  return value - 1;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function planStructureUpdate(input: StructurePlanInput): StructurePlan {
  const { propertyId, ownerId, existingBlocks, existingUnits, specs } = input;

  const blockById = new Map(existingBlocks.map((block) => [String(block._id), block]));
  const unitsByBlock = groupBy(existingUnits, (unit) => unit.blockId);
  const unitsByFloor = groupBy(existingUnits, (unit) => unit.floorId);

  const unitCreates: UnitInsert[] = [];
  const unitUpdates: UnitUpdate[] = [];
  const unitDeletes: string[] = [];
  const deletedUnitIds = new Set<string>();

  const specBlockIds = new Set(specs.map((spec) => spec.id).filter(Boolean) as string[]);

  // 1. Whole blocks that disappeared from the payload.
  for (const block of existingBlocks) {
    const blockId = String(block._id);
    if (specBlockIds.has(blockId)) continue;
    const units = unitsByBlock.get(blockId) ?? [];
    if (units.some(isOccupied)) {
      throw new StructureError(
        `Block "${block.name}" has occupied units and cannot be removed. Reassign its tenants first.`,
      );
    }
    for (const unit of units) {
      unitDeletes.push(String(unit._id));
      deletedUnitIds.add(String(unit._id));
    }
  }

  // 2. Floors removed from a block that is being kept.
  for (const spec of specs) {
    if (!spec.id) continue;
    const block = blockById.get(spec.id);
    if (!block) continue;
    const specFloorIds = new Set(spec.floors.map((floor) => floor.id).filter(Boolean) as string[]);
    for (const floor of block.floors) {
      const floorId = String(floor._id);
      if (specFloorIds.has(floorId)) continue;
      const units = (unitsByFloor.get(floorId) ?? []).filter(
        (unit) => !deletedUnitIds.has(String(unit._id)),
      );
      if (units.some(isOccupied)) {
        throw new StructureError(
          `Floor ${floor.level} in block "${block.name}" has occupied units and cannot be removed.`,
        );
      }
      // Duplex: a unit on an adjacent floor may span into this floor.
      const spanningUnits = existingUnits.filter(
        (unit) =>
          !deletedUnitIds.has(String(unit._id)) &&
          unit.secondaryFloorId === floorId &&
          isOccupied(unit),
      );
      if (spanningUnits.length > 0) {
        throw new StructureError(
          `Floor ${floor.level} in block "${block.name}" is occupied by a duplex unit spanning from an adjacent floor and cannot be removed.`,
        );
      }
      // Delete units directly on this floor.
      for (const unit of units) {
        unitDeletes.push(String(unit._id));
        deletedUnitIds.add(String(unit._id));
      }
      // Delete duplex units that span into this floor (from adjacent floor).
      for (const unit of existingUnits) {
        if (deletedUnitIds.has(String(unit._id))) continue;
        if (unit.secondaryFloorId !== floorId) continue;
        unitDeletes.push(String(unit._id));
        deletedUnitIds.add(String(unit._id));
      }
    }
  }

  // 3. Build the next structure and the matching unit mutations.
  const blocks: NextBlock[] = specs.map((spec, order) => {
    const existingBlock = spec.id ? blockById.get(spec.id) : undefined;
    const blockId = existingBlock ? String(existingBlock._id) : String(new Types.ObjectId());

    const blockDuplex = spec.duplex ?? existingBlock?.duplex ?? false;

    const existingFloors = spec.floors.map((floorSpec) =>
      existingBlock && floorSpec.id
        ? existingBlock.floors.find((floor) => String(floor._id) === floorSpec.id)
        : undefined,
    );
    // Pre-resolve floor IDs so duplex units can reference their secondary floor.
    const floorIds = existingFloors.map((floor) =>
      floor ? String(floor._id) : String(new Types.ObjectId()),
    );

    // Resolve duplex / simplex per unit and how duplexes affect the floor above.
    // Settings the payload omits fall back to what is saved, so an editor that
    // does not send them can never reset units someone configured by hand.
    let layouts: FloorLayout[];
    try {
      layouts = resolveBlockLayout(
        spec.floors.map((floorSpec, floorIndex) => {
          const existingFloor = existingFloors[floorIndex];
          return {
            level: floorSpec.level,
            unitsPerFloor: floorSpec.unitsPerFloor ?? 0,
            duplex: floorSpec.duplex != null ? floorSpec.duplex : (existingFloor?.duplex ?? null),
            unitDuplex: floorSpec.unitDuplex ?? existingFloor?.unitDuplex ?? [],
            upperFloorMode: floorSpec.upperFloorMode ?? existingFloor?.upperFloorMode ?? null,
          };
        }),
        blockDuplex,
        { blockName: spec.name, strictFloorDuplex: true },
      );
    } catch (error) {
      if (error instanceof DuplexLayoutError) throw new StructureError(error.message);
      throw error;
    }

    const usedNames = new Set<string>();
    for (const unit of unitsByBlock.get(blockId) ?? []) {
      if (!deletedUnitIds.has(String(unit._id))) usedNames.add(unit.name.trim().toLowerCase());
    }

    const reserveName = (candidate: string): string => {
      const key = candidate.trim().toLowerCase();
      if (usedNames.has(key)) {
        throw new StructureError(
          `Unit name "${candidate}" already exists in block "${spec.name}".`,
        );
      }
      usedNames.add(key);
      return candidate;
    };

    const floors: NextFloor[] = spec.floors.map((floorSpec, floorIndex) => {
      const existingFloor = existingFloors[floorIndex];
      const floorId = floorIds[floorIndex];
      const layout = layouts[floorIndex];
      const label = floorSpec.label ?? existingFloor?.label ?? "";
      // Units this floor materialises (duplexes from below may take slots).
      const desired = layout.count;

      // Secondary floor for duplex units (the floor above in the same block).
      const nextFloorId = floorIndex + 1 < floorIds.length ? floorIds[floorIndex + 1] : null;
      const nextFloorLevel =
        floorIndex + 1 < spec.floors.length ? spec.floors[floorIndex + 1].level : null;

      const spanFor = (position: number) =>
        layout.duplexFlags[position] === true && nextFloorId != null && nextFloorLevel != null
          ? { spanFloors: 2, secondaryFloorId: nextFloorId, secondaryFloorLevel: nextFloorLevel }
          : { spanFloors: 1, secondaryFloorId: "", secondaryFloorLevel: 0 };

      const nameFor = (position: number): string => {
        const custom = floorSpec.unitNames?.[position]?.trim();
        if (custom && custom.length > 0) return reserveName(custom);
        const generated =
          layout.duplexFlags[position] === true && nextFloorLevel != null
            ? defaultDuplexUnitName(floorSpec.level, nextFloorLevel, position)
            : defaultUnitName(floorSpec.level, position);
        return reserveName(generated);
      };

      const insertFor = (position: number): UnitInsert => ({
        propertyId,
        ownerId,
        blockId,
        blockName: spec.name,
        floorId,
        floorLevel: floorSpec.level,
        floorLabel: label,
        name: nameFor(position),
        letter: letterLabel(position),
        status: "available",
        rent: null,
        purpose: null,
        ...spanFor(position),
        tenantId: [],
      });

      if (existingFloor) {
        const sorted = (unitsByFloor.get(floorId) ?? [])
          .filter((unit) => !deletedUnitIds.has(String(unit._id)))
          .sort((a, b) => letterIndex(a.letter) - letterIndex(b.letter));

        if (desired < sorted.length) {
          const removable = sorted.slice(desired);
          if (removable.some(isOccupied)) {
            const reason =
              layout.takenByBelow > 0
                ? ` (${layout.takenByBelow} slot(s) are taken by duplex units from the floor below)`
                : "";
            throw new StructureError(
              `Cannot reduce units on floor ${floorSpec.level} below its ${sorted.filter(isOccupied).length} occupied unit(s)${reason}.`,
            );
          }
          for (const unit of removable) {
            unitDeletes.push(String(unit._id));
            deletedUnitIds.add(String(unit._id));
            usedNames.delete(unit.name.trim().toLowerCase());
          }
        }

        // Existing units keep their id and name; only placement/span change.
        const surviving = sorted.slice(0, Math.min(desired, sorted.length));
        surviving.forEach((unit, position) => {
          const span = spanFor(position);
          if (isOccupied(unit) && span.spanFloors !== (unit.spanFloors ?? 1)) {
            throw new StructureError(
              `Unit "${unit.name}" is occupied and cannot be switched between duplex and simplex. Move the tenant out first.`,
            );
          }
          unitUpdates.push({
            id: String(unit._id),
            blockId,
            blockName: spec.name,
            floorId,
            floorLevel: floorSpec.level,
            floorLabel: label,
            ...span,
          });
        });

        for (let position = surviving.length; position < desired; position += 1) {
          unitCreates.push(insertFor(position));
        }
      } else {
        // Brand-new floor.
        for (let position = 0; position < desired; position += 1) {
          unitCreates.push(insertFor(position));
        }
      }

      return {
        _id: new Types.ObjectId(floorId),
        level: floorSpec.level,
        label,
        // The entered value (slots when the floor below consumes them).
        unitsPerFloor: layout.requested,
        rentOverride: floorSpec.rentOverride ?? null,
        purpose: floorSpec.purpose ?? null,
        // Keep the floor's own choice (null = inherit the block flag).
        duplex: floorSpec.duplex != null ? floorSpec.duplex : (existingFloor?.duplex ?? null),
        unitDuplex: normalizeUnitDuplex(
          floorSpec.unitDuplex ?? existingFloor?.unitDuplex ?? [],
          layout.count,
        ),
        upperFloorMode: layout.upperFloorMode,
      };
    });

    return {
      _id: new Types.ObjectId(blockId),
      name: spec.name,
      order,
      rentOverride: spec.rentOverride ?? null,
      purpose: spec.purpose ?? null,
      duplex: blockDuplex,
      floors,
    };
  });

  const totalUnits = existingUnits.length - unitDeletes.length + unitCreates.length;
  if (totalUnits > MAX_UNITS_PER_PROPERTY) {
    throw new StructureError(
      `A property may have at most ${MAX_UNITS_PER_PROPERTY} units (this change would create ${totalUnits}).`,
    );
  }

  return { blocks, unitCreates, unitUpdates, unitDeletes };
}
