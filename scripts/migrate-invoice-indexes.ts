import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: ".env.local" });

/**
 * Invoice states — release R1 index change (plan
 * docs/plans/2026-11-18-tasks-invoices-table-navigation.md §2.4).
 *
 * Drafts are now templates with no invoice number (""). The two legacy unique
 * indexes treat "" as a value, so a second number-less draft (or two drafts for
 * the same lease + month) would collide. They are replaced by narrower,
 * explicitly named partial indexes that only cover issued invoices:
 *
 *   legacy                      replacement
 *   invoiceNumber_1             invoiceNumber_issued_unique
 *     { deletedAt: null }         { deletedAt: null, invoiceNumber: { $gt: "" } }
 *   leaseId_1_period_1          leaseId_period_issued_unique
 *     { leaseId: {$gt:""},        { leaseId: {$gt:""}, deletedAt: null,
 *       deletedAt: null }           invoiceNumber: { $gt: "" } }
 *
 * Order (safe at every step): verify no duplicate live issued invoices ->
 * create the replacements (if missing) -> drop the legacy indexes.
 *
 * - Raw `db.collection("invoices")` calls only. Never `syncIndexes()` (it would
 *   drop every index not declared here) or `Invoice.createIndexes()`.
 * - Idempotent: re-running after success is a no-op.
 * - Dry-run by default; `--apply` writes.
 */

const COLLECTION = "invoices";

const REPLACEMENTS = [
  {
    legacyName: "invoiceNumber_1",
    name: "invoiceNumber_issued_unique",
    key: { invoiceNumber: 1 },
    partialFilterExpression: { deletedAt: null, invoiceNumber: { $gt: "" } },
  },
  {
    legacyName: "leaseId_1_period_1",
    name: "leaseId_period_issued_unique",
    key: { leaseId: 1, period: 1 },
    partialFilterExpression: {
      leaseId: { $gt: "" },
      deletedAt: null,
      invoiceNumber: { $gt: "" },
    },
  },
] as const;

const USAGE = `Usage: npm run migrate:invoice-indexes [-- --apply]

Replaces the legacy invoice unique indexes with issued-only partial indexes so
number-less draft templates can coexist (invoice states R1, plan §2.4).

  (no flags)   dry-run: report indexes, duplicates and the planned changes
  --apply      create the replacement indexes, then drop the legacy ones
  --help       show this help

Loads MONGODB_URI from .env.local. Run on the host, never in the app container.`;

interface IndexInfo {
  name?: string;
  key: Record<string, unknown>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

function describeTarget(uri: string): string {
  try {
    const url = new URL(uri.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "https:"));
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "(unparseable MONGODB_URI)";
  }
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
  console.log(`[invoice-indexes] Target: ${describeTarget(uri)} (${apply ? "APPLY" : "dry-run"})`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle");

  const exists = (await db.listCollections({ name: COLLECTION }).toArray()).length > 0;
  if (!exists) {
    console.log(
      "[invoice-indexes] No invoices collection yet; the app will build the new indexes.",
    );
    return 0;
  }
  const invoices = db.collection(COLLECTION);

  // 1. Duplicate checks among live issued invoices (the new indexes' scope).
  const issued = { deletedAt: null, invoiceNumber: { $gt: "" } };
  const dupNumbers = await invoices
    .aggregate([
      { $match: issued },
      { $group: { _id: "$invoiceNumber", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();
  const dupLeasePeriods = await invoices
    .aggregate([
      { $match: { ...issued, leaseId: { $gt: "" } } },
      { $group: { _id: { leaseId: "$leaseId", period: "$period" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();
  console.log(
    `[invoice-indexes] Duplicate issued numbers: ${dupNumbers.length}; duplicate lease+month: ${dupLeasePeriods.length}`,
  );
  if (dupNumbers.length > 0 || dupLeasePeriods.length > 0) {
    console.error("[invoice-indexes] STOP: resolve duplicates before changing indexes.");
    return 1;
  }

  const before = (await invoices.indexes()) as IndexInfo[];
  console.log(`[invoice-indexes] Existing: ${before.map((index) => index.name).join(", ")}`);

  for (const spec of REPLACEMENTS) {
    const hasNew = before.some((index) => index.name === spec.name);
    const hasLegacy = before.some((index) => index.name === spec.legacyName);
    console.log(
      `[invoice-indexes] ${spec.name}: ${hasNew ? "present" : "to create"}; ${spec.legacyName}: ${hasLegacy ? "to drop" : "absent"}`,
    );
    if (!apply) continue;
    if (!hasNew) {
      await invoices.createIndex(spec.key, {
        name: spec.name,
        unique: true,
        partialFilterExpression: spec.partialFilterExpression,
      });
      console.log(`[invoice-indexes] Created ${spec.name}.`);
    }
    if (hasLegacy) {
      await invoices.dropIndex(spec.legacyName);
      console.log(`[invoice-indexes] Dropped ${spec.legacyName}.`);
    }
  }

  if (!apply) {
    console.log("[invoice-indexes] Dry-run only. Re-run with --apply to make these changes.");
    return 0;
  }

  const after = (await invoices.indexes()) as IndexInfo[];
  for (const spec of REPLACEMENTS) {
    if (!after.some((index) => index.name === spec.name && index.unique)) {
      throw new Error(`Verification failed: ${spec.name} is missing after apply.`);
    }
    if (after.some((index) => index.name === spec.legacyName)) {
      throw new Error(`Verification failed: ${spec.legacyName} still exists after apply.`);
    }
  }
  console.log("[invoice-indexes] Verified. Migration complete.");
  return 0;
}

main()
  .then(async (exitCode) => {
    await mongoose.disconnect();
    process.exitCode = exitCode;
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[invoice-indexes] Failed:", message.replace(/\/\/[^@]*@/g, "//***@"));
    await mongoose.disconnect();
    process.exitCode = 1;
  });
