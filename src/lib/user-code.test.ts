/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateUserCode,
  isUserCode,
  normalizeUserCode,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  USER_CODE_MAX_ATTEMPTS,
  USER_CODE_PATTERN,
  USER_CODE_PREFIX,
  UserCodeExhaustedError,
  userCodeLookupFilter,
  withUserCodeRetry,
} from "@/lib/user-code";

const DRAWS = 10_000;
const ALPHABET = USER_CODE_ALPHABET.split("");

/** Small deterministic PRNG so an injected RNG can be replayed exactly. */
function seededRandom(seed: number): (max: number) => number {
  let state = seed >>> 0;
  return (max: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const fraction = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    return Math.floor(fraction * max);
  };
}

function duplicateKeyError(keyPattern: Record<string, number>): Error {
  return Object.assign(new Error("E11000 duplicate key error"), {
    code: 11000,
    keyPattern,
  });
}

describe("user code constants", () => {
  it("uses C plus six symbols from a 34-symbol alphabet without I or O", () => {
    expect(USER_CODE_PREFIX).toBe("C");
    expect(USER_CODE_LENGTH).toBe(6);
    expect(USER_CODE_ALPHABET).toHaveLength(34);
    expect(USER_CODE_ALPHABET).not.toContain("I");
    expect(USER_CODE_ALPHABET).not.toContain("O");
    expect(USER_CODE_MAX_ATTEMPTS).toBe(5);
    expect(USER_CODE_PATTERN.source).toBe("^C[0-9A-HJ-NP-Z]{6}$");
  });
});

describe("generateUserCode", () => {
  it("always produces seven uppercase characters starting with C", () => {
    for (let index = 0; index < 500; index += 1) {
      const code = generateUserCode();
      expect(code).toHaveLength(7);
      expect(code.startsWith(USER_CODE_PREFIX)).toBe(true);
      expect(code).toMatch(USER_CODE_PATTERN);
      expect(code).toBe(code.toUpperCase());
    }
  });

  it("only emits symbols from USER_CODE_ALPHABET", () => {
    for (let index = 0; index < 500; index += 1) {
      const code = generateUserCode();
      for (const char of code.slice(USER_CODE_PREFIX.length)) {
        expect(ALPHABET).toContain(char);
      }
    }
  });

  it("never emits I or O", () => {
    for (let index = 0; index < 2_000; index += 1) {
      const code = generateUserCode();
      expect(code).not.toContain("I");
      expect(code).not.toContain("O");
    }
  });

  it("emits no punctuation and stays uppercase", () => {
    for (let index = 0; index < 500; index += 1) {
      const code = generateUserCode();
      expect(code).toMatch(/^[A-Z0-9]{7}$/);
    }
  });

  it("rarely repeats a code over 10,000 draws", () => {
    // 34^6 ≈ 1.5 billion codes, so 10,000 random draws contain one repeat about
    // 3% of the time (birthday paradox); requiring zero made this test fail at
    // random. Real repeats are caught by the unique index and retried. More
    // than 3 repeats has odds of about 1 in 20 million, so this still fails if
    // the generator stops being random.
    const codes = new Set<string>();
    for (let index = 0; index < DRAWS; index += 1) {
      codes.add(generateUserCode());
    }
    expect(DRAWS - codes.size).toBeLessThanOrEqual(3);
  });

  it("uses every alphabet symbol over 10,000 draws", () => {
    const seen = new Set<string>();
    for (let index = 0; index < DRAWS; index += 1) {
      for (const char of generateUserCode().slice(USER_CODE_PREFIX.length)) {
        seen.add(char);
      }
    }
    for (const symbol of ALPHABET) {
      expect(seen.has(symbol)).toBe(true);
    }
  });

  it("is deterministic when the RNG is injected", () => {
    const first = generateUserCode({ random: seededRandom(2026) });
    const second = generateUserCode({ random: seededRandom(2026) });
    expect(first).toBe(second);
    expect(first).toMatch(USER_CODE_PATTERN);
  });

  it("handles the boundary RNG values 0 and max-1", () => {
    const lowest = generateUserCode({ random: () => 0 });
    const highest = generateUserCode({ random: (max) => max - 1 });

    expect(lowest).toBe("C000000");
    expect(highest).toBe("CZZZZZZ");
    expect(isUserCode(lowest)).toBe(true);
    expect(isUserCode(highest)).toBe(true);
  });
});

