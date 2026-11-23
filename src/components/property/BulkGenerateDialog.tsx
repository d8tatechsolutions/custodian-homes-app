"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { BlockInputPayload } from "@/hooks/use-properties";
import { generateBulkStructure, validateBulkGeneration } from "@/lib/bulk-structure";
import {
  UPPER_FLOOR_MODE_LABELS,
  UPPER_FLOOR_MODES,
  type UpperFloorMode,
} from "@/lib/duplex-layout";
import { countPreviewUnits } from "@/lib/structure-preview";

const bulkSchema = z.object({
  blockName: z.string().trim().min(1, "Block name is required").max(80),
  floors: z.coerce.number().int().min(0).max(200),
  unitsPerFloor: z.coerce.number().int().min(0).max(200),
  includeGroundFloor: z.boolean(),
  startLevel: z.coerce.number().int().min(-5).max(200),
  duplex: z.boolean(),
  upperFloorMode: z.enum(UPPER_FLOOR_MODES),
  rentOverride: z.string().optional(),
});

type BulkForm = z.infer<typeof bulkSchema>;

interface BulkGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: BlockInputPayload[];
  onChange: (blocks: BlockInputPayload[]) => void;
  disabled?: boolean;
}

/** First "Block X" name not already used on the property. */
export function nextBlockName(blocks: BlockInputPayload[]): string {
  const used = new Set(blocks.map((block) => block.name.trim().toLowerCase()));
  for (let i = 0; i < 26 * 27; i += 1) {
    const letter =
      i < 26
        ? String.fromCharCode(65 + i)
        : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
    const candidate = `Block ${letter}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `Block ${blocks.length + 1}`;
}

export function BulkGenerateDialog({
  open,
  onOpenChange,
  blocks,
  onChange,
  disabled = false,
}: BulkGenerateDialogProps) {
  const [form, setForm] = useState<BulkForm>({
    blockName: nextBlockName(blocks),
    floors: 3,
    unitsPerFloor: 4,
    includeGroundFloor: true,
    startLevel: 1,
    duplex: false,
    upperFloorMode: "keep",
    rentOverride: "",
  });
  const [errors, setErrors] = useState<string[]>([]);

  // Each time the dialog opens, suggest a block name that is not taken yet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on open
  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, blockName: nextBlockName(blocks) }));
    setErrors([]);
  }, [open]);

  const handleGenerate = () => {
    const parsed = bulkSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    const rentOverride =
      form.rentOverride && form.rentOverride.trim() !== "" ? Number(form.rentOverride) : null;

    const spec = {
      name: form.blockName,
      duplex: form.duplex,
      rentOverride,
      floors: {
        floorCount: form.floors,
        unitsPerFloor: form.unitsPerFloor,
        includeGroundFloor: form.includeGroundFloor,
        startLevel: form.startLevel,
        floorRentOverride: rentOverride,
        duplex: form.duplex,
        upperFloorMode: form.duplex ? form.upperFloorMode : "keep",
      },
    };

    // Bulk generate only ever ADDS a block: existing blocks, floors, units and
    // unit names are never replaced or renamed.
    const validationErrors = validateBulkGeneration({
      blocks: [spec],
      existingUnitCount: blocks.reduce((sum, block) => sum + countPreviewUnits(block), 0),
      existingBlockNames: blocks.map((block) => block.name),
    });
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    try {
      const generated = generateBulkStructure({ blocks: [spec], mode: "append" });
      onChange([...blocks, ...generated]);
      setErrors([]);
      onOpenChange(false);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Generation failed"]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk generate structure</DialogTitle>
          <DialogDescription>
            Adds a new block with floors and units. Existing blocks and units are never replaced.
            Review before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="bulk-block-name">Block name</Label>
            <Input
              id="bulk-block-name"
              value={form.blockName}
              disabled={disabled}
              onChange={(e) => setForm((f) => ({ ...f, blockName: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bulk-floors">Floors to generate</Label>
              <Input
                id="bulk-floors"
                type="number"
                min={0}
                max={200}
                disabled={disabled}
                value={form.floors}
                onChange={(e) => setForm((f) => ({ ...f, floors: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-units">Units per floor</Label>
              <Input
                id="bulk-units"
                type="number"
                min={0}
                max={200}
                disabled={disabled}
                value={form.unitsPerFloor}
                onChange={(e) => setForm((f) => ({ ...f, unitsPerFloor: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="bulk-ground"
              checked={form.includeGroundFloor}
              disabled={disabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, includeGroundFloor: Boolean(v) }))}
            />
            <Label htmlFor="bulk-ground">Include ground floor</Label>
          </div>

          {!form.includeGroundFloor && (
            <div className="space-y-1">
              <Label htmlFor="bulk-start">Starting floor level</Label>
              <Input
                id="bulk-start"
                type="number"
                min={-5}
                max={200}
                disabled={disabled}
                value={form.startLevel}
                onChange={(e) => setForm((f) => ({ ...f, startLevel: Number(e.target.value) }))}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id="bulk-duplex"
              checked={form.duplex}
              disabled={disabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, duplex: Boolean(v) }))}
            />
            <Label htmlFor="bulk-duplex">Duplex (units span 2 floors)</Label>
          </div>

          {form.duplex && (
            <div className="space-y-1">
              <Label htmlFor="bulk-upper-mode">Floor above each duplex</Label>
              <Select
                value={form.upperFloorMode}
                disabled={disabled}
                onValueChange={(val) =>
                  setForm((f) => ({ ...f, upperFloorMode: val as UpperFloorMode }))
                }
              >
                <SelectTrigger id="bulk-upper-mode" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UPPER_FLOOR_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {UPPER_FLOOR_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="bulk-rent">Rent override (optional)</Label>
            <Input
              id="bulk-rent"
              type="number"
              min={0}
              disabled={disabled}
              placeholder="Inherit from property"
              value={form.rentOverride ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, rentOverride: e.target.value }))}
            />
          </div>

          {errors.length > 0 && (
            <ul className="list-inside list-disc text-xs text-destructive">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={disabled}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={disabled}>
            Add block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
