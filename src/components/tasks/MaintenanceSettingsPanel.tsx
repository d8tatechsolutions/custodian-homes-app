"use client";

import { Loader2, Plus, Tag, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MoneyInput, type MoneyValue } from "@/components/money/MoneyInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { apiRequest, usePropertyOperations, useTaskCategories } from "@/hooks/use-maintenance";
import { useProperties } from "@/hooks/use-properties";
import type { CommonArea, PropertyOperationsSettings } from "@/types/maintenance";

function PropertySettings({ propertyId }: { propertyId: string }) {
  const { operations, loading, refetch } = usePropertyOperations(propertyId);
  const [limitOn, setLimitOn] = useState(false);
  const [limit, setLimit] = useState<MoneyValue>({ amount: "", currency: "KES" });
  const [areas, setAreas] = useState<CommonArea[]>([]);
  const [newArea, setNewArea] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!operations) return;
    setLimitOn(operations.approvalThreshold !== null);
    setLimit({ amount: operations.approvalThreshold ?? "", currency: "KES" });
    setAreas(operations.commonAreas.filter((a) => a.isActive));
  }, [operations]);

  const addArea = () => {
    const name = newArea.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (areas.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      toast.error("That area is already listed");
      return;
    }
    setAreas((prev) => [...prev, { _id: "", name, isActive: true }]);
    setNewArea("");
  };

  const save = async () => {
    if (limitOn && !(typeof limit.amount === "number" && limit.amount >= 0)) {
      toast.error("Enter the approval limit");
      return;
    }
    setSaving(true);
    try {
      await apiRequest<PropertyOperationsSettings>(`/api/v1/properties/${propertyId}/operations`, {
        method: "PUT",
        json: {
          approvalThreshold: limitOn ? Number(limit.amount) : null,
          commonAreas: areas.map((a) => ({
            ...(a._id ? { _id: a._id } : {}),
            name: a.name,
            isActive: true,
          })),
        },
      });
      toast.success("Settings saved");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !operations) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Label className="flex items-center justify-between gap-3 font-normal">
          <span>
            <span className="block font-medium">Approval limit</span>
            <span className="block text-xs text-muted-foreground">
              {limitOn
                ? "Quotes above this amount wait for the owner's approval."
                : "No limit set: every quote waits for the owner's approval."}
            </span>
          </span>
          <Switch
            checked={limitOn}
            onCheckedChange={setLimitOn}
            aria-label="Use an approval limit"
          />
        </Label>
        {limitOn ? (
          <MoneyInput
            label="Approve automatically up to"
            value={limit}
            onChange={setLimit}
            currencies={["KES"]}
            className="sm:max-w-sm"
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <p className="font-medium">Common areas</p>
          <p className="text-xs text-muted-foreground">
            Places tasks can point to, such as the gate, lift or borehole.
          </p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {areas.map((a) => (
            <li
              key={a._id || a.name}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-1 pl-3 pr-1 text-sm"
            >
              {a.name}
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
                onClick={() => setAreas((prev) => prev.filter((x) => x !== a))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {areas.length === 0 ? <li className="text-sm text-muted-foreground">None yet.</li> : null}
        </ul>
        <div className="flex gap-2 sm:max-w-sm">
          <Input
            value={newArea}
            maxLength={80}
            placeholder="e.g. Main gate"
            aria-label="New common area"
            onChange={(e) => setNewArea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addArea();
              }
            }}
          />
          <Button type="button" variant="outline" className="rounded-full" onClick={addArea}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Removed areas stay on past tasks.</p>
      </section>

      <Button className="rounded-full" disabled={saving} onClick={() => void save()}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save settings
      </Button>
    </div>
  );
}

function CategoriesCard() {
  const { categories, refetch } = useTaskCategories();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiRequest("/api/v1/task-categories", { method: "POST", json: { name: name.trim() } });
      setName("");
      refetch();
      toast.success("Category added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the category");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiRequest(`/api/v1/task-categories/${id}`, { method: "DELETE" });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the category");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-4 w-4" /> Task categories
        </CardTitle>
        <CardDescription>
          The built-in list plus your own. Removing one keeps it on past tasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <li
              key={`${c.builtIn}-${c.name}`}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm"
            >
              {c.name}
              {c.builtIn ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  className="ml-1 rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={() => void remove(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2 sm:max-w-sm">
          <Input
            value={name}
            maxLength={60}
            placeholder="New category"
            aria-label="New category"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
          />
          <Button
            variant="outline"
            className="rounded-full"
            disabled={busy || !name.trim()}
            onClick={() => void add()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Admin-only maintenance settings: approval limit and common areas per property, and categories. */
export function MaintenanceSettingsPanel({ currentUserId }: { currentUserId: string }) {
  const { properties } = useProperties();
  // Only the property's own admin can change its settings (the API enforces it too).
  const own = properties.filter(
    (p) => String((p as { ownerId?: string }).ownerId ?? "") === currentUserId,
  );
  const [propertyId, setPropertyId] = useState("");
  useEffect(() => {
    if (!propertyId && own.length > 0) setPropertyId(own[0]._id);
  }, [own, propertyId]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Property settings</CardTitle>
          <CardDescription>
            Approval limit and common areas for each of your properties.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {own.length === 0 ? (
            <p className="text-sm text-muted-foreground">You don't own any properties yet.</p>
          ) : (
            <>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger aria-label="Property">
                  <SelectValue placeholder="Choose a property" />
                </SelectTrigger>
                <SelectContent>
                  {own.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {propertyId ? <PropertySettings key={propertyId} propertyId={propertyId} /> : null}
            </>
          )}
        </CardContent>
      </Card>
      <CategoriesCard />
    </div>
  );
}
