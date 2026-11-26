"use client";

import { Mail, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type DataColumn, DataTable } from "@/components/common/DataTable";
import { TitleCell } from "@/components/common/TitleCell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/hooks/use-maintenance";
import { formatDate } from "@/lib/format";

interface Enquiry {
  _id: string;
  listingTitle: string;
  name: string;
  phone: string;
  email?: string;
  message?: string;
  status: "new" | "contacted" | "closed";
  createdAt: string;
}

const LABEL = { new: "New", contacted: "Contacted", closed: "Closed" } as const;

/** Visitor enquiries on the broker's own listings. */
export function BrokerEnquiriesPanel() {
  const [rows, setRows] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<Enquiry[]>("/api/v1/broker-enquiries")
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load enquiries"))
      .finally(() => setLoading(false));
  }, []);

  const setStatus = async (row: Enquiry, status: Enquiry["status"]) => {
    try {
      await apiRequest("/api/v1/broker-enquiries", {
        method: "PATCH",
        json: { id: row._id, status },
      });
      setRows((prev) => prev.map((r) => (r._id === row._id ? { ...r, status } : r)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  };

  const columns: DataColumn<Enquiry>[] = [
    {
      key: "name",
      header: "From",
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <TitleCell
          detail={{
            title: r.name,
            subtitle: r.listingTitle,
            fields: [
              {
                label: "Phone",
                value: (
                  <a href={`tel:${r.phone}`} className="text-primary">
                    {r.phone}
                  </a>
                ),
              },
              {
                label: "Email",
                value: r.email ? (
                  <a href={`mailto:${r.email}`} className="text-primary">
                    {r.email}
                  </a>
                ) : (
                  ""
                ),
              },
              { label: "Received", value: formatDate(r.createdAt) },
              { label: "Message", value: <span className="whitespace-pre-wrap">{r.message}</span> },
            ],
          }}
        >
          {r.name}
        </TitleCell>
      ),
    },
    { key: "listing", header: "Listing", cell: (r) => r.listingTitle },
    {
      key: "contact",
      header: "Contact",
      cell: (r) => (
        <span className="inline-flex gap-3">
          <a href={`tel:${r.phone}`} aria-label={`Call ${r.name}`} className="text-primary">
            <Phone className="h-4 w-4" />
          </a>
          {r.email ? (
            <a href={`mailto:${r.email}`} aria-label={`Email ${r.name}`} className="text-primary">
              <Mail className="h-4 w-4" />
            </a>
          ) : null}
        </span>
      ),
    },
    {
      key: "date",
      header: "Received",
      sortValue: (r) => r.createdAt,
      cell: (r) => formatDate(r.createdAt),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Select value={r.status} onValueChange={(v) => void setStatus(r, v as Enquiry["status"])}>
          <SelectTrigger
            className="h-8 w-[130px] rounded-full text-xs"
            aria-label={`Status for ${r.name}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LABEL) as Enquiry["status"][]).map((s) => (
              <SelectItem key={s} value={s}>
                {LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(r) => r._id}
      loading={loading}
      error={error}
      caption="Enquiries"
      emptyTitle="No enquiries yet"
      emptyDescription="When visitors ask about your listings, their messages appear here."
    />
  );
}
