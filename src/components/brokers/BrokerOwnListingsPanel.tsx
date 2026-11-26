"use client";

import { FileText, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge, type StatusTone } from "@/components/common/StatusBadge";
import { Money } from "@/components/money/Money";
import { MoneyInput, type MoneyValue } from "@/components/money/MoneyInput";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/hooks/use-maintenance";
import { formatDate } from "@/lib/format";
import { useUploadThing } from "@/lib/uploadthing";
import type { BrokerListingView } from "@/types/brokers";

const STATUS: Record<BrokerListingView["status"], { tone: StatusTone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  submitted: { tone: "warning", label: "Waiting for approval" },
  approved: { tone: "success", label: "Live" },
  rejected: { tone: "danger", label: "Rejected" },
  expired: { tone: "muted", label: "Expired" },
  withdrawn: { tone: "muted", label: "Withdrawn" },
};

interface FormState {
  purpose: "rent" | "sale";
  title: string;
  description: string;
  propertyType: string;
  county: string;
  area: string;
  price: MoneyValue;
  serviceCharge: MoneyValue;
  depositMonths: number;
  bedrooms: number;
  bathrooms: number;
  sizeSqm: number;
  amenities: string;
  photos: { url: string; key: string }[];
  address: string;
  mandate: { url: string; key: string; name: string };
  ownerName: string;
  ownerPhone: string;
}

const EMPTY: FormState = {
  purpose: "rent",
  title: "",
  description: "",
  propertyType: "",
  county: "",
  area: "",
  price: { amount: "", currency: "KES" },
  serviceCharge: { amount: "", currency: "KES" },
  depositMonths: 1,
  bedrooms: 1,
  bathrooms: 1,
  sizeSqm: 0,
  amenities: "",
  photos: [],
  address: "",
  mandate: { url: "", key: "", name: "" },
  ownerName: "",
  ownerPhone: "",
};

function fromView(v: BrokerListingView): FormState {
  return {
    purpose: v.purpose,
    title: v.title,
    description: v.description,
    propertyType: v.propertyType,
    county: v.county,
    area: v.area,
    price: { amount: v.price, currency: "KES" },
    serviceCharge: { amount: v.serviceCharge || "", currency: "KES" },
    depositMonths: v.depositMonths,
    bedrooms: v.bedrooms,
    bathrooms: v.bathrooms,
    sizeSqm: v.sizeSqm,
    amenities: v.amenities.join(", "),
    photos: v.photos.map((p) => ({ url: p.url, key: p.key ?? "" })),
    address: v.exactLocation?.address ?? "",
    mandate: {
      url: v.mandateDocument?.url ?? "",
      key: v.mandateDocument?.key ?? "",
      name: v.mandateDocument?.name ?? "",
    },
    ownerName: v.ownerContact?.name ?? "",
    ownerPhone: v.ownerContact?.phone ?? "",
  };
}

function payload(f: FormState) {
  return {
    purpose: f.purpose,
    title: f.title.trim(),
    description: f.description.trim(),
    propertyType: f.propertyType.trim(),
    county: f.county.trim(),
    area: f.area.trim(),
    price: Number(f.price.amount || 0),
    serviceCharge: f.purpose === "rent" ? Number(f.serviceCharge.amount || 0) : 0,
    depositMonths: f.purpose === "rent" ? f.depositMonths : 0,
    bedrooms: f.bedrooms,
    bathrooms: f.bathrooms,
    sizeSqm: f.sizeSqm,
    amenities: f.amenities
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    photos: f.photos,
    exactLocation: { address: f.address.trim(), latitude: null, longitude: null },
    mandateDocument: f.mandate,
    ownerContact: { name: f.ownerName.trim(), phone: f.ownerPhone.trim() },
  };
}

