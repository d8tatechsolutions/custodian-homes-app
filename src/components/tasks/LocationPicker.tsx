"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePropertyOperations } from "@/hooks/use-maintenance";
import type { PropertyBlock } from "@/hooks/use-properties";
import { useUnits } from "@/hooks/use-units";
import type { TaskLocationKind } from "@/lib/maintenance/enums";

export interface LocationValue {
  kind: TaskLocationKind;
  blockId?: string;
  floorId?: string;
  unitId?: string;
  commonAreaId?: string;
}

const KIND_LABELS: Record<TaskLocationKind, string> = {
  property: "Whole property",
  block: "A block",
  floor: "A floor",
  unit: "A unit",
  common_area: "A common area",
};

function floorName(floor: { level: number; label?: string }) {
  return floor.label || (floor.level === 0 ? "Ground" : `Floor ${floor.level}`);
}

interface LocationPickerProps {
  propertyId: string;
  blocks: PropertyBlock[];
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  disabled?: boolean;
}

/** Where the work is: whole property, a block, a floor, a unit or a named common area. */
export function LocationPicker({
  propertyId,
  blocks,
  value,
  onChange,
  disabled,
}: LocationPickerProps) {
  const { units } = useUnits(value.kind === "unit" && propertyId ? { propertyId } : undefined, {
    enabled: value.kind === "unit" && Boolean(propertyId),
    fetchAll: true,
  });
  const { operations } = usePropertyOperations(
    value.kind === "common_area" && propertyId ? propertyId : null,
  );
  const block = blocks.find((b) => b._id === value.blockId);
  const commonAreas = (operations?.commonAreas ?? []).filter((a) => a.isActive);
  const sortedUnits = [...units].sort(
    (a, b) =>
      a.blockName.localeCompare(b.blockName) ||
      a.floorLevel - b.floorLevel ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Where</Label>
        <Select
          value={value.kind}
          disabled={disabled || !propertyId}
          onValueChange={(kind) => onChange({ kind: kind as TaskLocationKind })}
        >
          <SelectTrigger aria-label="Where">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABELS) as TaskLocationKind[]).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.kind === "block" || value.kind === "floor" ? (
        <div className="space-y-1.5">
          <Label>Block</Label>
          <Select
            value={value.blockId ?? ""}
            disabled={disabled}
            onValueChange={(blockId) => onChange({ kind: value.kind, blockId })}
          >
            <SelectTrigger aria-label="Block">
              <SelectValue placeholder={blocks.length ? "Choose a block" : "No blocks set up"} />
            </SelectTrigger>
            <SelectContent>
              {blocks.map((b) => (
                <SelectItem key={b._id} value={b._id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {value.kind === "floor" ? (
        <div className="space-y-1.5 sm:col-start-2">
          <Label>Floor</Label>
          <Select
            value={value.floorId ?? ""}
            disabled={disabled || !block}
            onValueChange={(floorId) => onChange({ ...value, floorId })}
          >
            <SelectTrigger aria-label="Floor">
              <SelectValue placeholder={block ? "Choose a floor" : "Choose a block first"} />
            </SelectTrigger>
            <SelectContent>
              {[...(block?.floors ?? [])]
                .sort((a, b) => a.level - b.level)
                .map((f) => (
                  <SelectItem key={f._id} value={f._id}>
                    {floorName(f)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {value.kind === "unit" ? (
        <div className="space-y-1.5">
          <Label>Unit</Label>
          <Select
            value={value.unitId ?? ""}
            disabled={disabled}
            onValueChange={(unitId) => onChange({ kind: "unit", unitId })}
          >
            <SelectTrigger aria-label="Unit">
              <SelectValue placeholder={sortedUnits.length ? "Choose a unit" : "No units found"} />
            </SelectTrigger>
            <SelectContent>
              {sortedUnits.map((u) => (
                <SelectItem key={u._id} value={u._id}>
                  {u.blockName} · {floorName({ level: u.floorLevel, label: u.floorLabel })} ·{" "}
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {value.kind === "common_area" ? (
        <div className="space-y-1.5">
          <Label>Common area</Label>
          <Select
            value={value.commonAreaId ?? ""}
            disabled={disabled}
            onValueChange={(commonAreaId) => onChange({ kind: "common_area", commonAreaId })}
          >
            <SelectTrigger aria-label="Common area">
              <SelectValue
                placeholder={
                  commonAreas.length
                    ? "Choose an area"
                    : "None yet — an admin adds them in Settings"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {commonAreas.map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

/** Whether the chosen location is complete enough to submit. */
export function isLocationComplete(value: LocationValue): boolean {
  switch (value.kind) {
    case "property":
      return true;
    case "block":
      return Boolean(value.blockId);
    case "floor":
      return Boolean(value.blockId && value.floorId);
    case "unit":
      return Boolean(value.unitId);
    case "common_area":
      return Boolean(value.commonAreaId);
  }
}
