"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssignees } from "@/hooks/use-maintenance";
import { roleLabel } from "@/lib/role-labels";

export type AssigneeChoice =
  | { kind: "staff"; userId: string }
  | { kind: "vendor"; vendorId: string }
  | null;

const NONE = "__none__";

export function encodeAssignee(choice: AssigneeChoice): string {
  if (!choice) return NONE;
  return choice.kind === "staff" ? `staff:${choice.userId}` : `vendor:${choice.vendorId}`;
}

function decode(value: string): AssigneeChoice {
  if (value.startsWith("staff:")) return { kind: "staff", userId: value.slice(6) };
  if (value.startsWith("vendor:")) return { kind: "vendor", vendorId: value.slice(7) };
  return null;
}

interface AssigneeSelectProps {
  propertyId: string;
  value: AssigneeChoice;
  onChange: (value: AssigneeChoice) => void;
  disabled?: boolean;
  /** Caretakers can only pick themselves; the list already reflects that. */
  allowUnassigned?: boolean;
  label?: string;
}

/** Staff and vendors who can take work on the property, grouped for clarity. */
export function AssigneeSelect({
  propertyId,
  value,
  onChange,
  disabled,
  allowUnassigned = true,
  label = "Assign to",
}: AssigneeSelectProps) {
  const { assignees, loading } = useAssignees(propertyId || null);
  const empty = assignees.staff.length === 0 && assignees.vendors.length === 0;

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select
        value={encodeAssignee(value)}
        disabled={disabled || !propertyId || loading}
        onValueChange={(v) => onChange(decode(v))}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue
            placeholder={propertyId ? (loading ? "Loading…" : "Choose") : "Pick a property first"}
          />
        </SelectTrigger>
        <SelectContent>
          {allowUnassigned ? <SelectItem value={NONE}>Unassigned</SelectItem> : null}
          {assignees.staff.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Staff</SelectLabel>
              {assignees.staff.map((s) => (
                <SelectItem key={s.id} value={`staff:${s.id}`}>
                  {s.name} · {roleLabel(s.role, s.staffTitle)}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          {assignees.vendors.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Service providers</SelectLabel>
              {assignees.vendors.map((v) => (
                <SelectItem key={v.id} value={`vendor:${v.id}`}>
                  {v.name}
                  {v.trades.length ? ` · ${v.trades.join(", ")}` : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          {empty && !loading ? (
            <SelectItem value="__empty__" disabled>
              No staff or service providers on this property yet
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
