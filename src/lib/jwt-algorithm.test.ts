/** @vitest-environment node */
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { getJwtSecret, JWT_ALGORITHM, JWT_VERIFY_OPTIONS } from "@/lib/jwt";

describe("session token algorithm", () => {
  const secret = getJwtSecret();

  it("accepts HS256, which existing sessions use (the library default)", () => {
    const token = jwt.sign({ userId: "u1" }, secret);
    expect(jwt.decode(token, { complete: true })?.header.alg).toBe(JWT_ALGORITHM);
    expect(jwt.verify(token, secret, JWT_VERIFY_OPTIONS)).toMatchObject({ userId: "u1" });
  });

  it("rejects a token signed with another algorithm", () => {
    const token = jwt.sign({ userId: "u1" }, secret, { algorithm: "HS512" });
    expect(() => jwt.verify(token, secret, JWT_VERIFY_OPTIONS)).toThrow();
  });

  it("rejects an unsigned token (alg none)", () => {
    const encode = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ userId: "u1" })}.`;
    expect(() => jwt.verify(token, secret, JWT_VERIFY_OPTIONS)).toThrow();
  });
});
