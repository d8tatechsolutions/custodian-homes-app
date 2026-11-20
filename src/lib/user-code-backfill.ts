import { generateUserCode, USER_CODE_PATTERN, UserCodeExhaustedError } from "./user-code.ts";

/**
 * Pure planner for the `userCode` backfill (plan §9.5). It performs no I/O and
 * imports no model, so it can be unit-tested without a database and reused by
 * `scripts/backfill-user-codes.ts`.
 *
 * Two behaviours are deliberate and must not be "helpful":
 *
 * - A document whose non-empty `userCode` does not match `USER_CODE_PATTERN` is
 *   reported as `malformed` and **never rewritten**. Overwriting a corrupt row
 *   would destroy the only evidence of how it got there, and a value that no
 *   longer matches the pattern may still be referenced outside this system. The
 *   script refuses the whole run instead (see the runbook).
 * - Codes generated in one plan are distinct from each other *and* from every
 *   valid code present in the input, so a single chunk never collides with
 *   itself. Global uniqueness across the collection is enforced by the
 *   `user_code_unique` index and re-rolled by the caller, not assumed here.
 */

export interface UserCodeBackfillDoc {
  _id: unknown;
  userCode?: string | null;
}

export interface UserCodeBackfillPlan {
  writes: Array<{ _id: unknown; userCode: string }>;
  alreadyCoded: number;
  malformed: Array<{ _id: unknown; userCode: string }>;
}

/**
 * Draws per code before giving up. At 34^6 possible codes a legitimate run
 * never approaches this; hitting it means the injected RNG is degenerate
 * (e.g. a test stub returning a constant), which must fail loudly rather than
 * spin forever.
 */
const MAX_DRAWS_PER_CODE = 100;

function isMissing(userCode: string | null | undefined): boolean {
  return userCode == null || userCode === "";
}

function drawUnusedCode(seen: Set<string>, opts: { random?: (max: number) => number }): string {
  for (let attempt = 0; attempt < MAX_DRAWS_PER_CODE; attempt += 1) {
    const candidate = generateUserCode(opts);
    if (!seen.has(candidate)) return candidate;
  }
  throw new UserCodeExhaustedError(MAX_DRAWS_PER_CODE);
}

export function planUserCodeBackfill(
  docs: Array<{ _id: unknown; userCode?: string | null }>,
  opts: { random?: (max: number) => number } = {},
): UserCodeBackfillPlan {
  const seen = new Set<string>();
  const pending: Array<{ _id: unknown }> = [];
  const malformed: Array<{ _id: unknown; userCode: string }> = [];
  let alreadyCoded = 0;

  for (const doc of docs) {
    const current = doc.userCode;

    if (isMissing(current)) {
      pending.push({ _id: doc._id });
      continue;
    }

    // A non-string value is corrupt in exactly the same way as a bad string:
    // report it, never rewrite it.
    if (typeof current === "string" && USER_CODE_PATTERN.test(current)) {
      alreadyCoded += 1;
      seen.add(current);
      continue;
    }

    malformed.push({
      _id: doc._id,
      userCode: typeof current === "string" ? current : String(current),
    });
  }

  const writes = pending.map((doc) => {
    const userCode = drawUnusedCode(seen, opts);
    seen.add(userCode);
    return { _id: doc._id, userCode };
  });

  return { writes, alreadyCoded, malformed };
}
