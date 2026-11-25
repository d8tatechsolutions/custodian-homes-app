"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type DataColumn, DataTable } from "@/components/common/DataTable";
import { FxAttribution } from "@/components/money/Money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useReleaseFlags } from "@/hooks/use-fx";
import { apiRequest } from "@/hooks/use-maintenance";
import { formatPeriod } from "@/lib/format";
import { formatCurrency } from "@/lib/fx-math";
import { TASK_PAYER_LABELS, type TaskPayer } from "@/lib/maintenance/enums";
import { cn } from "@/lib/utils";

interface Summary {
  fromMonth: string;
  usdEnabled: boolean;
  collections: { month: string; kes: number; usd: number | null }[];
  maintenance: {
    propertyId: string;
    property: string;
    total: number;
    tasks: number;
    byPayer: Record<TaskPayer, number>;
  }[];
}

/**
 * Collections per month (KES, or USD converted at each payment's own day) and
 * maintenance spend per property split by who pays.
 */
export function OwnerReportSection() {
  const { flags } = useReleaseFlags();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"KES" | "USD">("KES");

  useEffect(() => {
    let cancelled = false;
    apiRequest<Summary>("/api/v1/reports/owner-summary")
      .then((d) => !cancelled && setData(d))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof Error ? e.message : "Could not load the report"),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading report…
      </p>
    );
  }

  const showUsd = data.usdEnabled && currency === "USD";
  const money = (kes: number, usd: number | null) =>
    showUsd ? (usd === null ? "—" : formatCurrency(usd, "USD")) : formatCurrency(kes, "KES");
  const totalKes = data.collections.reduce((s, c) => s + c.kes, 0);
  const totalUsd = data.collections.every((c) => c.usd !== null)
    ? data.collections.reduce((s, c) => s + (c.usd ?? 0), 0)
    : null;

  const maintenanceColumns: DataColumn<Summary["maintenance"][number]>[] = [
    {
      key: "property",
      header: "Property",
      sortValue: (r) => r.property,
      cell: (r) => r.property || "—",
    },
    {
      key: "tasks",
      header: "Jobs",
      sortValue: (r) => r.tasks,
      cell: (r) => r.tasks,
      align: "right",
    },
    ...(Object.keys(TASK_PAYER_LABELS) as TaskPayer[]).map((payer) => ({
      key: payer,
      header: TASK_PAYER_LABELS[payer],
      align: "right" as const,
      sortValue: (r: Summary["maintenance"][number]) => r.byPayer[payer] ?? 0,
      cell: (r: Summary["maintenance"][number]) => formatCurrency(r.byPayer[payer] ?? 0, "KES"),
    })),
    {
      key: "total",
      header: "Total",
      align: "right",
      sortValue: (r) => r.total,
      cell: (r) => <span className="font-semibold">{formatCurrency(r.total, "KES")}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Collections by month</CardTitle>
            <CardDescription>
              Last 12 months.
              {showUsd ? " Each payment is converted at the rate on the day it was paid." : ""}
            </CardDescription>
          </div>
          {data.usdEnabled ? (
            <fieldset className="inline-flex rounded-full border border-border p-0.5">
              <legend className="sr-only">Currency</legend>
              {(["KES", "USD"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  onClick={() => setCurrency(c)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    currency === c ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
            </fieldset>
          ) : null}
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.collections.map((c) => (
              <li key={c.month} className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">{formatPeriod(c.month)}</p>
                <p className="font-semibold tabular-nums">{money(c.kes, c.usd)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            Total: <span className="font-semibold tabular-nums">{money(totalKes, totalUsd)}</span>
          </p>
          {showUsd ? <FxAttribution className="mt-2" /> : null}
        </CardContent>
      </Card>

      {flags.tasksV2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Maintenance spend</CardTitle>
            <CardDescription>
              Labour and materials recorded on tasks in the last 12 months, by who pays.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={data.maintenance}
              columns={maintenanceColumns}
              getRowId={(r) => r.propertyId}
              caption="Maintenance spend"
              emptyTitle="No maintenance costs recorded yet"
              emptyDescription="Costs entered on tasks appear here."
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** Renders the section only once a release flag that feeds it is on. */
export function OwnerReportSectionGate() {
  const { flags, loading } = useReleaseFlags();
  if (loading || !(flags.tasksV2 || flags.fxDisplay)) return null;
  return (
    <div className="mt-8">
      <OwnerReportSection />
    </div>
  );
}
