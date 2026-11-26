"use client";

import { Loader2, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type DataColumn, DataTable } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { TitleCell } from "@/components/common/TitleCell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, useVendors } from "@/hooks/use-maintenance";
import { useProperties } from "@/hooks/use-properties";
import type { VendorRecord } from "@/types/maintenance";

interface VendorForm {
  name: string;
  phone: string;
  email: string;
  trades: string;
  kind: "external" | "staff";
  propertyIds: string[];
  notes: string;
  isActive: boolean;
}

const EMPTY: VendorForm = {
  name: "",
  phone: "",
  email: "",
  trades: "",
  kind: "external",
  propertyIds: [],
  notes: "",
  isActive: true,
};

function VendorDialog({
  open,
  vendor,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  vendor: VendorRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { properties } = useProperties();
  const [form, setForm] = useState<VendorForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      vendor
        ? {
            name: vendor.name,
            phone: vendor.phone,
            email: vendor.email ?? "",
            trades: vendor.trades.join(", "),
            kind: vendor.kind,
            propertyIds: vendor.propertyIds,
            notes: vendor.notes ?? "",
            isActive: vendor.isActive,
          }
        : EMPTY,
    );
  }, [open, vendor]);

  const set = <K extends keyof VendorForm>(key: K, value: VendorForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const emailInvalid = form.email.trim() !== "" && !/^\S+@\S+\.\S+$/.test(form.email.trim());
  const problem =
    (!form.name.trim() && "Enter a name") ||
    (form.phone.trim().length < 6 && "Enter a phone number") ||
    (emailInvalid && "Check the email address");

  const save = async () => {
    if (problem) return;
    setSaving(true);
    const body = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      trades: form.trades
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10),
      kind: form.kind,
      propertyIds: form.propertyIds,
      notes: form.notes.trim(),
      isActive: form.isActive,
    };
    try {
      if (vendor)
        await apiRequest(`/api/v1/vendors/${vendor._id}`, { method: "PATCH", json: body });
      else await apiRequest("/api/v1/vendors", { method: "POST", json: body });
      toast.success(vendor ? "Service provider updated" : "Service provider added");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the service provider");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{vendor ? "Edit service provider" : "Add service provider"}</DialogTitle>
          <DialogDescription>
            Service providers don't log in. They are told about a job by email once its cost is approved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="v-name">Name</Label>
              <Input
                id="v-name"
                value={form.name}
                maxLength={120}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.kind} onValueChange={(v) => set("kind", v as VendorForm["kind"])}>
                <SelectTrigger aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="external">Outside company / fundi</SelectItem>
                  <SelectItem value="staff">Own worker</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-phone">Phone</Label>
              <Input
                id="v-phone"
                type="tel"
                value={form.phone}
                maxLength={32}
                placeholder="+254…"
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-email">Email (optional)</Label>
              <Input
                id="v-email"
                type="email"
                value={form.email}
                maxLength={200}
                aria-invalid={emailInvalid || undefined}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-trades">Trades / skills</Label>
            <Input
              id="v-trades"
              value={form.trades}
              placeholder="Plumbing, Electrical"
              onChange={(e) => set("trades", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Separate with commas.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Serves these properties</legend>
            {properties.length === 0 ? (
              <p className="text-sm text-muted-foreground">No properties yet.</p>
            ) : (
              <div className="grid max-h-40 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
                {properties.map((p) => (
                  <Label key={p._id} className="flex cursor-pointer items-center gap-2 font-normal">
                    <Checkbox
                      checked={form.propertyIds.includes(p._id)}
                      onChange={(e) =>
                        set(
                          "propertyIds",
                          e.target.checked
                            ? [...form.propertyIds, p._id]
                            : form.propertyIds.filter((id) => id !== p._id),
                        )
                      }
                    />
                    <span className="truncate">{p.title}</span>
                  </Label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Only properties ticked here can assign this service provider.
            </p>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="v-notes">Notes</Label>
            <Textarea
              id="v-notes"
              rows={2}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
          <Label className="flex items-center justify-between gap-3 font-normal">
            <span>Active (can be assigned work)</span>
            <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
          </Label>
        </div>
        <DialogFooter className="gap-2 sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{problem || ""}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={saving || Boolean(problem)}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The owner's list of service providers (vendors). */
export function VendorsPanel() {
  const { vendors, loading, error, refetch } = useVendors();
  const { properties } = useProperties();
  const [editing, setEditing] = useState<VendorRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<VendorRecord | null>(null);
  const titleOf = (id: string) => properties.find((p) => p._id === id)?.title ?? "";

  const columns: DataColumn<VendorRecord>[] = [
    {
      key: "name",
      header: "Service provider",
      sortValue: (v) => v.name.toLowerCase(),
      cell: (v) => (
        <TitleCell
          detail={{
            title: v.name,
            subtitle: v.kind === "staff" ? "Own worker" : "Outside company / fundi",
            fields: [
              {
                label: "Phone",
                value: (
                  <a href={`tel:${v.phone}`} className="text-primary">
                    {v.phone}
                  </a>
                ),
              },
              { label: "Email", value: v.email ?? "" },
              { label: "Trades", value: v.trades.join(", ") },
              { label: "Properties", value: v.propertyIds.map(titleOf).filter(Boolean).join(", ") },
              { label: "Notes", value: v.notes ?? "" },
            ],
          }}
        >
          {v.name}
        </TitleCell>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      cell: (v) => (
        <a
          href={`tel:${v.phone}`}
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          <Phone className="h-3.5 w-3.5" />
          {v.phone}
        </a>
      ),
    },
    { key: "trades", header: "Trades", cell: (v) => v.trades.join(", ") || "—" },
    {
      key: "properties",
      header: "Properties",
      sortValue: (v) => v.propertyIds.length,
      cell: (v) =>
        v.propertyIds.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          `${v.propertyIds.length}`
        ),
    },
    {
      key: "active",
      header: "State",
      cell: (v) =>
        v.isActive ? (
          <StatusBadge tone="success">Active</StatusBadge>
        ) : (
          <StatusBadge tone="muted">Inactive</StatusBadge>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="rounded-full"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add service provider
        </Button>
      </div>
      <DataTable
        rows={vendors}
        columns={columns}
        getRowId={(v) => v._id}
        loading={loading}
        error={error}
        caption="Service providers"
        emptyTitle="No service providers yet"
        emptyDescription="Add the plumbers, electricians and other fundis you work with, and pick which properties they serve."
        rowActions={(v) => (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${v.name}`}
              onClick={() => {
                setEditing(v);
                setFormOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              aria-label={`Remove ${v.name}`}
              onClick={() => setDeleting(v)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      />
      <VendorDialog open={formOpen} vendor={editing} onOpenChange={setFormOpen} onSaved={refetch} />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Past tasks keep their history. A service provider with open tasks can't be removed — reassign
              them first, or mark them inactive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await apiRequest(`/api/v1/vendors/${deleting._id}`, { method: "DELETE" });
                  toast.success("Service provider removed");
                  refetch();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not remove the service provider");
                } finally {
                  setDeleting(null);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