/** Defined at module level so fields keep focus while typing. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-2xl border border-border p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function ListingForm({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: BrokerListingView | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const mandateInput = useRef<HTMLInputElement>(null);
  const { startUpload, isUploading } = useUploadThing("brokerListingMedia", {
    onUploadError: (e) => {
      toast.error(e.message || "Upload failed");
    },
  });

  useEffect(() => {
    if (open) setForm(editing ? fromView(editing) : EMPTY);
  }, [open, editing]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const basicsMissing =
    form.title.trim().length < 3 ||
    form.county.trim().length < 2 ||
    form.area.trim().length < 2 ||
    !(Number(form.price.amount) > 0);

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = 20 - form.photos.length;
    const res = await startUpload(Array.from(files).slice(0, room));
    if (res) set("photos", [...form.photos, ...res.map((r) => ({ url: r.ufsUrl, key: r.key }))]);
    if (photoInput.current) photoInput.current.value = "";
  };
  const uploadMandate = async (files: FileList | null) => {
    if (!files?.length) return;
    const res = await startUpload([files[0]]);
    if (res?.[0]) set("mandate", { url: res[0].ufsUrl, key: res[0].key, name: res[0].name });
    if (mandateInput.current) mandateInput.current.value = "";
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = payload(form);
      const result = editing
        ? await apiRequest<BrokerListingView>(`/api/v1/broker-listings/${editing._id}`, {
            method: "PATCH",
            json: body,
          })
        : await apiRequest<BrokerListingView>("/api/v1/broker-listings", {
            method: "POST",
            json: body,
          });
      toast.success(
        editing && editing.status !== "draft" && editing.status !== "rejected"
          ? "Saved. Submit it again for approval."
          : "Saved as a draft",
      );
      void result;
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4 text-left">
          <SheetTitle>{editing ? "Edit property" : "List a property"}</SheetTitle>
          <SheetDescription>
            For properties you market that are not managed on the platform. The platform team checks
            every listing before it goes live.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {editing && (editing.status === "approved" || editing.status === "submitted") ? (
            <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              Saving changes takes this listing off the marketplace until it is approved again.
            </p>
          ) : null}
          <Section title="Basics">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Listed for</Label>
                <Select
                  value={form.purpose}
                  onValueChange={(v) => set("purpose", v as FormState["purpose"])}
                >
                  <SelectTrigger aria-label="Listed for">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rent">Rent</SelectItem>
                    <SelectItem value="sale">Sale</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-type">Property type</Label>
                <Input
                  id="bl-type"
                  value={form.propertyType}
                  maxLength={60}
                  placeholder="Apartment, house…"
                  onChange={(e) => set("propertyType", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bl-title">Title</Label>
              <Input
                id="bl-title"
                value={form.title}
                maxLength={160}
                placeholder="e.g. 2-bedroom apartment in Kilimani"
                onChange={(e) => set("title", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bl-desc">Description</Label>
              <Textarea
                id="bl-desc"
                rows={4}
                maxLength={5000}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bl-beds">Bedrooms</Label>
                <Input
                  id="bl-beds"
                  type="number"
                  min={0}
                  value={form.bedrooms}
                  onChange={(e) => set("bedrooms", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-baths">Bathrooms</Label>
                <Input
                  id="bl-baths"
                  type="number"
                  min={0}
                  value={form.bathrooms}
                  onChange={(e) => set("bathrooms", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-size">Size (m²)</Label>
                <Input
                  id="bl-size"
                  type="number"
                  min={0}
                  value={form.sizeSqm}
                  onChange={(e) => set("sizeSqm", Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bl-amen">Amenities</Label>
              <Input
                id="bl-amen"
                value={form.amenities}
                placeholder="Parking, borehole, lift"
                onChange={(e) => set("amenities", e.target.value)}
              />
            </div>
          </Section>

          <Section title="Price">
            <MoneyInput
              label={form.purpose === "rent" ? "Rent per month" : "Asking price"}
              value={form.price}
              currencies={["KES"]}
              onChange={(v) => set("price", v)}
            />
            {form.purpose === "rent" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyInput
                  label="Service charge"
                  value={form.serviceCharge}
                  currencies={["KES"]}
                  onChange={(v) => set("serviceCharge", v)}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="bl-dep">Deposit (months)</Label>
                  <Input
                    id="bl-dep"
                    type="number"
                    min={0}
                    max={24}
                    value={form.depositMonths}
                    onChange={(e) => set("depositMonths", Number(e.target.value))}
                  />
                </div>
              </div>
            ) : null}
          </Section>

          <Section title="Location">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bl-county">County</Label>
                <Input
                  id="bl-county"
                  value={form.county}
                  maxLength={80}
                  placeholder="Nairobi"
                  onChange={(e) => set("county", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-area">Area / estate</Label>
                <Input
                  id="bl-area"
                  value={form.area}
                  maxLength={120}
                  placeholder="Kilimani"
                  onChange={(e) => set("area", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bl-addr">Exact address (private)</Label>
              <Input
                id="bl-addr"
                value={form.address}
                maxLength={300}
                placeholder="Building, road, plot number"
                onChange={(e) => set("address", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Only the platform team sees this. Visitors see the area only.
              </p>
            </div>
          </Section>

          <Section title={`Photos (${form.photos.length}) — at least 3`}>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Add photos"
              onChange={(e) => void uploadPhotos(e.target.files)}
            />
            <ul className="grid grid-cols-3 gap-2">
              {form.photos.map((p) => (
                <li
                  key={p.url}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-border"
                >
                  {/* biome-ignore lint/performance/noImgElement: uploaded listing photos */}
                  <img src={p.url} alt="Listing" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-destructive"
                    onClick={() =>
                      set(
                        "photos",
                        form.photos.filter((x) => x.url !== p.url),
                      )
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={isUploading || form.photos.length >= 20}
              onClick={() => photoInput.current?.click()}
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Add photos
            </Button>
          </Section>

          <Section title="Proof for the platform team (private)">
            <div className="space-y-1.5">
              <Label>Owner's mandate letter (PDF)</Label>
              <input
                ref={mandateInput}
                type="file"
                accept="application/pdf"
                className="sr-only"
                aria-label="Upload mandate letter"
                onChange={(e) => void uploadMandate(e.target.files)}
              />
              {form.mandate.url ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                  <a
                    href={form.mandate.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 truncate text-primary"
                  >
                    <FileText className="h-4 w-4" /> {form.mandate.name || "Mandate letter"}
                  </a>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => set("mandate", { url: "", key: "", name: "" })}
                  >
                    Replace
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  disabled={isUploading}
                  onClick={() => mandateInput.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" /> Upload letter
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bl-owner">Owner's name</Label>
                <Input
                  id="bl-owner"
                  value={form.ownerName}
                  maxLength={120}
                  onChange={(e) => set("ownerName", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-owner-phone">Owner's phone</Label>
                <Input
                  id="bl-owner-phone"
                  type="tel"
                  value={form.ownerPhone}
                  maxLength={32}
                  placeholder="+2547…"
                  onChange={(e) => set("ownerPhone", e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The platform team may call the owner to confirm before approving.
            </p>
          </Section>
        </div>
        <SheetFooter className="gap-2 border-t border-border px-6 py-4">
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
            disabled={saving || isUploading || basicsMissing}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The broker's own properties: drafts, review status, live period, renew and withdraw. */
export function BrokerOwnListingsPanel() {
  const [rows, setRows] = useState<BrokerListingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<BrokerListingView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<BrokerListingView | null>(null);
  const refetch = () => setTick((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    void tick;
    apiRequest<BrokerListingView[]>("/api/v1/broker-listings")
      .then((d) => !cancelled && setRows(d))
      .catch(() => !cancelled && setRows([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const act = async (row: BrokerListingView, action: "submit" | "renew") => {
    setBusy(`${row._id}:${action}`);
    try {
      await apiRequest(`/api/v1/broker-listings/${row._id}/${action}`, { method: "POST" });
      toast.success(
        action === "submit" ? "Sent to the platform team for approval" : "Renewed for 60 days",
      );
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

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
          <Plus className="mr-1.5 h-4 w-4" /> List a property
        </Button>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No properties of your own yet"
          description="List properties you market that aren't managed on the platform."
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map((row) => {
            const s = STATUS[row.status];
            return (
              <li
                key={row._id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{row.title}</p>
                    <p className="text-xs text-muted-foreground">
                      For {row.purpose} · {row.area}, {row.county}
                    </p>
                  </div>
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                </div>
                <Money amount={row.price} className="font-semibold" />
                {row.status === "approved" && row.expiresAt ? (
                  <p className="text-xs text-muted-foreground">
                    Live until {formatDate(row.expiresAt)}
                  </p>
                ) : null}
                {row.status === "rejected" && row.reviewNote ? (
                  <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                    Not approved: {row.reviewNote}
                  </p>
                ) : null}
                {(row.status === "draft" || row.status === "rejected") &&
                row.submissionProblems.length > 0 ? (
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {row.submissionProblems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-auto flex flex-wrap gap-2">
                  {row.status !== "withdrawn" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        setEditing(row);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                  ) : null}
                  {row.status === "draft" || row.status === "rejected" ? (
                    <Button
                      size="sm"
                      className="rounded-full"
                      disabled={busy !== null || row.submissionProblems.length > 0}
                      title={row.submissionProblems[0]}
                      onClick={() => void act(row, "submit")}
                    >
                      {busy === `${row._id}:submit` ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Submit for approval
                    </Button>
                  ) : null}
                  {row.status === "approved" || row.status === "expired" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={busy !== null}
                      onClick={() => void act(row, "renew")}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Renew
                    </Button>
                  ) : null}
                  {row.status !== "withdrawn" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-destructive"
                      onClick={() => setWithdrawing(row)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Withdraw
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ListingForm open={formOpen} editing={editing} onOpenChange={setFormOpen} onSaved={refetch} />
      <AlertDialog open={Boolean(withdrawing)} onOpenChange={(o) => !o && setWithdrawing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw “{withdrawing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off the marketplace. You can't relist it; create a new listing instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!withdrawing) return;
                try {
                  await apiRequest(`/api/v1/broker-listings/${withdrawing._id}`, {
                    method: "DELETE",
                  });
                  toast.success("Withdrawn");
                  refetch();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not withdraw");
                } finally {
                  setWithdrawing(null);
                }
              }}
            >
              Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
