"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useLeases } from "@/hooks/use-leases";
import { useProperties } from "@/hooks/use-properties";
import { useTenants } from "@/hooks/use-tenants";
import { formatKES, formatPeriod } from "@/lib/format";
import { computeDueDate, currentPeriod, PERIOD_REGEX, periodRange } from "@/lib/invoicing";
import type { InvoiceInput, InvoiceUpdate } from "@/lib/schemas";
import type { Invoice } from "@/types/invoicing";

type FormMode = "lease" | "manual";
/** `draft` saves a template; `new` issues immediately as Unpaid. */
type SaveAs = "draft" | "new";

interface FormState {
  mode: FormMode;
  leaseId: string;
  tenantId: string;
  propertyId: string;
  /** Billed month, `YYYY-MM`. */
  period: string;
  /** Due date, `YYYY-MM-DD`. */
  dueDate: string;
  /** True once the user changed the due date by hand (stop auto-following the month). */
  dueDateTouched: boolean;
  amountDue: string;
  serviceChargeAmount: string;
  saveAs: SaveAs;
  notes: string;
}

/** Default due date for a billed month as `YYYY-MM-DD` (5th of the next month). */
export function defaultDueDate(period: string): string {
  return computeDueDate(period).toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  const period = currentPeriod();
  return {
    mode: "lease",
    leaseId: "",
    tenantId: "",
    propertyId: "",
    period,
    dueDate: defaultDueDate(period),
    dueDateTouched: false,
    amountDue: "",
    serviceChargeAmount: "",
    saveAs: "draft",
    notes: "",
  };
}

interface FormErrors {
  leaseId?: string;
  tenantId?: string;
  propertyId?: string;
  period?: string;
  dueDate?: string;
  amountDue?: string;
  serviceChargeAmount?: string;
}

interface InvoiceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A draft being edited. Issued invoices are immutable and never passed here. */
  invoice?: Invoice | null;
  pending: boolean;
  onSubmit: (input: InvoiceInput | InvoiceUpdate, editing?: Invoice | null) => Promise<void>;
}

