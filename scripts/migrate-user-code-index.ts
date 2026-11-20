import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: ".env.local" });

/**
 * Creates the `user_code_unique` index on `users` (plan §9.1, §9.4).
 *
 * Why a script and not the model: `autoIndex` is implicitly true and
 * fire-and-forget (`Model.init().catch(() => {})`), so deploying the schema is
 * itself an index-build event. The index must exist *before* the code that
 * issues codes ships (§9.2), and it must be created explicitly so the rollout
 * is a deliberate, verifiable step rather than a side effect.
 *
 * Mechanism rules — all three verified on a live mongod:
 * - `db.collection("users").createIndex(spec)` only.
 * - **Never `syncIndexes()`**: it plans `toDrop: ["role_1_isActive_1",
 *   "phone_1", "email_1"]` on this collection because those indexes are not
 *   declared in this script's (empty) schema. Dropping them on a live users
 *   collection is an outage.
 * - **Never `User.createIndexes()`**: it re-issues every model index and throws
 *   code 86 on any drift.
 *
 * The index name is mandatory. MongoDB treats the same key pattern under a
 * different name as a *different* index and creates it silently — doubled write
 * cost on the hottest path with no error anywhere. The post-apply assertion
 * below fails the run if more than one index matches the key pattern.
 */

const COLLECTION = "users";
const INDEX_NAME = "user_code_unique";
const INDEX_KEY = { userCode: 1 };
const INDEX_OPTIONS = {
  unique: true,
  name: INDEX_NAME,
  partialFilterExpression: { userCode: { $gt: "" } },
};

const USAGE = `Usage: npm run migrate:user-code-index [-- --apply]

Creates the partial unique index users.user_code_unique ({ userCode: 1 },
unique, partialFilterExpression: { userCode: { $gt: "" } }).

  (no flags)   dry-run: report the existing indexes and what would be created
  --dry-run    explicit dry-run (same as the default)
  --apply      create the index and assert the result
  --help       show this help

Loads MONGODB_URI from .env.local. Run on the host, never in the app container.`;

interface IndexInfo {
  name?: string;
  key: Record<string, unknown>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

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

function isNamespaceNotFound(error: unknown): boolean {
  return Boolean(error) && (error as { code?: number }).code === 26;
}

function isUserCodeKey(key: Record<string, unknown>): boolean {
  const keys = Object.keys(key);
  return keys.length === 1 && key.userCode === 1;
}

function matchesSpec(index: IndexInfo): boolean {
  return (
    index.name === INDEX_NAME &&
    index.unique === true &&
    JSON.stringify(index.partialFilterExpression ?? null) ===
      JSON.stringify(INDEX_OPTIONS.partialFilterExpression)
  );
}

function describeIndex(index: IndexInfo): string {
  const flags = [
    index.unique ? "unique" : null,
    index.partialFilterExpression ? "partial" : null,
  ].filter(Boolean);
  const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `  ${index.name ?? "(unnamed)"}: ${JSON.stringify(index.key)}${suffix}`;
}

function printIndexes(indexes: IndexInfo[]): void {
  console.log(`[user-code] ${COLLECTION}: ${indexes.length} index(es)`);
  for (const index of indexes) console.log(describeIndex(index));
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const known = new Set(["--apply", "--dry-run", "--help"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(", ")}\n\n${USAGE}`);
    return 1;
  }
  if (args.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) {
    console.error("--apply and --dry-run are mutually exclusive.");
    return 1;
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("Missing MONGODB_URI environment variable (checked .env.local).");
  }

  console.log(
    apply
      ? "[user-code] Creating users.user_code_unique..."
      : "[user-code] Index migration dry-run — no writes. Pass --apply to create.",
  );
  console.log(`[user-code] Target: ${describeTarget(mongoUri)}`);

  await mongoose.connect(mongoUri, {
    bufferCommands: false,
    maxPoolSize: 10,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  });

  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle after connect.");
  const users = db.collection(COLLECTION);

  const readIndexes = async (): Promise<IndexInfo[]> => {
    try {
      return (await users.indexes()) as unknown as IndexInfo[];
    } catch (error) {
      // NamespaceNotFound: the collection does not exist yet (empty database).
      if (isNamespaceNotFound(error)) return [];
      throw error;
    }
  };

  const before = await readIndexes();
  printIndexes(before);

  const sameKey = before.filter((index) => isUserCodeKey(index.key));
  const duplicates = sameKey.filter((index) => index.name !== INDEX_NAME);
  if (duplicates.length > 0) {
    console.error(
      `[user-code] refusing to continue: ${duplicates.length} index(es) already use the ` +
        `{ userCode: 1 } key pattern under another name (${duplicates
          .map((index) => index.name ?? "(unnamed)")
          .join(", ")}). Creating ${INDEX_NAME} would silently add a duplicate. ` +
        "Drop the stray index deliberately, then re-run.",
    );
    return 1;
  }

  const existingNamed = sameKey.find((index) => index.name === INDEX_NAME);
  if (existingNamed) {
    if (!matchesSpec(existingNamed)) {
      console.error(
        `[user-code] ${INDEX_NAME} exists but does not match the required spec ` +
          `(unique: true, partialFilterExpression: ${JSON.stringify(
            INDEX_OPTIONS.partialFilterExpression,
          )}). Refusing to continue; drop and recreate it deliberately.`,
      );
      return 1;
    }
    console.log(`[user-code] ${INDEX_NAME} already present and matches the spec — nothing to do.`);
    return 0;
  }

  if (!apply) {
    console.log(
      `[user-code] would create ${INDEX_NAME}: ${JSON.stringify(INDEX_KEY)} ` +
        `unique partial ${JSON.stringify(INDEX_OPTIONS.partialFilterExpression)}`,
    );
    console.log("[user-code] Dry run complete (no changes written).");
    return 0;
  }

  await users.createIndex(INDEX_KEY, INDEX_OPTIONS);
  console.log(`[user-code] createIndex(${INDEX_NAME}) returned.`);

  const after = await readIndexes();
  printIndexes(after);

  const matching = after.filter((index) => isUserCodeKey(index.key));
  if (matching.length !== 1) {
    throw new Error(
      `Verification failed: expected exactly 1 index with key { userCode: 1 }, found ${matching.length}.`,
    );
  }

  const created = matching[0];
  if (!created || !matchesSpec(created)) {
    throw new Error(
      `Verification failed: ${INDEX_NAME} does not match the required spec ` +
        `(got ${JSON.stringify(created)}).`,
    );
  }

  console.log(`[user-code] ${INDEX_NAME} verified: unique, partial, single key-pattern match.`);
  console.log("[user-code] Migration complete.");
  return 0;
}

main()
  .then(async (exitCode) => {
    await mongoose.disconnect();
    process.exitCode = exitCode;
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[user-code] Index migration failed:", sanitize(message));
    await mongoose.disconnect();
    process.exitCode = 1;
  });
