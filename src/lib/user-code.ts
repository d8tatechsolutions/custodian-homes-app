import crypto from "node:crypto";

/**
 * Pure user-code helpers. This module intentionally has no `@/` imports and no
 * model access so it can be imported from standalone scripts (e.g.
 * `scripts/wipe-and-reseed.ts`) without pulling in the app's DB layer.
 */

export const USER_CODE_PREFIX = "C";
export const USER_CODE_LENGTH = 6;
// `0-9A-Z` minus `I` and `O` — the two characters most often misread in support.
export const USER_CODE_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const USER_CODE_PATTERN = /^C[0-9A-HJ-NP-Z]{6}$/;
export const USER_CODE_MAX_ATTEMPTS = 5;

export class UserCodeExhaustedError extends Error {
  /** Number of generation attempts spent before giving up. */
  readonly attempts: number;

  constructor(attempts: number) {
    super(`Unable to allocate a unique user code after ${attempts} attempts`);
    this.name = "UserCodeExhaustedError";
    this.attempts = attempts;
  }
}

/** Returns a code of the form `C` + six symbols from `USER_CODE_ALPHABET`. */
export function generateUserCode(opts: { random?: (max: number) => number } = {}): string {
  const random = opts.random ?? ((max: number) => crypto.randomInt(max));
  let code = USER_CODE_PREFIX;
  for (let index = 0; index < USER_CODE_LENGTH; index += 1) {
    code += USER_CODE_ALPHABET[random(USER_CODE_ALPHABET.length)];
  }
  return code;
}

/** Canonical storage/lookup form: trimmed and uppercased. */
export function normalizeUserCode(input: string): string {
  return input.trim().toUpperCase();
}

/** Full-match validation; normalises before matching so input case is irrelevant. */
export function isUserCode(input: string): boolean {
  return USER_CODE_PATTERN.test(normalizeUserCode(input));
}

/**
 * Index-friendly lookup filter. Carries the explicit `$gt: ""` predicate so the
 * partial index is provably usable on any MongoDB version, and normalises so a
 * caller cannot query an unnormalised value.
 */
export function userCodeLookupFilter(code: string): { userCode: { $eq: string; $gt: string } } {
  return { userCode: { $eq: normalizeUserCode(code), $gt: "" } };
}

interface DuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, unknown>;
}

function isUserCodeCollision(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as DuplicateKeyError;
  return candidate.code === 11000 && Boolean(candidate.keyPattern?.userCode);
}

const MAX_REDRAWS = 100;

function drawUnseenCode(seen: Set<string>): string {
  for (let attempt = 0; attempt < MAX_REDRAWS; attempt += 1) {
    const candidate = generateUserCode();
    if (!seen.has(candidate)) return candidate;
  }
  throw new UserCodeExhaustedError(USER_CODE_MAX_ATTEMPTS);
}

/**
 * Runs `attempt` with a fresh candidate code, retrying only on a duplicate-key
 * error whose `keyPattern` names `userCode`. A duplicate on `email`/`phone` is
 * rethrown immediately so an unrelated collision cannot spin the loop.
 */
export async function withUserCodeRetry<T>(attempt: (code: string) => Promise<T>): Promise<T> {
  const seen = new Set<string>();

  for (let attemptNumber = 1; attemptNumber <= USER_CODE_MAX_ATTEMPTS; attemptNumber += 1) {
    const code = drawUnseenCode(seen);
    seen.add(code);
    try {
      return await attempt(code);
    } catch (error) {
      if (!isUserCodeCollision(error)) throw error;
      if (attemptNumber < USER_CODE_MAX_ATTEMPTS) {
        console.warn("[user-code] collision retry", { attempt: attemptNumber });
      }
    }
  }

  throw new UserCodeExhaustedError(USER_CODE_MAX_ATTEMPTS);
}