describe("normalizeUserCode / isUserCode", () => {
  it("trims and uppercases input", () => {
    expect(normalizeUserCode(" cabcde1 ")).toBe("CABCDE1");
    expect(normalizeUserCode("CABCDE1")).toBe("CABCDE1");
    expect(normalizeUserCode("\t c0abc12\n")).toBe("C0ABC12");
  });

  it("accepts well-formed codes", () => {
    expect(isUserCode("CABCDEF")).toBe(true);
    expect(isUserCode("C0ABC12")).toBe(true);
    expect(isUserCode("C123456")).toBe(true);
  });

  it("normalises before matching, so lowercase input is valid", () => {
    expect(isUserCode("cabcde1")).toBe(true);
    expect(isUserCode("c123456")).toBe(true);
    expect(isUserCode(" c0abc12 ")).toBe(true);
  });

  it("rejects a wrong prefix, wrong length, or excluded letters", () => {
    expect(isUserCode("X123456")).toBe(false);
    expect(isUserCode("C12345")).toBe(false);
    expect(isUserCode("C1234567")).toBe(false);
    expect(isUserCode("CI23456")).toBe(false);
    expect(isUserCode("CO23456")).toBe(false);
    expect(isUserCode("")).toBe(false);
    expect(isUserCode("   ")).toBe(false);
    expect(isUserCode("C-12345")).toBe(false);
  });
});

describe("userCodeLookupFilter", () => {
  it("normalises and carries both index predicates", () => {
    expect(userCodeLookupFilter(" cabcde1 ")).toEqual({
      userCode: { $eq: "CABCDE1", $gt: "" },
    });
  });
});

describe("withUserCodeRetry", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds on the first attempt", async () => {
    const attempt = vi.fn(async (code: string) => `created:${code}`);
    const result = await withUserCodeRetry(attempt);

    expect(result).toMatch(/^created:C[0-9A-HJ-NP-Z]{6}$/);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("retries when the duplicate key is on userCode", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(duplicateKeyError({ userCode: 1 }))
      .mockResolvedValueOnce("ok");

    await expect(withUserCodeRetry(attempt)).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith("[user-code] collision retry", { attempt: 1 });
  });

  it("rethrows a duplicate key on email immediately", async () => {
    const error = duplicateKeyError({ email: 1 });
    const attempt = vi.fn().mockRejectedValue(error);

    await expect(withUserCodeRetry(attempt)).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("rethrows a duplicate key on phone immediately", async () => {
    const error = duplicateKeyError({ phone: 1 });
    const attempt = vi.fn().mockRejectedValue(error);

    await expect(withUserCodeRetry(attempt)).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("rethrows a duplicate key without a keyPattern immediately", async () => {
    const error = Object.assign(new Error("E11000"), { code: 11000 });
    const attempt = vi.fn().mockRejectedValue(error);

    await expect(withUserCodeRetry(attempt)).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-duplicate error immediately", async () => {
    const error = new Error("network down");
    const attempt = vi.fn().mockRejectedValue(error);

    await expect(withUserCodeRetry(attempt)).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("throws UserCodeExhaustedError after exactly five attempts", async () => {
    const attempt = vi.fn().mockRejectedValue(duplicateKeyError({ userCode: 1 }));

    const error = await withUserCodeRetry(attempt).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(UserCodeExhaustedError);
    expect((error as UserCodeExhaustedError).name).toBe("UserCodeExhaustedError");
    expect((error as UserCodeExhaustedError).attempts).toBe(USER_CODE_MAX_ATTEMPTS);
    expect(attempt).toHaveBeenCalledTimes(USER_CODE_MAX_ATTEMPTS);
    // Four retries follow the first collision; the fifth failure is terminal.
    expect(console.warn).toHaveBeenCalledTimes(USER_CODE_MAX_ATTEMPTS - 1);
  });

  it("never reuses a candidate within one call", async () => {
    const codes: string[] = [];
    const attempt = vi.fn(async (code: string) => {
      codes.push(code);
      throw duplicateKeyError({ userCode: 1 });
    });

    await expect(withUserCodeRetry(attempt)).rejects.toBeInstanceOf(UserCodeExhaustedError);

    expect(codes).toHaveLength(USER_CODE_MAX_ATTEMPTS);
    expect(new Set(codes).size).toBe(USER_CODE_MAX_ATTEMPTS);
  });
});
