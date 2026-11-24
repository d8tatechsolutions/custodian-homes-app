import dotenv from "dotenv";
import mongoose, { type Types } from "mongoose";

dotenv.config({ path: ".env.local" });

/**
 * Invoice states — release R2 backfill: stored `pending` -> `new`
 * (plan docs/plans/2026-11-18-tasks-invoices-table-navigation.md §2.5–§2.7).
 *
 * PRECONDITION: release R1 is deployed on every instance (all readers and
 * guards treat `pending` and `new` as the same open state). Running this
 * before R1 would make in-flight guarded updates match nothing and silently
 * stop overdue notifications.
 *
 * Mechanics (plan §2.6):
 * - Filter `{ status: "pending" }` with NO `deletedAt` predicate (soft-deleted
 *   rows are migrated too; the soft-delete plugin does not narrow raw updates).
 * - Batches of 500, resumable by `_id`, every batch re-guarded on
 *   `status: "pending"`; no multi-document transaction.
 * - Raw collection update: `updatedAt` is NOT touched, validators do not run.
 * - Idempotent: re-running (R2b reconcile) only picks up stragglers.
 * - Dry-run by default; `--apply` writes.
 *
 * Verification queries V1–V7 (plan §2.7) are printed before and after. V3 must
 * be identical before/after; V6 > 0 stops the run (paid drafts need a ruling).
 */

const COLLECTION = "invoices";
const BATCH = 500;

const USAGE = `Usage: npm run migrate:invoices [-- --apply]

Backfills invoice status pending -> new (invoice states R2). Requires R1 to be
deployed everywhere first.

  (no flags)   dry-run: print V1–V7 and how many rows would change
  --apply      migrate in guarded batches of ${BATCH}, then re-verify
  --help       show this help

Loads MONGODB_URI from .env.local. Run on the host, never in the app container.`;

function describeTarget(uri: string): string {
  try {
    const url = new URL(uri.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "https:"));
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "(unparseable MONGODB_URI)";
  }
}

type Collection = mongoose.mongo.Collection;

async function verification(invoices: Collection, now: Date) {
  const v1 = await invoices.countDocuments({ status: "pending" });
  const v2 = await invoices.countDocuments({
    status: { $nin: ["draft", "new", "paid", "void", "pending"] },
  });
  const v3 = await invoices.countDocuments({
    status: { $in: ["pending", "new"] },
    dueDate: { $lt: now },
  });
  const v4 = await invoices
    .aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }])
    .toArray();
  const v5 = await invoices.countDocuments({ status: "pending", deletedAt: { $exists: false } });
  const v6 = await invoices.countDocuments({
    status: "draft",
    $or: [{ amountPaid: { $gt: 0 } }, { paidAt: { $exists: true, $ne: null } }],
  });
  const v7 = await invoices.countDocuments({ status: "draft", invoiceNumber: { $ne: "" } });
  return { v1, v2, v3, v4, v5, v6, v7 };
}

function print(label: string, v: Awaited<ReturnType<typeof verification>>) {
  console.log(`[invoice-statuses] ${label}`);
  console.log(`  V1 pending                      = ${v.v1}`);
  console.log(`  V2 unknown statuses             = ${v.v2} (must be 0)`);
  console.log(`  V3 open & past due              = ${v.v3} (must not change)`);
  console.log(
    `  V4 by status                    = ${v.v4.map((r) => `${r._id}:${r.n}`).join(" ")}`,
  );
  console.log(`  V5 pending w/o deletedAt        = ${v.v5}`);
  console.log(`  V6 drafts with payments         = ${v.v6} (must be 0)`);
  console.log(`  V7 legacy numbered drafts       = ${v.v7} (informational)`);
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help")) {
    console.log(USAGE);
    return 0;
  }
  const apply = args.has("--apply");

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI (expected in .env.local)");
  console.log(`[invoice-statuses] Target: ${describeTarget(uri)} (${apply ? "APPLY" : "dry-run"})`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle");
  const invoices = db.collection(COLLECTION);

  // Fixed `now` so V3 is comparable before and after.
  const now = new Date();
  const before = await verification(invoices, now);
  print("Before", before);

  if (before.v2 > 0) {
    console.error("[invoice-statuses] STOP: unknown statuses present (V2 > 0).");
    return 1;
  }
  if (before.v6 > 0) {
    console.error(
      "[invoice-statuses] STOP: drafts carry payments (V6 > 0). Decide before R3 (plan §7.5).",
    );
    return 1;
  }

  if (!apply) {
    console.log(`[invoice-statuses] Dry-run: ${before.v1} row(s) would change pending -> new.`);
    return 0;
  }

  let lastId: Types.ObjectId | null = null;
  let matched = 0;
  let modified = 0;
  for (;;) {
    const page = await invoices
      .find(lastId ? { status: "pending", _id: { $gt: lastId } } : { status: "pending" })
      .project({ _id: 1 })
      .sort({ _id: 1 })
      .limit(BATCH)
      .maxTimeMS(30_000)
      .toArray();
    if (page.length === 0) break;
    const ids = page.map((doc) => doc._id as Types.ObjectId);
    // Re-guarded on status so a row settled meanwhile is left alone.
    const result = await invoices.updateMany(
      { _id: { $in: ids }, status: "pending" },
      { $set: { status: "new" } },
    );
    matched += result.matchedCount;
    modified += result.modifiedCount;
    console.log(
      `[invoice-statuses] batch: matched=${result.matchedCount} modified=${result.modifiedCount}`,
    );
    lastId = ids[ids.length - 1] ?? null;
  }
  console.log(`[invoice-statuses] Total matched=${matched} modified=${modified}`);

  const after = await verification(invoices, now);
  print("After", after);
  if (after.v3 !== before.v3) {
    console.error("[invoice-statuses] V3 changed: overdue population drifted. Investigate.");
    return 1;
  }
  if (after.v1 !== 0) {
    console.warn(
      `[invoice-statuses] ${after.v1} pending row(s) remain (written during the run); re-run (R2b).`,
    );
  }
  console.log("[invoice-statuses] Done.");
  return 0;
}

main()
  .then(async (exitCode) => {
    await mongoose.disconnect();
    process.exitCode = exitCode;
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[invoice-statuses] Failed:", message.replace(/\/\/[^@]*@/g, "//***@"));
    await mongoose.disconnect();
    process.exitCode = 1;
  });
