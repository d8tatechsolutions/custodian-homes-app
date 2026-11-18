import dotenv from "dotenv";
import mongoose, { Schema } from "mongoose";

dotenv.config({ path: ".env.local" });

/**
 * One-off backfill for the caretaker `manage_tasks` privilege (plan §1.6,
 * docs/plans/2026-11-18-tasks-invoices-table-navigation.md).
 *
 * The privilege map now derives manage_tasks → ["task:read-own",
 * "task:create", "task:manage"] (src/lib/authorization-policy.ts:425), but
 * only future privilege syncs re-derive stored rows. Existing active
 * caretaker ManagementAssignment rows still hold ["task:manage"] and 403 on
 * GET/POST /api/v1/tasks. This script adds the two missing tokens.
 *
 * Where privileges live: the principal's `users.privileges` string array
 * (src/models/User.ts:17,58-75), consumed by syncCaretakerPrivilegeAssignments
 * (src/lib/property-staff.ts:105-115). Selection predicate: role "caretaker"
 * AND privileges contains "manage_tasks". An assignment's permissions
 * containing "task:manage" is NOT proof the principal holds the privilege:
 * it is a derived cache that can outlive a revoked privilege, so backfilling
 * from it would re-grant access an owner revoked.
 *
 * Safety:
 * - Dry-run by default; only --apply writes.
 * - $addToSet only — never $set on permissions, so actions this script does
 *   not own (including future ones) survive.
 * - Idempotent: rows already holding both tokens are filtered out, so a
 *   second run matches 0 documents.
 * - No upserts; only existing rows are updated. The partial unique index
 *   (src/models/ManagementAssignment.ts:41-51) keys on fields this script
 *   never touches.
 * - Active caretaker assignments whose principal does not hold manage_tasks
 *   are left untouched and reported as skipped.
 * - "Active" means status: "active" with no date-window predicate, so
 *   scheduled rows (startsAt in the future) are reconciled before they
 *   activate; expired rows stay denied at runtime by isActiveAssignment
 *   (src/lib/authorization-policy.ts:238-243).
 *
 * Schemas are declared locally (app models are not imported) to keep the
 * script runnable under tsx without the `@/` path alias, mirroring
 * scripts/migrate-soft-delete-indexes.ts. The local privileges schema has no
 * enum: the app enum (src/models/User.ts:60-73) omits manage_tasks, but write
 * paths such as User.updateOne without runValidators
 * (src/app/api/v1/caretakers/route.ts:238) persist it anyway, and reads are
 * never enum-validated. Run on the host, never inside the app container
 * (the compose image ships no tsx).
 */

const MANAGE_TASKS_PRIVILEGE = "manage_tasks";
const TOKENS_TO_ADD = ["task:read-own", "task:create"];
const BATCH_SIZE = 100;

const userSchema = new Schema({ role: String, privileges: [String] }, { collection: "users" });

const assignmentSchema = new Schema(
  {
    principalUserId: String,
    accessRole: String,
    propertyId: String,
    permissions: [String],
    status: String,
  },
  { collection: "managementassignments", timestamps: true },
);

interface AssignmentRow {
  _id: unknown;
  principalUserId: string;
  propertyId: string;
  permissions?: string[] | null;
}

const USAGE = `Usage: npm run backfill:tasks [-- --apply]

Adds "task:read-own" and "task:create" to active caretaker ManagementAssignment
rows whose principal (users.privileges) holds "manage_tasks".

  (no flags)   dry-run: print exactly what would change, write nothing
  --dry-run    explicit dry-run (same as the default)
  --apply      write the changes ($addToSet only, idempotent)
  --help       show this help

Loads MONGODB_URI from .env.local. Run on the host, never in the app container.`;

