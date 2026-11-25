import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { isFxDisplayEnabled, isTasksV2Enabled } from "@/lib/feature-flags";
import { getUsdKesRateOn } from "@/lib/fx";
import { convertAmount } from "@/lib/fx-math";
import { nairobiToday } from "@/lib/maintenance/dates";
import { TASK_PAYERS, type TaskPayer } from "@/lib/maintenance/enums";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { Invoice } from "@/models/Invoice";
import { Task } from "@/models/Task";

const MONTHS = 12;

function monthsBack(today: string, n: number): string {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - (n - 1), 1));
  return d.toISOString().slice(0, 7);
}

/**
 * Owner report figures for the last 12 months:
 * - collections per month in KES, and in USD with EACH payment converted at
 *   the rate on the day it was paid (client decision O1), so history never
 *   changes when today's rate moves;
 * - maintenance spend (labour + materials) per property, split by who pays.
 *
 * Scope: an admin sees their own properties plus delegated ones; a custodian
 * sees the owner they work for.
 */
export async function GET(request: NextRequest) {
  const authError = await requirePermission(request, "invoice:read");
  if (authError) return authError;
  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "invoice:read");
  if (actor instanceof NextResponse) return actor;

  let scope: Record<string, unknown>;
  if (actor.role === "admin") {
    scope =
      actor.propertyScopeIds.length > 0
        ? { $or: [{ ownerId: actor.userId }, { propertyId: { $in: actor.propertyScopeIds } }] }
        : { ownerId: actor.userId };
  } else if (actor.role === "custodian" && actor.managedByOwnerId) {
    scope = { ownerId: actor.managedByOwnerId };
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = nairobiToday();
  const fromMonth = monthsBack(today, MONTHS);
  const from = new Date(`${fromMonth}-01T00:00:00Z`);

  // ── Collections ──
  const paid = (await Invoice.find({
    ...scope,
    deletedAt: null,
    amountPaid: { $gt: 0 },
    paidAt: { $gte: from },
  })
    .select("amountPaid paidAt")
    .lean()) as { amountPaid: number; paidAt: Date }[];

  const withUsd = isFxDisplayEnabled();
  const rateByDay = new Map<string, number | null>();
  const months = new Map<string, { kes: number; usd: number; missingRate: boolean }>();
  for (let i = MONTHS - 1; i >= 0; i -= 1) {
    months.set(monthsBack(today, i + 1), { kes: 0, usd: 0, missingRate: false });
  }
  for (const inv of paid) {
    const day = new Date(inv.paidAt).toISOString().slice(0, 10);
    const bucket = months.get(day.slice(0, 7));
    if (!bucket) continue;
    bucket.kes += inv.amountPaid;
    if (!withUsd) continue;
    if (!rateByDay.has(day)) rateByDay.set(day, (await getUsdKesRateOn(day))?.rate ?? null);
    const rate = rateByDay.get(day);
    if (rate) bucket.usd += convertAmount(inv.amountPaid, "KES", "USD", rate);
    else bucket.missingRate = true;
  }
  const collections = [...months.entries()].map(([month, v]) => ({
    month,
    kes: Math.round(v.kes * 100) / 100,
    usd: withUsd && !v.missingRate ? Math.round(v.usd * 100) / 100 : null,
  }));

  // ── Maintenance spend ──
  let maintenance: {
    propertyId: string;
    property: string;
    total: number;
    byPayer: Record<TaskPayer, number>;
    tasks: number;
  }[] = [];
  if (isTasksV2Enabled()) {
    const rows = (await Task.aggregate([
      {
        $match: {
          ...scope,
          status: { $ne: "cancelled" },
          updatedAt: { $gte: from },
          $or: [{ "cost.labourAmount": { $gt: 0 } }, { "cost.materialsAmount": { $gt: 0 } }],
        },
      },
      {
        $group: {
          _id: { propertyId: "$propertyId", payer: { $ifNull: ["$cost.payer", "owner"] } },
          total: {
            $sum: {
              $add: [
                { $ifNull: ["$cost.labourAmount", 0] },
                { $ifNull: ["$cost.materialsAmount", 0] },
              ],
            },
          },
          tasks: { $sum: 1 },
        },
      },
    ])) as { _id: { propertyId: string; payer: TaskPayer }; total: number; tasks: number }[];

    const byProperty = new Map<
      string,
      { total: number; tasks: number; byPayer: Record<TaskPayer, number> }
    >();
    for (const r of rows) {
      const entry = byProperty.get(r._id.propertyId) ?? {
        total: 0,
        tasks: 0,
        byPayer: Object.fromEntries(TASK_PAYERS.map((p) => [p, 0])) as Record<TaskPayer, number>,
      };
      entry.total += r.total;
      entry.tasks += r.tasks;
      entry.byPayer[r._id.payer] = (entry.byPayer[r._id.payer] ?? 0) + r.total;
      byProperty.set(r._id.propertyId, entry);
    }
    const titles = await propertyTitleMap([...byProperty.keys()]);
    maintenance = [...byProperty.entries()]
      .map(([propertyId, v]) => ({ propertyId, property: titles.get(propertyId) ?? "", ...v }))
      .sort((a, b) => b.total - a.total);
  }

  return NextResponse.json({
    data: { fromMonth, collections, maintenance, usdEnabled: withUsd },
  });
}