export const InvoiceFormDialog = ({
  open,
  onOpenChange,
  invoice,
  pending,
  onSubmit,
}: InvoiceFormDialogProps) => {
  const { leases } = useLeases();
  const { tenants } = useTenants();
  const { properties } = useProperties();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  const editing = invoice != null;
  const maxPeriod = currentPeriod();

  useEffect(() => {
    if (!open) return;
    if (editing && invoice) {
      setForm({
        mode: invoice.leaseId ? "lease" : "manual",
        leaseId: invoice.leaseId,
        tenantId: invoice.tenantId,
        propertyId: invoice.propertyId,
        period: invoice.period,
        dueDate: invoice.dueDate ? invoice.dueDate.slice(0, 10) : defaultDueDate(invoice.period),
        dueDateTouched: true,
        amountDue: String(invoice.amountDue),
        serviceChargeAmount: invoice.serviceChargeAmount ? String(invoice.serviceChargeAmount) : "",
        saveAs: "draft",
        notes: invoice.notes ?? "",
      });
    } else {
      setForm(emptyForm());
    }
    setFormErrors({});
  }, [editing, invoice, open]);

  const tenantNames = new Map(tenants.map((t) => [t._id, t.name]));
  const propertyTitles = new Map(properties.map((p) => [p._id, p.title]));

  const leaseLabel = (leaseId: string): string => {
    const lease = leases.find((l) => l._id === leaseId);
    if (!lease) return leaseId;
    const tenant = tenantNames.get(lease.tenantId) ?? lease.tenantId;
    const property = propertyTitles.get(lease.propertyId) ?? lease.propertyId;
    return `${tenant} · ${property} · ${formatKES(lease.rentAmount)}`;
  };

  const setPeriod = (period: string) =>
    setForm((f) => ({
      ...f,
      period,
      // The due date follows the billed month until the user sets it by hand.
      dueDate: !f.dueDateTouched && PERIOD_REGEX.test(period) ? defaultDueDate(period) : f.dueDate,
    }));

  // Manual invoices (and manual drafts) carry an explicit service-charge split.
  const isManual = editing ? !invoice?.leaseId : form.mode === "manual";
  const amountNumber = Number(form.amountDue);
  const serviceNumber = form.serviceChargeAmount === "" ? 0 : Number(form.serviceChargeAmount);
  const showSplit = isManual && form.amountDue !== "" && amountNumber > 0;

  const validate = (): boolean => {
    const next: FormErrors = {};
    if (!PERIOD_REGEX.test(form.period)) {
      next.period = "Choose the billed month";
    } else if (form.period > maxPeriod) {
      next.period = "Future months cannot be billed";
    }
    if (!form.dueDate) {
      next.dueDate = "Choose a due date";
    } else if (
      PERIOD_REGEX.test(form.period) &&
      new Date(`${form.dueDate}T00:00:00Z`).getTime() < periodRange(form.period).start.getTime()
    ) {
      next.dueDate = "Due date cannot be before the billed month";
    }
    if (!editing && form.mode === "lease") {
      if (!form.leaseId) next.leaseId = "Select a lease";
    }
    if (!editing && form.mode === "manual") {
      if (!form.tenantId) next.tenantId = "Select a tenant";
      if (!form.propertyId) next.propertyId = "Select a property";
    }
    if (isManual || editing) {
      if (form.amountDue === "" || !(amountNumber > 0)) {
        next.amountDue = "Enter a positive amount";
      }
    }
    if (isManual && form.serviceChargeAmount !== "") {
      if (!(serviceNumber >= 0)) {
        next.serviceChargeAmount = "Enter zero or a positive amount";
      } else if (amountNumber > 0 && serviceNumber > amountNumber) {
        next.serviceChargeAmount = "Service charge cannot exceed the amount due";
      }
    }
    setFormErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    const notes = form.notes.trim() || undefined;
    try {
      if (editing) {
        const update: InvoiceUpdate = {
          period: form.period,
          dueDate: form.dueDate,
          amountDue: amountNumber,
          notes,
        };
        if (isManual) update.serviceChargeAmount = serviceNumber;
        await onSubmit(update, invoice);
      } else if (form.mode === "lease") {
        await onSubmit({
          leaseId: form.leaseId,
          period: form.period,
          dueDate: form.dueDate,
          status: form.saveAs,
          notes,
        });
      } else {
        await onSubmit({
          tenantId: form.tenantId,
          propertyId: form.propertyId,
          amountDue: amountNumber,
          serviceChargeAmount: serviceNumber,
          period: form.period,
          dueDate: form.dueDate,
          status: form.saveAs,
          notes,
        });
      }
    } catch {
      // the parent has already surfaced the failure via toast
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit draft" : "Create invoice"}</DialogTitle>
          <DialogDescription>
            {editing
              ? `Edit this draft for ${invoice ? formatPeriod(invoice.period) : ""}. It gets its number when issued.`
              : "Save a draft template, or issue it now as Unpaid."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!editing && (
            <div className="space-y-2">
              <Label>Source</Label>
              <Select
                value={form.mode}
                onValueChange={(v) => setForm({ ...form, mode: v as FormMode })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lease">From lease (rent amount)</SelectItem>
                  <SelectItem value="manual">Manual (tenant + property)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!editing && form.mode === "lease" && (
            <div className="space-y-2">
              <Label>Lease</Label>
              <Select value={form.leaseId} onValueChange={(v) => setForm({ ...form, leaseId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an active lease" />
                </SelectTrigger>
                <SelectContent>
                  {leases
                    .filter((l) => l.status === "active")
                    .map((l) => (
                      <SelectItem key={l._id} value={l._id}>
                        {leaseLabel(l._id)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {formErrors.leaseId && (
                <p className="text-xs text-destructive">{formErrors.leaseId}</p>
              )}
            </div>
          )}

          {!editing && form.mode === "manual" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tenant</Label>
                <Select
                  value={form.tenantId}
                  onValueChange={(v) => setForm({ ...form, tenantId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t._id} value={t._id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.tenantId && (
                  <p className="text-xs text-destructive">{formErrors.tenantId}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Property</Label>
                <Select
                  value={form.propertyId}
                  onValueChange={(v) => setForm({ ...form, propertyId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.propertyId && (
                  <p className="text-xs text-destructive">{formErrors.propertyId}</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoice-period">Billed month</Label>
              <Input
                id="invoice-period"
                type="month"
                max={maxPeriod}
                value={form.period}
                onChange={(e) => setPeriod(e.target.value)}
              />
              {formErrors.period && <p className="text-xs text-destructive">{formErrors.period}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-due">Due date</Label>
              <Input
                id="invoice-due"
                type="date"
                value={form.dueDate}
                onChange={(e) =>
                  setForm({ ...form, dueDate: e.target.value, dueDateTouched: true })
                }
              />
              {formErrors.dueDate && (
                <p className="text-xs text-destructive">{formErrors.dueDate}</p>
              )}
            </div>
          </div>

          {(isManual || editing) && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="invoice-amount">Amount due (KES)</Label>
                <Input
                  id="invoice-amount"
                  type="number"
                  min={0}
                  value={form.amountDue}
                  onChange={(e) => setForm({ ...form, amountDue: e.target.value })}
                />
                {formErrors.amountDue && (
                  <p className="text-xs text-destructive">{formErrors.amountDue}</p>
                )}
              </div>
              {isManual && (
                <div className="space-y-2">
                  <Label htmlFor="invoice-service-charge">Service charge (KES)</Label>
                  <Input
                    id="invoice-service-charge"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={form.serviceChargeAmount}
                    onChange={(e) => setForm({ ...form, serviceChargeAmount: e.target.value })}
                  />
                  {formErrors.serviceChargeAmount && (
                    <p className="text-xs text-destructive">{formErrors.serviceChargeAmount}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {showSplit && serviceNumber >= 0 && serviceNumber <= amountNumber && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Rent {formatKES(amountNumber - serviceNumber)} + service charge{" "}
              {formatKES(serviceNumber)} = {formatKES(amountNumber)}
            </p>
          )}

          {!editing && (
            <div className="space-y-2">
              <Label>Save as</Label>
              <Select
                value={form.saveAs}
                onValueChange={(v) => setForm({ ...form, saveAs: v as SaveAs })}
              >
                <SelectTrigger className="w-full" aria-label="Save as">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft (template, not sent to the tenant)</SelectItem>
                  <SelectItem value="new">Issue now as Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Invoice number</Label>
            <p className="text-sm text-muted-foreground">
              {editing || form.saveAs === "draft"
                ? "Assigned on issue"
                : "Assigned when you create the invoice"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-notes">Notes</Label>
            <Textarea
              id="invoice-notes"
              rows={2}
              placeholder="Internal note (optional)…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button className="rounded-full" disabled={pending} onClick={handleSubmit}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save draft" : form.saveAs === "draft" ? "Save draft" : "Issue invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