/** Host and database only — never credentials or the full connection string. */
function describeTarget(uri: string): string {
  try {
    const url = new URL(uri);
    const db = url.pathname.replace(/^\//, "") || "(default)";
    return `${url.host}/${db}`;
  } catch {
    return "(unparseable URI — target hidden)";
  }
}

function sanitize(message: string): string {
  return message.replace(/mongodb(\+srv)?:\/\/\S+/gi, "[redacted-mongodb-uri]");
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(["--apply", "--dry-run", "--help"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(", ")}\n\n${USAGE}`);
    process.exit(1);
  }
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) {
    console.error("--apply and --dry-run are mutually exclusive.");
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("Missing MONGODB_URI environment variable (checked .env.local).");
  }

  console.log(
    apply
      ? "🛠  Applying task-permission backfill ($addToSet task:read-own + task:create)..."
      : "🔍 Task-permission backfill dry-run — no writes. Pass --apply to write.",
  );
  console.log(`Target: ${describeTarget(mongoUri)}`);

  await mongoose.connect(mongoUri, {
    bufferCommands: false,
    maxPoolSize: 10,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  });

  const UserModel = mongoose.models.User || mongoose.model("User", userSchema);
  const AssignmentModel =
    mongoose.models.ManagementAssignment ||
    mongoose.model("ManagementAssignment", assignmentSchema);

  const principals = (await UserModel.find({
    role: "caretaker",
    privileges: MANAGE_TASKS_PRIVILEGE,
  })
    .select("_id")
    .lean()) as Array<{ _id: unknown }>;
  const principalIds = principals.map((principal) => String(principal._id));
  console.log(`Caretaker principals holding "${MANAGE_TASKS_PRIVILEGE}": ${principalIds.length}`);

  const skipped = await AssignmentModel.countDocuments({
    accessRole: "caretaker",
    status: "active",
    principalUserId: { $nin: principalIds },
  });
  console.log(
    `Skipped (active caretaker assignments whose principal does not hold the privilege): ${skipped}`,
  );

  if (principalIds.length === 0) {
    console.log("No matching principals — nothing to backfill.");
    await mongoose.disconnect();
    return;
  }

  // Rows already holding both tokens are excluded, so a second run matches 0.
  const missingTokensFilter = {
    accessRole: "caretaker",
    status: "active",
    principalUserId: { $in: principalIds },
    permissions: { $not: { $all: TOKENS_TO_ADD } },
  };

  const preflight = await AssignmentModel.countDocuments(missingTokensFilter);
  console.log(`Assignments missing at least one token (preflight): ${preflight}`);
  if (preflight === 0) {
    console.log("Already reconciled — nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const cursor = AssignmentModel.find(missingTokensFilter)
    .select("_id principalUserId propertyId permissions")
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  let batch: AssignmentRow[] = [];
  let batchNumber = 0;
  let totalMatched = 0;
  let totalModified = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    batchNumber += 1;
    const rows = batch;
    batch = [];

    for (const row of rows) {
      if (row.permissions != null && !Array.isArray(row.permissions)) {
        throw new Error(
          `Validation failed: assignment ${String(row._id)} has non-array permissions ` +
            `(${typeof row.permissions}). Refusing to write.`,
        );
      }
    }

    totalMatched += rows.length;
    if (!apply) {
      for (const row of rows) {
        const missing = TOKENS_TO_ADD.filter((token) => !(row.permissions ?? []).includes(token));
        console.log(
          `  would update assignment=${String(row._id)} principal=${row.principalUserId} ` +
            `property=${row.propertyId} add=[${missing.join(", ")}]`,
        );
      }
      console.log(`batch ${batchNumber}: matched ${rows.length}, would modify ${rows.length}`);
      return;
    }

    // Re-guard at write time: a concurrent privilege sync may have reconciled
    // or revoked a row since the cursor read it.
    const result = await AssignmentModel.updateMany(
      { _id: { $in: rows.map((row) => row._id) }, ...missingTokensFilter },
      { $addToSet: { permissions: { $each: TOKENS_TO_ADD } } },
    );
    totalModified += result.modifiedCount;
    console.log(
      `batch ${batchNumber}: matched ${result.matchedCount}, modified ${result.modifiedCount}`,
    );
  };

  for await (const doc of cursor) {
    batch.push(doc as AssignmentRow);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(
    `Total: matched ${totalMatched}, ` +
      (apply ? `modified ${totalModified}` : `would modify ${totalMatched}`) +
      `, skipped ${skipped}`,
  );

  if (apply) {
    const residual = await AssignmentModel.countDocuments(missingTokensFilter);
    if (residual > 0) {
      throw new Error(
        `Verification failed: ${residual} assignment(s) still missing tokens after apply.`,
      );
    }
    console.log("Backfill complete. Residual missing-token count: 0.");
  } else {
    console.log("Dry run complete (no changes written).");
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Task-permission backfill failed:", sanitize(message));
  await mongoose.disconnect();
  process.exit(1);
});
