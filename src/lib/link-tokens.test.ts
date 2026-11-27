import { describe, expect, it } from "vitest";

import { hashLinkToken, storedLinkTokenMatch } from "@/lib/link-tokens";

describe("link tokens", () => {
  it("stores a fingerprint, never the token itself", () => {
    const token = "6f1c2a3b-0000-4000-8000-000000000000";
    const stored = hashLinkToken(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
    expect(hashLinkToken(token)).toBe(stored);
    expect(hashLinkToken(`${token}x`)).not.toBe(stored);
  });

  it("matches new hashed links and older plain-text links", () => {
    const token = "tok-123";
    expect(storedLinkTokenMatch(token)).toEqual({ $in: [hashLinkToken(token), token] });
  });
});
