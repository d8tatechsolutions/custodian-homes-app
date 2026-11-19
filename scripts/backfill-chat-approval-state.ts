import dotenv from "dotenv";
import mongoose, { Schema } from "mongoose";

dotenv.config({ path: ".env.local" });

/**
 * One-off backfill for the messaging approval rollout: stamps existing
 * property-scoped threads with the new DM identity fields (participants,
 * pairKey, per-user reads) and marks them as legacy active threads.
 *
 * Idempotent — rows already marked `kind: "legacy-property"` are skipped, so a
 * second run matches 0 documents. Dry-run by default; only --apply writes.
 * Local schemas avoid the `@/` alias under tsx's ESM loader.
 */

const BATCH_SIZE = 100;

const threadSchema = new Schema(
  {
    tenantId: String,
    propertyId: String,
    ownerId: String,
    agentUserId: String,
    agentRole: String,
    tenantLastReadAt: Date,
    agentLastReadAt: Date,
    participants: [String],
    pairKey: String,
    reads: [{ userId: String, lastReadAt: Date, _id: false }],
    kind: String,
    status: String,
  },
  { collection: "chatthreads", timestamps: true },
);

const tenantSchema = new Schema({ userId: String }, { collection: "tenants" });

const USAGE = `Usage: npm run backfill:chat [-- --apply]

Backfills existing chat threads with participants, pairKey, reads and
kind="legacy-property", status="active".

  (no flags)   dry-run: print what would change, write nothing
  --dry-run    explicit dry-run (same as default)
  --apply      write the changes (idempotent)
  --help       show this help

Loads MONGODB_URI from .env.local. Run on the host, never in the app container.`;

interface ThreadRow {
  _id: unknown;
  tenantId?: string;
  ownerId?: string;
  agentUserId?: string;
  tenantLastReadAt?: Date | null;
  agentLastReadAt?: Date | null;
}

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
      ? "🛠  Applying chat approval-state backfill..."
      : "🔍 Chat approval-state backfill dry-run — no writes. Pass --apply to write.",
  );
  console.log(`Target: ${describeTarget(mongoUri)}`);

  await mongoose.connect(mongoUri, {
    bufferCommands: false,
    maxPoolSize: 10,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  });

  const ThreadModel = mongoose.models.ChatThread || mongoose.model("ChatThread", threadSchema);
  const TenantModel = mongoose.models.Tenant || mongoose.model("Tenant", tenantSchema);

  const filter = { kind: { $ne: "legacy-property" } };
  const preflight = await ThreadModel.countDocuments(filter);
  console.log(`Threads pending backfill (preflight): ${preflight}`);
  if (preflight === 0) {
    console.log("Already reconciled — nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const cursor = ThreadModel.find(filter)
    .select("tenantId ownerId agentUserId tenantLastReadAt agentLastReadAt")
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  let batch: ThreadRow[] = [];
  let batchNumber = 0;
  let totalMatched = 0;
  let totalModified = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    batchNumber += 1;
    const rows = batch;
    batch = [];
    let batchModified = 0;

    for (const row of rows) {
      const tenantUserId = row.tenantId
        ? (await TenantModel.findById(row.tenantId).select("userId").lean())?.userId
        : "";
      const participants = [tenantUserId, row.agentUserId, row.ownerId].filter((id): id is string =>
        Boolean(id),
      );
      const unique = [...new Set(participants)];
      const reads = [
        tenantUserId
          ? { userId: tenantUserId, lastReadAt: row.tenantLastReadAt ?? new Date() }
          : null,
        row.agentUserId
          ? { userId: row.agentUserId, lastReadAt: row.agentLastReadAt ?? new Date() }
          : null,
      ].filter((read): read is { userId: string; lastReadAt: Date } => read !== null);
      const key = [...unique].sort().join(":");

      if (!apply) {
        console.log(
          `  would update thread=${String(row._id)} participants=[${unique.join(", ")}] ` +
            `pairKey=${key} reads=${reads.length}`,
        );
        continue;
      }

      const result = await ThreadModel.updateOne(
        { _id: row._id, kind: { $ne: "legacy-property" } },
        {
          $set: {
            participants: unique,
            pairKey: key,
            reads,
            kind: "legacy-property",
            status: "active",
          },
        },
      );
      batchModified += result.modifiedCount;
    }

    totalMatched += rows.length;
    totalModified += batchModified;
    console.log(
      `batch ${batchNumber}: matched ${rows.length}, ` +
        (apply ? `modified ${batchModified}` : `would modify ${rows.length}`),
    );
  };

  for await (const doc of cursor) {
    batch.push(doc as ThreadRow);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(
    `Total: matched ${totalMatched}, ` +
      (apply ? `modified ${totalModified}` : `would modify ${totalMatched}`),
  );

  if (apply) {
    const residual = await ThreadModel.countDocuments(filter);
    if (residual > 0) {
      throw new Error(`Verification failed: ${residual} thread(s) still pending backfill.`);
    }
    console.log("Backfill complete. Residual count: 0.");
  } else {
    console.log("Dry run complete (no changes written).");
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Chat approval-state backfill failed:", sanitize(message));
  await mongoose.disconnect();
  process.exit(1);
});
