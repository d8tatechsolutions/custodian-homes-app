import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BulkGenerateDialog, nextBlockName } from "@/components/property/BulkGenerateDialog";
import {
  PropertyStructureEditor,
  PropertyStructurePreview,
  summarizeStructure,
  validateBlocks,
} from "@/components/property/PropertyStructureEditor";
import type { BlockInputPayload } from "@/hooks/use-properties";

const block = (over: Partial<BlockInputPayload> = {}): BlockInputPayload => ({
  name: "Block A",
  rentOverride: null,
  floors: [{ level: 0, unitsPerFloor: 0 }],
  ...over,
});

describe("summarizeStructure", () => {
  it("counts blocks, floors and units", () => {
    const summary = summarizeStructure([
      block({
        floors: [
          { level: 0, unitsPerFloor: 2 },
          { level: 1, unitsPerFloor: 3 },
        ],
      }),
      block({ name: "Block B", floors: [{ level: 0, unitsPerFloor: 1 }] }),
    ]);

    expect(summary.blocks).toBe(2);
    expect(summary.floors).toBe(3);
    expect(summary.units).toBe(6);
  });

  it("counts a floor with zero units toward floors but not units", () => {
    const summary = summarizeStructure([
      block({
        floors: [
          { level: 0, unitsPerFloor: 0 },
          { level: 1, unitsPerFloor: 4 },
        ],
      }),
    ]);

    expect(summary.floors).toBe(2);
    expect(summary.units).toBe(4);
  });

  it("uses the property rent when no override is set", () => {
    const summary = summarizeStructure(
      [block({ floors: [{ level: 0, unitsPerFloor: 3 }] })],
      10000,
    );

    expect(summary.monthlyRent).toBe(30000);
    expect(summary.minRent).toBe(10000);
    expect(summary.maxRent).toBe(10000);
  });

  it("prefers the floor override, then the block override, then the property rent", () => {
    const summary = summarizeStructure(
      [
        block({
          rentOverride: 20000,
          floors: [
            { level: 0, unitsPerFloor: 1, rentOverride: 50000 },
            { level: 1, unitsPerFloor: 1 },
          ],
        }),
        block({ name: "Block B", floors: [{ level: 0, unitsPerFloor: 1 }] }),
      ],
      10000,
    );

    // floor override 50000 + block override 20000 + property 10000
    expect(summary.monthlyRent).toBe(80000);
    expect(summary.minRent).toBe(10000);
    expect(summary.maxRent).toBe(50000);
  });

  it("returns zero rent and range when there are no units", () => {
    const summary = summarizeStructure([block()], 15000);

    expect(summary.blocks).toBe(1);
    expect(summary.floors).toBe(1);
    expect(summary.units).toBe(0);
    expect(summary.monthlyRent).toBe(0);
    expect(summary.minRent).toBe(0);
    expect(summary.maxRent).toBe(0);
  });

  it("handles an empty structure", () => {
    expect(summarizeStructure([])).toEqual({
      blocks: 0,
      floors: 0,
      units: 0,
      monthlyRent: 0,
      minRent: 0,
      maxRent: 0,
    });
  });
});

describe("PropertyStructurePreview", () => {
  it("prompts to edit when there are no blocks", () => {
    render(<PropertyStructurePreview blocks={[]} />);
    expect(screen.getByText(/No blocks yet/)).toBeInTheDocument();
  });

  it("lists blocks, floors and generated unit names", () => {
    render(
      <PropertyStructurePreview
        blocks={[
          block({
            name: "Block A",
            rentOverride: 25000,
            floors: [{ level: 0, label: "Ground", unitsPerFloor: 2 }],
          }),
        ]}
      />,
    );

    expect(screen.getByText("Block A")).toBeInTheDocument();
    expect(screen.getByText(/Rent Ksh 25,000/)).toBeInTheDocument();
    expect(screen.getByText(/2 units · GA, GB/)).toBeInTheDocument();
  });
});

