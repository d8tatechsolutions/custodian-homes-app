/**
 * Phase 6 data fix: units marked "occupied" with no active lease and no tenant
 * record behind their occupant(s) are set back to "available" and the stale
 * occupant link is removed (the user accounts themselves are not touched).
 *
 *   npx tsx scripts/fix-orphaned-occupied-units.ts            # dry run (default): lists only
 *   npx tsx scripts/fix-orphaned-occupied-units.ts --apply --backup <file.json>
 *
 * --apply writes nothing unless a backup path is given; the previous values of
 * every changed unit are saved there first so the change can be reversed.
 * Each update is guarded on the unit still being occupied with the same
 * occupants, so a unit that changed in the meantime is left alone. Re-running
 * is safe.
 *
 * Note: this does not send "unit available" alerts to tenants who saved the
 * unit — it is a correction of stale data, not a real vacancy.
 */
import dns from "node:dns";
import { existsSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

// Some workstations resolve SRV records only through the OS resolver; allow
// pointing Node at specific DNS servers (comma separated) for this script.
if (process.env.SCRIPT_DNS_SERVERS) {
  dns.setServers(process.env.SCRIPT_DNS_SERVERS.split(",").map((s) => s.trim()));
}

const unitSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    propertyId: { type: String, default: "" },
    status: { type: String, default: "available" },
    tenantId: { type: mongoose.Schema.Types.Mixed, default: [] },
    statusChangedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { collection: "units", strict: false },
);
const leaseSchema = new mongoose.Schema(
  {
    unitId: { type: String, default: "" },
    status: { type: String, default: "active" },
    deletedAt: { type: Date, default: null },
  },
  { collection: "leases", strict: false },
);
const tenantSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    status: { type: String, default: "active" },
    deletedAt: { type: Date, default: null },
  },
  { collection: "tenants", strict: false },
);
const propertySchema = new mongoose.Schema(
  { name: { type: String, default: "" } },
  { collection: "properties", strict: false },
);

const Unit = mongoose.model("FixUnit", unitSchema);
const Lease = mongoose.model("FixLease", leaseSchema);
const Property = mongoose.model("FixProperty", propertySchema);
const Tenant = mongoose.model("FixTenant", tenantSchema);

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function occupants(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const backupPath = argValue("--backup");
  if (apply && !backupPath) throw new Error("--apply needs --backup <file.json>");
  if (backupPath && existsSync(backupPath)) throw new Error(`Backup file exists: ${backupPath}`);

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");
  await mongoose.connect(uri, { bufferCommands: false, connectTimeoutMS: 10_000 });
  const dbName = mongoose.connection.db?.databaseName ?? "?";

  const occupied = await Unit.find({ status: "occupied", deletedAt: null }).lean();
  const unitIds = occupied.map((u) => String(u._id));
  const active = await Lease.find({ unitId: { $in: unitIds }, status: "active", deletedAt: null })
    .select("unitId")
    .lean();
  const leased = new Set(active.map((l) => String(l.unitId)));
  const allOccupants = [...new Set(occupied.flatMap((u) => occupants(u.tenantId)))];
  const objectIds = allOccupants.filter((id) => mongoose.isValidObjectId(id));
  const tenantRows = await Tenant.find({
    deletedAt: null,
    $or: [{ userId: { $in: allOccupants } }, { _id: { $in: objectIds } }],
  })
    .select("userId")
    .lean();
  const withTenantRecord = new Set(
    tenantRows.flatMap((t) => [String(t._id), String(t.userId ?? "")]).filter(Boolean),
  );
  const orphans = occupied.filter(
    (u) =>
      !leased.has(String(u._id)) && occupants(u.tenantId).every((id) => !withTenantRecord.has(id)),
  );

  const propertyNames = new Map(
    (
      await Property.find({ _id: { $in: [...new Set(orphans.map((u) => u.propertyId))] } })
        .select("name")
        .lean()
    ).map((p) => [String(p._id), String(p.name ?? "")]),
  );

  console.log(`Database: ${dbName}`);
  console.log(
    `Occupied units: ${occupied.length}; with no active lease and no tenant record: ${orphans.length}`,
  );
  for (const u of orphans) {
    console.log(
      `  - unit ${String(u._id)} "${u.name}" in "${propertyNames.get(u.propertyId) ?? u.propertyId}" occupants=${occupants(u.tenantId).length} (status changed ${u.statusChangedAt ? new Date(u.statusChangedAt).toISOString() : "never"})`,
    );
  }

  if (!apply) {
    console.log("Dry run: nothing changed. Re-run with --apply --backup <file.json> to fix.");
    await mongoose.disconnect();
    return;
  }

  writeFileSync(
    backupPath as string,
    JSON.stringify(
      {
        database: dbName,
        takenAt: new Date().toISOString(),
        units: orphans.map((u) => ({
          _id: String(u._id),
          status: u.status,
          tenantId: u.tenantId,
          statusChangedAt: u.statusChangedAt,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`Backup written: ${backupPath}`);

  let changed = 0;
  for (const u of orphans) {
    const res = await Unit.updateOne(
      { _id: u._id, status: "occupied", tenantId: u.tenantId },
      { $set: { status: "available", tenantId: [], statusChangedAt: new Date() } },
    );
    changed += res.modifiedCount;
  }
  console.log(`Updated ${changed} unit(s) to "available".`);

  const left = await Unit.countDocuments({
    _id: { $in: orphans.map((u) => u._id) },
    status: "occupied",
  });
  console.log(`Verification: ${left} of those units still occupied.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
