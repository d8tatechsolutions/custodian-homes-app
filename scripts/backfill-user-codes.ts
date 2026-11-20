import dotenv from "dotenv";
import mongoose, { Schema } from "mongoose";
import {
  generateUserCode,
  USER_CODE_PATTERN,
  UserCodeExhaustedError,
} from "../src/lib/user-code.ts";
import { planUserCodeBackfill } from "../src/lib/user-code-backfill.ts";

dotenv.config({ path: ".env.local" });

/**
 * One-off backfill for `users.userCode` (plan §5.5, §9.5).
 *
 * Every user created after the rollout receives a code from the model hook or
 * the retry wrapper; this script covers the documents that predate it. Each
 * document needs a *different* value, so unlike
 * `scripts/backfill-task-permissions.ts` (one `updateMany` per batch) the write
 * is a chunked `bulkWrite` of per-document `updateOne`s.
 *
 * Safety:
 * - Dry-run by default; only `--apply` writes.
 * - The selection filter matches missing, empty and null: those are the three
 *   states that sit *outside* the partial unique index. It is the complement of
 *   the lookup filter in `src/lib/user-code.ts` on purpose — do not unify them.
 * - Every write re-guards on the same predicate, so a document coded by a
 *   concurrent writer between the cursor read and the write is a no-op, never
 *   an overwrite.
 * - `ordered: false` still rejects with a `MongoBulkWriteError`; the rejection
 *   is mapped back to the offending chunk candidates and *only* `userCode`
 *   duplicates are re-rolled. An `email`/`phone` duplicate aborts the run.
 * - Documents holding a non-empty, pattern-violating `userCode` are corrupt:
 *   they are printed and the run exits non-zero before any write happens.
 * - Idempotent: a second run matches 0 documents and exits 0 without writing.
 * - No upserts. Only `userCode` is set.
 *
 * The schema is declared locally (the app model is not imported) so the script
 * runs under tsx without the `@/` path alias and never triggers the model's
 * `pre("validate")` hook. Run on the host, never inside the app container (the
 * compose image ships no tsx).
 */

const BATCH_SIZE = 100;
const CHUNK_SIZE = 500;
const MAX_COLLISION_ATTEMPTS = 5;
const MAX_CODE_DRAWS = 100;
const MALFORMED_SAMPLE_LIMIT = 50;
const USER_CODE_INDEX_NAME = "user_code_unique";

const backfillUserSchema = new Schema({ userCode: { type: String } }, { collection: "users" });

interface BackfillUserDoc {
  userCode?: string | null;
}

interface MissingCodeRow {
  _id: unknown;
  userCode?: string | null;
}

interface PlannedWrite {
  _id: unknown;
  userCode: string;
}

/** Documents that must receive a code: outside the partial unique index. */
const MISSING_CODE_FILTER = {
  $or: [{ userCode: { $exists: false } }, { userCode: "" }, { userCode: null }],
};

/**
 * Documents that already hold a value but not a valid one. `$not` on a regex
 * also matches a missing field and a non-string, so `$exists` plus the two
 * `$ne`s narrow it to "present, non-empty, wrong shape".
 */
const MALFORMED_FILTER = {
  $and: [
    { userCode: { $exists: true } },
    { userCode: { $ne: null } },
    { userCode: { $ne: "" } },
    { userCode: { $not: USER_CODE_PATTERN } },
  ],
};