describe("PropertyStructureEditor", () => {
  it("labels the floor input as Floor rather than Level", () => {
    render(
      <PropertyStructureEditor
        blocks={[block({ floors: [{ level: 0, unitsPerFloor: 1 }] })]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("Floor")).toBeInTheDocument();
    expect(screen.queryByLabelText("Level")).not.toBeInTheDocument();
  });
});

describe("PropertyStructureEditor — duplex / simplex enforcement", () => {
  const twoFloors = (floor3: Partial<BlockInputPayload["floors"][number]> = {}) =>
    block({
      floors: [
        { level: 3, unitsPerFloor: 2, ...floor3 },
        { level: 4, unitsPerFloor: 2 },
      ],
    });

  it("toggles a single unit to duplex via a per-unit override", () => {
    const onChange = vi.fn();
    render(<PropertyStructureEditor blocks={[twoFloors()]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "3A: simplex" }));

    const next = onChange.mock.calls[0][0] as BlockInputPayload[];
    expect(next[0].floors[0].unitDuplex).toEqual([true]);
  });

  it("shows mixed duplex and simplex names on one floor", () => {
    render(
      <PropertyStructureEditor
        blocks={[twoFloors({ unitDuplex: [true, false] })]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "3A-4A: duplex" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "3B: simplex" })).toBeInTheDocument();
  });

  it("does not offer per-unit duplex on the top floor", () => {
    render(<PropertyStructureEditor blocks={[twoFloors()]} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "4A: simplex" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Duplex floor 4" })).toBeDisabled();
  });

  it("offers the upper-floor setting only when a floor has duplexes", () => {
    const { rerender } = render(
      <PropertyStructureEditor blocks={[twoFloors()]} onChange={() => {}} />,
    );
    expect(screen.queryByText(/Floor above these/)).not.toBeInTheDocument();
    rerender(
      <PropertyStructureEditor blocks={[twoFloors({ duplex: true })]} onChange={() => {}} />,
    );
    expect(screen.getByText("Floor above these 2 duplex unit(s)")).toBeInTheDocument();
  });

  it("counts consumed slots and blocks an invalid consume layout", () => {
    const consume = twoFloors({ duplex: true, upperFloorMode: "consume" });
    expect(summarizeStructure([consume]).units).toBe(2); // 2 duplexes + 0 own above
    expect(validateBlocks([consume])).toEqual([]);

    const tooFew = block({
      floors: [
        { level: 3, unitsPerFloor: 2, duplex: true, upperFloorMode: "consume" },
        { level: 4, unitsPerFloor: 1 },
      ],
    });
    expect(validateBlocks([tooFew])[0]).toMatch(/1 unit slot\(s\) but 2 duplex/);
  });

  it("blocks saving a top floor marked duplex and offers a fix", () => {
    const onChange = vi.fn();
    const stuck = block({ floors: [{ level: 1, unitsPerFloor: 1, duplex: true }] });
    expect(validateBlocks([stuck])[0]).toMatch(/no floor above/);

    render(<PropertyStructureEditor blocks={[stuck]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Make all simplex" }));
    const next = onChange.mock.calls[0][0] as BlockInputPayload[];
    expect(next[0].floors[0]).toMatchObject({ duplex: false, unitDuplex: [] });
  });

  it("flags duplicate unit names across floors of one block", () => {
    const dup = block({
      floors: [
        { level: 1, unitsPerFloor: 1, unitNames: ["Shop"] },
        { level: 2, unitsPerFloor: 1, unitNames: ["Shop"] },
      ],
    });
    expect(validateBlocks([dup])).toContain('Duplicate unit name "Shop" in Block A.');
  });
});

describe("BulkGenerateDialog — append only", () => {
  it("adds a new block next to existing ones and never replaces them", () => {
    const onChange = vi.fn();
    const existing = block({ floors: [{ level: 0, unitsPerFloor: 2 }] });
    render(
      <BulkGenerateDialog open onOpenChange={() => {}} blocks={[existing]} onChange={onChange} />,
    );

    expect(screen.getByLabelText("Block name")).toHaveValue("Block B");
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));

    const next = onChange.mock.calls[0][0] as BlockInputPayload[];
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(existing);
    expect(next[1].name).toBe("Block B");
  });

  it("refuses a block name that already exists", () => {
    const onChange = vi.fn();
    render(
      <BulkGenerateDialog open onOpenChange={() => {}} blocks={[block()]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Block name"), { target: { value: "block a" } });
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
  });

  it("names the next free block letter", () => {
    expect(nextBlockName([block({ name: "Block A" }), block({ name: "Block B" })])).toBe("Block C");
    expect(nextBlockName([])).toBe("Block A");
  });
});
