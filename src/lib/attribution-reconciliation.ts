import type { Lean } from "@/lib/lean";
import { connectToDatabase } from "@/lib/mongoose";
import { Attribution, type AttributionDocument } from "@/models/Attribution";
import { type ILease, Lease } from "@/models/Lease";

export interface ReconciliationReport {
  totalConfirmed: number;
  orphanConfirmedAttributions: Array<{
    attributionId: string;
    leaseId: string;
  }>;
  duplicateLeaseAttributions: Array<{
    leaseId: string;
    attributionIds: string[];
  }>;
  ok: boolean;
}

export async function reconcileAttributions(): Promise<ReconciliationReport> {
  await connectToDatabase();

  const confirmed = (await Attribution.find({
    status: "confirmed",
  }).lean()) as Lean<AttributionDocument>[];

  const leaseIds = confirmed.map((c) => c.leaseId).filter(Boolean);
  const existingLeases = (await Lease.find({
    _id: { $in: leaseIds },
  })
    .select("_id")
    .lean()) as Lean<ILease>[];

  const existingLeaseSet = new Set(existingLeases.map((l) => String(l._id)));

  const orphanConfirmedAttributions: Array<{ attributionId: string; leaseId: string }> = [];
  const leaseAttributionMap = new Map<string, string[]>();

  for (const attr of confirmed) {
    const attrId = String(attr._id);
    const lId = String(attr.leaseId || "");

    if (!lId || !existingLeaseSet.has(lId)) {
      orphanConfirmedAttributions.push({ attributionId: attrId, leaseId: lId });
    } else {
      const list = leaseAttributionMap.get(lId) || [];
      list.push(attrId);
      leaseAttributionMap.set(lId, list);
    }
  }

  const duplicateLeaseAttributions: Array<{ leaseId: string; attributionIds: string[] }> = [];
  for (const [lId, ids] of leaseAttributionMap.entries()) {
    if (ids.length > 1) {
      duplicateLeaseAttributions.push({ leaseId: lId, attributionIds: ids });
    }
  }

  const ok = orphanConfirmedAttributions.length === 0 && duplicateLeaseAttributions.length === 0;

  return {
    totalConfirmed: confirmed.length,
    orphanConfirmedAttributions,
    duplicateLeaseAttributions,
    ok,
  };
}
