import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import {
  INVOICE_METHODS,
  INVOICE_STATUSES,
  type InvoiceMethod,
  type InvoiceStatus,
  PERIOD_REGEX,
} from "@/lib/invoicing";
import { softDeletePlugin } from "@/lib/mongoose-soft-delete";

export type { InvoiceMethod, InvoiceStatus };
export { INVOICE_METHODS, INVOICE_STATUSES };

export interface InvoiceServiceFeeItem {
  itemId: string;
  label: string;
  amount: number;
}

export interface IInvoice {
  invoiceNumber: string;
  tenantId: string;
  propertyId: string;
  leaseId: string;
  unitId?: string;
  ownerId: string;
  billingAccountId?: string;
  billingAdminId?: string;
  billingSnapshot?: {
    legalEntityName?: string;
    invoicePrefix?: string;
  };
  period: string;
  amountDue: number;
  amountPaid: number;
  status: InvoiceStatus;
  dueDate: Date;
  /** Set when the invoice is issued; null for a draft (template). */
  issuedAt: Date | null;
  paidAt?: Date;
  method?: InvoiceMethod;
  notes?: string;
  paymentReference?: string;
  paymentDescription?: string;
  paidBy?: string;
  paidByRole?: string;
  // Breakdown of amountDue into rent (→ owner) and service charge (→ caretaker).
  // Populated at generation time from the unit's service-charge configuration.
  rentAmount: number;
  serviceChargeAmount: number;
  rentIncludesServiceCharge: boolean;
  // Staff-only itemized snapshot. Tenant serialization omits this field.
  serviceFeeItems: InvoiceServiceFeeItem[];
  deletedAt?: Date | null;
}

const invoiceSchema = new Schema<IInvoice>(
  {
    // Assigned when the invoice is issued. Drafts are templates and carry "".
    invoiceNumber: { type: String, default: "" },
    tenantId: { type: String, required: true },
    propertyId: { type: String, required: true },
    leaseId: { type: String, default: "" },
    unitId: { type: String, default: "" },
    ownerId: { type: String, required: true },
    billingAccountId: { type: String, default: "" },
    billingAdminId: { type: String, default: "" },
    billingSnapshot: {
      type: new Schema(
        {
          legalEntityName: { type: String, default: "" },
          invoicePrefix: { type: String, default: "" },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    period: { type: String, required: true, match: PERIOD_REGEX },
    amountDue: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0 },
    status: { type: String, enum: [...INVOICE_STATUSES], default: "pending" },
    dueDate: { type: Date, required: true },
    issuedAt: { type: Date, default: Date.now },
    paidAt: { type: Date },
    method: { type: String, enum: [...INVOICE_METHODS] },
    notes: { type: String },
    paymentReference: { type: String, trim: true, default: "" },
    paymentDescription: { type: String, trim: true, default: "" },
    paidBy: { type: String },
    paidByRole: { type: String },
    rentAmount: { type: Number, required: true, min: 0, default: 0 },
    serviceChargeAmount: { type: Number, required: true, min: 0, default: 0 },
    rentIncludesServiceCharge: { type: Boolean, default: false },
    serviceFeeItems: {
      type: [
        new Schema<InvoiceServiceFeeItem>(
          {
            itemId: { type: String, required: true },
            label: { type: String, required: true },
            amount: { type: Number, required: true, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

invoiceSchema.index({ ownerId: 1, period: 1 });
invoiceSchema.index({ billingAccountId: 1, period: 1 });
invoiceSchema.index({ tenantId: 1 });
invoiceSchema.index({ propertyId: 1, period: 1 });
invoiceSchema.index({ unitId: 1, period: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 });
invoiceSchema.index({ ownerId: 1, status: 1 });
// Invoice numbers are unique among live, issued invoices. Drafts carry no
// number ("") and are excluded, so any number of draft templates can coexist.
//
// Explicit names: these replace the legacy `invoiceNumber_1` and
// `leaseId_1_period_1` indexes (same keys, narrower filters). Distinct names let
// autoIndex build them without an options conflict; the legacy indexes are
// dropped by scripts/migrate-invoice-indexes.ts (R1, plan §2.4).
invoiceSchema.index(
  { invoiceNumber: 1 },
  {
    name: "invoiceNumber_issued_unique",
    unique: true,
    partialFilterExpression: { deletedAt: null, invoiceNumber: { $gt: "" } },
  },
);
// Generation idempotency: one live issued invoice per lease per period (manual
// invoices never set leaseId; drafts carry no number — both are excluded).
invoiceSchema.index(
  { leaseId: 1, period: 1 },
  {
    name: "leaseId_period_issued_unique",
    unique: true,
    partialFilterExpression: {
      leaseId: { $gt: "" },
      deletedAt: null,
      invoiceNumber: { $gt: "" },
    },
  },
);
softDeletePlugin(invoiceSchema);

export type InvoiceDocument = InferSchemaType<IInvoice>;

export const Invoice = mongoose.models.Invoice || model<IInvoice>("Invoice", invoiceSchema);
