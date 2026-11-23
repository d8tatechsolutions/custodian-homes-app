import { defaultDuplexUnitName, defaultUnitName } from "@/lib/unit-naming";

/**
 * Duplex / simplex layout resolution.
 *
 * A unit is a duplex (spans its floor and the floor directly above it in the
 * same block) or a simplex (single floor). The flag resolves from most to least
 * specific:
 *
 *   unit override (`unitDuplex[i]`) -> floor flag (`duplex`) -> block flag
 *
 * so one property can mix duplex and simplex at every level: whole blocks,
 * individual floors, or individual units on the same floor.
 *
 * What a duplex does to the floor above is chosen on the floor the duplexes
 * start from (`upperFloorMode`):
 *
 * - `keep`    — the floor above keeps its own unit count (default; the
 *               behaviour before this setting existed).
 * - `consume` — the floor above's `unitsPerFloor` is its number of slots; every
 *               duplex spanning into it takes one slot.
 * - `full`    — the floor above holds no standalone units.
 *
 * This module is pure: the create flow, the structure reconcile and the editor
 * preview all resolve layouts through it, so they can never disagree.
 */

export const UPPER_FLOOR_MODES = ["keep", "consume", "full"] as const;
export type UpperFloorMode = (typeof UPPER_FLOOR_MODES)[number];
export const DEFAULT_UPPER_FLOOR_MODE: UpperFloorMode = "keep";

export const UPPER_FLOOR_MODE_LABELS: Record<UpperFloorMode, string> = {
  keep: "Floor above keeps its own units",
  consume: "Each duplex takes a slot above",
  full: "Floor above fully taken",
};

export interface LayoutFloorSpec {
  level: number;
  unitsPerFloor?: number | null;
  /** Floor-level duplex flag; null/undefined inherits the block flag. */
  duplex?: boolean | null;
  /** Per-unit overrides by position; null/undefined inherits the floor flag. */
  unitDuplex?: (boolean | null | undefined)[] | null;
  /** How duplexes starting on this floor affect the floor above. */
  upperFloorMode?: UpperFloorMode | null;
}

export interface FloorLayout {
  level: number;
  /** The `unitsPerFloor` value entered for this floor. */
  requested: number;
  /** Units actually materialised on this floor after duplexes from below. */
  count: number;
  /** One entry per materialised unit: true = duplex. */
  duplexFlags: boolean[];
  duplexCount: number;
  upperFloorMode: UpperFloorMode;
  /** Units the floor below took from this floor (`consume` / `full`). */
  takenByBelow: number;
  /** Whether this floor has a floor above it in the block. */
  hasFloorAbove: boolean;
}

export class DuplexLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplexLayoutError";
  }
}

export function normalizeUpperFloorMode(value: unknown): UpperFloorMode {
  return (UPPER_FLOOR_MODES as readonly unknown[]).includes(value)
    ? (value as UpperFloorMode)
    : DEFAULT_UPPER_FLOOR_MODE;
}

function floorName(level: number): string {
  return level <= 0 ? "Ground floor" : `Floor ${level}`;
}

export interface ResolveBlockLayoutOptions {
  blockName?: string;
  /**
   * When true, a floor whose own `duplex` flag is explicitly `true` but has no
   * floor above is an error. A duplex inherited from the block on the top floor
   * is always resolved to simplex silently (there is nothing to span into).
   */
  strictFloorDuplex?: boolean;
  /**
   * When provided, layout errors are pushed here instead of thrown and the
   * layout is still resolved (clamped), so an editor can keep showing every
   * control the user needs to fix the problem.
   */
  collectErrors?: string[];
}

/**
 * Resolve every floor of one block, in array order (index + 1 is the floor
 * above, matching how duplex units pick their secondary floor).
 */
export function resolveBlockLayout(
  floors: LayoutFloorSpec[],
  blockDuplex: boolean | null | undefined,
  options: ResolveBlockLayoutOptions = {},
): FloorLayout[] {
  const where = options.blockName ? ` in block "${options.blockName}"` : "";
  const layouts: FloorLayout[] = [];
  const fail = (message: string) => {
    if (options.collectErrors) options.collectErrors.push(message);
    else throw new DuplexLayoutError(message);
  };

  floors.forEach((floor, index) => {
    const requested = Math.max(0, Math.floor(Number(floor.unitsPerFloor ?? 0) || 0));
    const below = index > 0 ? layouts[index - 1] : null;

    let count = requested;
    let takenByBelow = 0;
    if (below && below.duplexCount > 0) {
      if (below.upperFloorMode === "consume") {
        if (below.duplexCount > requested) {
          fail(
            `${floorName(floor.level)}${where} has ${requested} unit slot(s) but ${below.duplexCount} duplex unit(s) from ${floorName(below.level).toLowerCase()} span into it. Increase its slots or reduce the duplexes below.`,
          );
        }
        count = Math.max(0, requested - below.duplexCount);
        takenByBelow = Math.min(requested, below.duplexCount);
      } else if (below.upperFloorMode === "full") {
        count = 0;
        takenByBelow = requested;
      }
    }

    const hasFloorAbove = index + 1 < floors.length;
    if (options.strictFloorDuplex && floor.duplex === true && !hasFloorAbove) {
      fail(`Floor ${floor.level}${where} is marked duplex but has no floor above to span into.`);
    }
    const floorDefault = floor.duplex ?? blockDuplex ?? false;

    const duplexFlags = Array.from({ length: count }, (_, unitIndex) => {
      const override = floor.unitDuplex?.[unitIndex];
      if (override === true && !hasFloorAbove) {
        fail(
          `Unit ${unitIndex + 1} on ${floorName(floor.level).toLowerCase()}${where} is marked duplex but there is no floor above to span into.`,
        );
      }
      const wanted = override ?? floorDefault;
      return wanted === true && hasFloorAbove;
    });

    layouts.push({
      level: floor.level,
      requested,
      count,
      duplexFlags,
      duplexCount: duplexFlags.filter(Boolean).length,
      upperFloorMode: normalizeUpperFloorMode(floor.upperFloorMode),
      takenByBelow,
      hasFloorAbove,
    });
  });

  return layouts;
}

/**
 * Unit names for one resolved floor. A custom name at a position wins;
 * otherwise duplexes get `3A-4A` and simplex units get `3A`.
 */
export function buildLayoutUnitNames(
  level: number,
  nextLevel: number | null,
  duplexFlags: boolean[],
  customNames?: string[],
): string[] {
  return duplexFlags.map((isDuplex, index) => {
    const custom = customNames?.[index]?.trim();
    if (custom && custom.length > 0) return custom;
    return isDuplex && nextLevel != null
      ? defaultDuplexUnitName(level, nextLevel, index)
      : defaultUnitName(level, index);
  });
}

/**
 * Trim a per-unit override list to the floor's unit count. Explicit choices
 * are kept as-is (never collapsed into "inherit"), so a later change to the
 * floor or block flag cannot silently flip units someone set by hand.
 */
export function normalizeUnitDuplex(
  unitDuplex: (boolean | null | undefined)[] | null | undefined,
  count: number,
): (boolean | null)[] {
  if (!unitDuplex || unitDuplex.length === 0) return [];
  const trimmed = unitDuplex
    .slice(0, count)
    .map((value) => (value === true || value === false ? value : null));
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === null) trimmed.pop();
  return trimmed;
}
