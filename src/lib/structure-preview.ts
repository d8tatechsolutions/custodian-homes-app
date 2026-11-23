import type { BlockInputPayload } from "@/hooks/use-properties";
import { buildLayoutUnitNames, type FloorLayout, resolveBlockLayout } from "@/lib/duplex-layout";

/**
 * Client-side mirror of the server's structure resolution, for editors and
 * previews. It resolves through the same `resolveBlockLayout` the create and
 * reconcile flows use, so what the UI shows (and blocks) is exactly what the
 * server would accept and materialise.
 */

export interface PreviewFloor {
  layout: FloorLayout;
  /** Unit names in position order, duplexes as `3A-4A`. */
  names: string[];
}

export interface PreviewBlock {
  floors: PreviewFloor[];
  /** First layout error for this block (the server would reject the save), or null. */
  error: string | null;
}

export function previewBlock(block: BlockInputPayload): PreviewBlock {
  const errors: string[] = [];
  // Errors are collected rather than thrown so the editor keeps every duplex
  // control visible while the user fixes the problem.
  const layouts = resolveBlockLayout(block.floors, block.duplex ?? false, {
    blockName: block.name,
    strictFloorDuplex: true,
    collectErrors: errors,
  });
  return {
    error: errors[0] ?? null,
    floors: layouts.map((layout, index) => ({
      layout,
      names: buildLayoutUnitNames(
        block.floors[index].level,
        index + 1 < block.floors.length ? block.floors[index + 1].level : null,
        layout.duplexFlags,
        block.floors[index].unitNames,
      ),
    })),
  };
}

/** Units a payload block materialises (after duplexes take slots above). */
export function countPreviewUnits(block: BlockInputPayload): number {
  return previewBlock(block).floors.reduce((sum, floor) => sum + floor.layout.count, 0);
}
