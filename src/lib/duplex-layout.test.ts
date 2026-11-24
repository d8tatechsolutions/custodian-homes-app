import { describe, expect, it } from "vitest";
import {
  buildLayoutUnitNames,
  DuplexLayoutError,
  normalizeUnitDuplex,
  normalizeUpperFloorMode,
  resolveBlockLayout,
} from "@/lib/duplex-layout";

describe("resolveBlockLayout — duplex/simplex mixing", () => {
  it("defaults to all simplex", () => {
    const [ground, first] = resolveBlockLayout(
      [
        { level: 0, unitsPerFloor: 2 },
        { level: 1, unitsPerFloor: 2 },
      ],
      false,
    );
    expect(ground.duplexFlags).toEqual([false, false]);
    expect(first.duplexFlags).toEqual([false, false]);
  });

  it("block flag makes every unit duplex except the top floor (nothing above)", () => {
    const layouts = resolveBlockLayout(
      [
        { level: 1, unitsPerFloor: 2 },
        { level: 2, unitsPerFloor: 2 },
      ],
      true,
    );
    expect(layouts[0].duplexFlags).toEqual([true, true]);
    expect(layouts[1].duplexFlags).toEqual([false, false]);
  });

  it("floor flag overrides the block flag (mixed floors in one block)", () => {
    const layouts = resolveBlockLayout(
      [
        { level: 1, unitsPerFloor: 2, duplex: false },
        { level: 2, unitsPerFloor: 2, duplex: true },
        { level: 3, unitsPerFloor: 2 },
      ],
      false,
    );
    expect(layouts[0].duplexFlags).toEqual([false, false]);
    expect(layouts[1].duplexFlags).toEqual([true, true]);
  });

  it("unit overrides mix duplex and simplex on the same floor", () => {
    const [third] = resolveBlockLayout(
      [
        { level: 3, unitsPerFloor: 4, unitDuplex: [true, true, null, false] },
        { level: 4, unitsPerFloor: 4 },
      ],
      false,
    );
    expect(third.duplexFlags).toEqual([true, true, false, false]);
    expect(third.duplexCount).toBe(2);
  });

  it("a unit override beats a duplex floor", () => {
    const [floor] = resolveBlockLayout(
      [
        { level: 1, unitsPerFloor: 3, duplex: true, unitDuplex: [null, false] },
        { level: 2, unitsPerFloor: 3 },
      ],
      false,
    );
    expect(floor.duplexFlags).toEqual([true, false, true]);
  });

  it("rejects a unit override on the top floor", () => {
    expect(() =>
      resolveBlockLayout([{ level: 1, unitsPerFloor: 1, unitDuplex: [true] }], false),
    ).toThrow(DuplexLayoutError);
  });

  it("strict mode rejects an explicit duplex top floor but not a block-inherited one", () => {
    expect(() =>
      resolveBlockLayout([{ level: 1, unitsPerFloor: 1, duplex: true }], false, {
        strictFloorDuplex: true,
      }),
    ).toThrow(/no floor above/);
    expect(() =>
      resolveBlockLayout([{ level: 1, unitsPerFloor: 1 }], true, { strictFloorDuplex: true }),
    ).not.toThrow();
  });
});

describe("resolveBlockLayout — upper floor modes", () => {
  const twoDuplexes = { level: 3, unitsPerFloor: 4, unitDuplex: [true, true] };

  it("keep: the floor above keeps its own count", () => {
    const [, upper] = resolveBlockLayout(
      [
        { ...twoDuplexes, upperFloorMode: "keep" },
        { level: 4, unitsPerFloor: 4 },
      ],
      false,
    );
    expect(upper.count).toBe(4);
    expect(upper.takenByBelow).toBe(0);
  });

  it("consume: each duplex takes one slot above", () => {
    const [, upper] = resolveBlockLayout(
      [
        { ...twoDuplexes, upperFloorMode: "consume" },
        { level: 4, unitsPerFloor: 4 },
      ],
      false,
    );
    expect(upper.requested).toBe(4);
    expect(upper.count).toBe(2);
    expect(upper.takenByBelow).toBe(2);
  });

  it("consume: rejects more duplexes than slots above", () => {
    expect(() =>
      resolveBlockLayout(
        [
          { ...twoDuplexes, upperFloorMode: "consume" },
          { level: 4, unitsPerFloor: 1 },
        ],
        false,
      ),
    ).toThrow(/1 unit slot\(s\) but 2 duplex/);
  });

  it("full: the floor above has no standalone units", () => {
    const [, upper] = resolveBlockLayout(
      [
        { ...twoDuplexes, upperFloorMode: "full" },
        { level: 4, unitsPerFloor: 4 },
      ],
      false,
    );
    expect(upper.count).toBe(0);
    expect(upper.duplexFlags).toEqual([]);
  });

  it("modes only apply when the floor below actually has duplexes", () => {
    const [, upper] = resolveBlockLayout(
      [
        { level: 3, unitsPerFloor: 4, upperFloorMode: "full" },
        { level: 4, unitsPerFloor: 4 },
      ],
      false,
    );
    expect(upper.count).toBe(4);
  });

  it("chains through alternating duplex floors", () => {
    const layouts = resolveBlockLayout(
      [
        { level: 1, unitsPerFloor: 2, upperFloorMode: "full" },
        { level: 2, unitsPerFloor: 2 },
        { level: 3, unitsPerFloor: 2, upperFloorMode: "full" },
        { level: 4, unitsPerFloor: 2 },
      ],
      true,
    );
    expect(layouts.map((l) => l.count)).toEqual([2, 0, 2, 0]);
    expect(layouts.map((l) => l.duplexCount)).toEqual([2, 0, 2, 0]);
  });

  it("collectErrors keeps resolving instead of throwing", () => {
    const errors: string[] = [];
    const [, upper] = resolveBlockLayout(
      [
        { ...twoDuplexes, upperFloorMode: "consume" },
        { level: 4, unitsPerFloor: 1 },
      ],
      false,
      { collectErrors: errors },
    );
    expect(errors).toHaveLength(1);
    expect(upper.count).toBe(0);
  });
});

describe("helpers", () => {
  it("names duplexes 3A-4A and simplex units 3A, with custom names winning", () => {
    expect(buildLayoutUnitNames(3, 4, [true, false, true], ["", "", "Penthouse"])).toEqual([
      "3A-4A",
      "3B",
      "Penthouse",
    ]);
    expect(buildLayoutUnitNames(0, 1, [true])).toEqual(["GA-1A"]);
  });

  it("normalizes upper floor modes", () => {
    expect(normalizeUpperFloorMode("full")).toBe("full");
    expect(normalizeUpperFloorMode(undefined)).toBe("keep");
    expect(normalizeUpperFloorMode("bogus")).toBe("keep");
  });

  it("trims overrides to the unit count and keeps explicit choices", () => {
    expect(normalizeUnitDuplex([true, null, false, true], 3)).toEqual([true, null, false]);
    expect(normalizeUnitDuplex([null, null], 2)).toEqual([]);
    expect(normalizeUnitDuplex(undefined, 2)).toEqual([]);
  });
});
