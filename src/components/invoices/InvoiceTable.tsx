"use client";

import type { ReactNode } from "react";
import { TitleCell } from "@/components/common/TitleCell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatKES, formatPeriod } from "@/lib/format";
import { type DerivedInvoiceStatus, invoiceStatusLabel } from "@/lib/invoicing";
import type { Invoice } from "@/types/invoicing";

const statusClass: Record<DerivedInvoiceStatus, string> = {
  paid: "bg-success/15 text-success",
  pending: "bg-warning/15 text-warning",
  new: "bg-warning/15 text-warning",
  overdue: "bg-destructive/15 text-destructive",
  draft: "bg-muted text-muted-foreground",
  void: "bg-muted text-muted-foreground",
};

interface InvoiceTableProps {
  invoices: Invoice[];
  /** Maps a tenant id to its display name; falls back to the raw id when absent. */
  tenantNames?: Record<string, string>;
  /** Per-row action slot rendered in the trailing column. */
  renderActions?: (invoice: Invoice) => ReactNode;
}

export const InvoiceTable = ({ invoices, tenantNames, renderActions }: InvoiceTableProps) => {
  if (invoices.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => {
            const amountPaid = invoice.amountPaid ?? 0;
            const partial = amountPaid > 0 && amountPaid < invoice.amountDue;
            const serviceFeeAmount = invoice.serviceChargeAmount ?? 0;
            const rentAmount =
              invoice.rentAmount ?? Math.max(0, invoice.amountDue - serviceFeeAmount);
            return (
              <TableRow key={invoice._id}>
                <TableCell className="font-medium">
                  <TitleCell
                    detail={{
                      title: invoice.invoiceNumber || "Draft invoice",
                      subtitle: formatPeriod(invoice.period),
                      fields: [
                        {
                          label: "Tenant",
                          value: tenantNames?.[invoice.tenantId] ?? invoice.tenantId,
                        },
                        { label: "Status", value: invoiceStatusLabel(invoice.status) },
                        { label: "Amount due", value: formatKES(invoice.amountDue) },
                        { label: "Rent", value: formatKES(rentAmount) },
                        { label: "Service charge", value: formatKES(serviceFeeAmount) },
                        { label: "Paid", value: formatKES(amountPaid) },
                        { label: "Due date", value: formatDate(invoice.dueDate) },
                        {
                          label: "Issued",
                          value: invoice.issuedAt ? formatDate(invoice.issuedAt) : "Not issued",
                        },
                        { label: "Payment ref", value: invoice.paymentReference ?? "" },
                        { label: "Notes", value: invoice.notes ?? "" },
                      ],
                    }}
                  >
                    {invoice.invoiceNumber || (
                      <span className="font-normal text-muted-foreground">
                        Draft · number on issue
                      </span>
                    )}
                  </TitleCell>
                  {invoice.paymentReference && (
                    <p className="text-xs font-normal text-muted-foreground">
                      Ref: {invoice.paymentReference}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <p className="font-medium">
                    {tenantNames?.[invoice.tenantId] ?? invoice.tenantId}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatPeriod(invoice.period)}</p>
                </TableCell>
                <TableCell className="font-medium">
                  <div>{formatKES(invoice.amountDue)}</div>
                  {serviceFeeAmount > 0 && (
                    <div className="mt-1 space-y-0.5 text-[11px] font-normal text-muted-foreground">
                      <div>Rent {formatKES(rentAmount)}</div>
                      <div>Service fee {formatKES(serviceFeeAmount)}</div>
                    </div>
                  )}
                  {partial && (
                    <p className="text-xs font-normal text-muted-foreground">
                      {formatKES(amountPaid)} received
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(invoice.dueDate)}
                </TableCell>
                <TableCell>
                  <Badge className={`${statusClass[invoice.status]} hover:opacity-100`}>
                    {invoiceStatusLabel(invoice.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{renderActions?.(invoice)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