const USAGE = `Usage: npm run backfill:user-codes [-- --apply]

Assigns a unique CXXXXXX userCode to every users document that has none
(missing, empty string or null). Documents already holding a valid code are
left untouched; documents holding a malformed code abort the run.

  (no flags)   dry-run: print the plan, write nothing
  --dry-run    explicit dry-run (same as the default)
  --apply      write the codes (idempotent, write-guarded, collision re-rolled)
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

interface BulkWriteFailure {
  index?: number;
  code?: number;
  errmsg?: string;
  keyPattern?: Record<string, unknown>;
  err?: { keyPattern?: Record<string, unknown> };
}

interface BulkWriteRejection {
  failures: BulkWriteFailure[];
  matchedCount: number;
  modifiedCount: number;
  keyPattern?: Record<string, unknown>;
}

function keyPatternNamesUserCode(keyPattern: Record<string, unknown> | undefined): boolean {
  return Boolean(keyPattern?.userCode);
}

/**
 * The driver does not always keep `keyPattern` on a bulk write error: verified
 * against mongod 8.0.26 with mongodb 7.5.0, `writeErrors[i].err` carries only
 * `index`/`code`/`errmsg`/`op` and the top-level `keyPattern` is undefined.
 * The server message still names the index and the duplicated field, so that
 * is the fallback discriminator. It is still a strict discriminator: an
 * `email`/`phone` duplicate names `email_1`/`phone_1` and never matches.
 */
function failureIsUserCodeCollision(
  failure: BulkWriteFailure,
  topLevelKeyPattern: Record<string, unknown> | undefined,
): boolean {
  if (failure.code !== 11000) return false;
  if (keyPatternNamesUserCode(failure.keyPattern)) return true;
  if (keyPatternNamesUserCode(failure.err?.keyPattern)) return true;
  if (keyPatternNamesUserCode(topLevelKeyPattern)) return true;

  const message = failure.errmsg ?? "";
  return (
    message.includes(`index: ${USER_CODE_INDEX_NAME}`) || /dup key: \{ ?userCode:/.test(message)
  );
}

function readBulkWriteRejection(error: unknown): BulkWriteRejection | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    writeErrors?: BulkWriteFailure[] | BulkWriteFailure;
    result?: { matchedCount?: number; modifiedCount?: number };
  };

  if (candidate.code !== 11000) return null;
  const raw = candidate.writeErrors;
  if (!raw) return null;

  const failures = Array.isArray(raw) ? raw : [raw];
  if (failures.length === 0) return null;

  return {
    failures,
    matchedCount: candidate.result?.matchedCount ?? 0,
    modifiedCount: candidate.result?.modifiedCount ?? 0,
    keyPattern: candidate.keyPattern,
  };
}

/** Single-document variant of the same check (used by the re-roll pass). */
function isUserCodeDuplicateError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    errmsg?: string;
  };
  if (candidate.code !== 11000) return false;

  return failureIsUserCodeCollision(
    { code: candidate.code, errmsg: candidate.errmsg, keyPattern: candidate.keyPattern },
    undefined,
  );
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
      ? "[user-code] Applying user-code backfill..."
      : "[user-code] User-code backfill dry-run — no writes. Pass --apply to write.",
  );
  console.log(`[user-code] Target: ${describeTarget(mongoUri)}`);

  await mongoose.connect(mongoUri, {
    bufferCommands: false,
    maxPoolSize: 10,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  });

  const existing = mongoose.models.BackfillUser as mongoose.Model<BackfillUserDoc> | undefined;
  const UserModel = existing ?? mongoose.model<BackfillUserDoc>("BackfillUser", backfillUserSchema);

  const malformedCount = await UserModel.countDocuments(MALFORMED_FILTER);
  if (malformedCount > 0) {
    const samples = (await UserModel.find(MALFORMED_FILTER)
      .select("_id userCode")
      .limit(MALFORMED_SAMPLE_LIMIT)
      .lean()) as unknown as MissingCodeRow[];

    console.error(
      `[user-code] malformed userCode on ${malformedCount} document(s) — refusing to write.`,
    );
    for (const row of samples) {
      console.error(
        `[user-code] malformed row=${String(row._id)} userCode=${JSON.stringify(row.userCode)}`,
      );
    }
    if (malformedCount > samples.length) {
      console.error(
        `[user-code] … ${malformedCount - samples.length} more not shown (limit ${MALFORMED_SAMPLE_LIMIT}).`,
      );
    }
    console.error(
      "[user-code] Fix or clear these values deliberately before re-running. Nothing was written.",
    );
    return 1;
  }

  const preflight = await UserModel.countDocuments(MISSING_CODE_FILTER);
  console.log(`[user-code] users missing userCode (preflight): ${preflight}`);
  if (preflight === 0) {
    console.log("[user-code] Already complete — nothing to do.");
    return 0;
  }

  const cursor = UserModel.find(MISSING_CODE_FILTER)
    .select("_id userCode")
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  const usedCodes = new Set<string>();
  let chunk: MissingCodeRow[] = [];
  let batchNumber = 0;
  let totalMatched = 0;
  let totalModified = 0;

  const drawUnusedCode = (): string => {
    for (let attempt = 0; attempt < MAX_CODE_DRAWS; attempt += 1) {
      const candidate = generateUserCode();
      if (!usedCodes.has(candidate)) return candidate;
    }
    throw new UserCodeExhaustedError(MAX_CODE_DRAWS);
  };

  /**
   * Re-rolls only the operations the server rejected for `userCode`, one
   * document at a time so each attempt can be attributed and logged. A
   * duplicate on any other index rethrows and aborts the run.
   */
  const rerollCollisions = async (
    writes: PlannedWrite[],
    indexes: number[],
  ): Promise<{ matched: number; modified: number }> => {
    let matched = 0;
    let modified = 0;

    for (const index of indexes) {
      const write = writes[index];
      if (!write) {
        throw new Error(`Collision index ${index} does not map to a planned write.`);
      }

      let written = false;
      for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
        const userCode = drawUnusedCode();
        usedCodes.add(userCode);
        try {
          const result = await UserModel.updateOne(
            { _id: write._id, ...MISSING_CODE_FILTER },
            { $set: { userCode } },
          );
          matched += result.matchedCount;
          modified += result.modifiedCount;
          written = true;
          break;
        } catch (error) {
          if (!isUserCodeDuplicateError(error)) throw error;
          console.warn(`[user-code] collision row=${String(write._id)} attempt=${attempt}`);
        }
      }

      if (!written) {
        throw new UserCodeExhaustedError(MAX_COLLISION_ATTEMPTS);
      }
    }

    return { matched, modified };
  };

  const executeWrites = async (
    writes: PlannedWrite[],
  ): Promise<{ matched: number; modified: number }> => {
    if (writes.length === 0) return { matched: 0, modified: 0 };
    for (const write of writes) usedCodes.add(write.userCode);

    const operations = writes.map((write) => ({
      updateOne: {
        filter: { _id: write._id, ...MISSING_CODE_FILTER },
        update: { $set: { userCode: write.userCode } },
      },
    }));

    let matched = 0;
    let modified = 0;
    let collisions: number[] = [];

    try {
      const result = await UserModel.bulkWrite(operations, { ordered: false });
      matched = result.matchedCount;
      modified = result.modifiedCount;
    } catch (error) {
      const rejection = readBulkWriteRejection(error);
      if (!rejection) throw error;

      const userCodeFailures = rejection.failures.filter((failure) =>
        failureIsUserCodeCollision(failure, rejection.keyPattern),
      );
      if (userCodeFailures.length !== rejection.failures.length) {
        const foreign = rejection.failures.filter(
          (failure) => !failureIsUserCodeCollision(failure, rejection.keyPattern),
        );
        throw new Error(
          `Aborting: ${foreign.length} non-userCode write error(s) in this chunk — ` +
            `first: ${foreign[0]?.errmsg ?? "unknown"}. Nothing was re-rolled.`,
        );
      }

      matched = rejection.matchedCount;
      modified = rejection.modifiedCount;
      collisions = userCodeFailures.map((failure) => failure.index ?? -1);
      console.warn(
        `[user-code] batch collisions: ${collisions.length} userCode duplicate(s) — re-rolling`,
      );
    }

    if (collisions.length > 0) {
      const rerolled = await rerollCollisions(writes, collisions);
      matched += rerolled.matched;
      modified += rerolled.modified;
    }

    return { matched, modified };
  };

  const flush = async (): Promise<void> => {
    if (chunk.length === 0) return;
    batchNumber += 1;
    const rows = chunk;
    chunk = [];

    const plan = planUserCodeBackfill(rows);
    if (plan.malformed.length > 0) {
      // Unreachable through the cursor filter; kept as a hard stop rather than
      // silently dropping a corrupt row.
      throw new Error(
        `Validation failed: ${plan.malformed.length} chunk row(s) hold a malformed userCode. ` +
          "Refusing to write.",
      );
    }

    if (!apply) {
      for (const write of plan.writes) {
        console.log(`[user-code] would set row=${String(write._id)} code=${write.userCode}`);
      }
      totalMatched += plan.writes.length;
      console.log(
        `[user-code] batch ${batchNumber}: matched ${plan.writes.length}, would modify ${plan.writes.length}`,
      );
      return;
    }

    const result = await executeWrites(plan.writes);
    totalMatched += result.matched;
    totalModified += result.modified;
    console.log(
      `[user-code] batch ${batchNumber}: matched ${result.matched}, modified ${result.modified}`,
    );
  };

  for await (const doc of cursor) {
    chunk.push(doc as unknown as MissingCodeRow);
    if (chunk.length >= CHUNK_SIZE) await flush();
  }
  await flush();

  console.log(
    `[user-code] total: matched ${totalMatched}, ` +
      (apply ? `modified ${totalModified}` : `would modify ${totalMatched}`),
  );

  if (apply) {
    const residual = await UserModel.countDocuments(MISSING_CODE_FILTER);
    if (residual > 0) {
      throw new Error(`Verification failed: ${residual} users still missing userCode`);
    }
    console.log("[user-code] residual users missing userCode: 0");
    console.log("[user-code] Backfill complete.");
  } else {
    console.log("[user-code] Dry run complete (no changes written).");
  }

  return 0;
}

main()
  .then(async (exitCode) => {
    await mongoose.disconnect();
    process.exitCode = exitCode;
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[user-code] Backfill failed:", sanitize(message));
    await mongoose.disconnect();
    process.exitCode = 1;
  });
