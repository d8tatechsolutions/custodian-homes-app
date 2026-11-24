/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptField, decryptFieldOrEmpty, encryptField, isEncrypted } from "@/lib/crypto";

const originalKey = process.env.FIELD_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.FIELD_ENCRYPTION_KEY;
  } else {
    process.env.FIELD_ENCRYPTION_KEY = originalKey;
  }
});

describe("field-level encryption", () => {
  it("round-trips a value", () => {
    const encrypted = encryptField("12345678");
    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toContain("12345678");
    expect(decryptField(encrypted)).toBe("12345678");
  });

  it("uses a fresh nonce so the same input yields different ciphertexts", () => {
    expect(encryptField("AB123")).not.toBe(encryptField("AB123"));
  });

  it("passes empty strings through untouched", () => {
    expect(encryptField("")).toBe("");
    expect(decryptField("")).toBe("");
  });

  it("is idempotent for already-encrypted values", () => {
    const encrypted = encryptField("AB123");
    expect(encryptField(encrypted)).toBe(encrypted);
  });

  it("returns legacy plaintext unchanged on decrypt", () => {
    expect(isEncrypted("12345678")).toBe(false);
    expect(decryptField("12345678")).toBe("12345678");
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptField("enc:v1:not-base64!!")).toThrow();
  });

  it("honours a base64 FIELD_ENCRYPTION_KEY", () => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(decryptField(encryptField("AB123"))).toBe("AB123");
  });

  it("honours a hex FIELD_ENCRYPTION_KEY", () => {
    process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
    expect(decryptField(encryptField("AB123"))).toBe("AB123");
  });

  it("rejects a key of the wrong length", () => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptField("AB123")).toThrow(/32 bytes/);
  });
});

describe("decryptFieldOrEmpty", () => {
  it("decrypts a value written under the current key", () => {
    expect(decryptFieldOrEmpty(encryptField("AB123"))).toBe("AB123");
  });

  it("passes plaintext and empty values through", () => {
    expect(decryptFieldOrEmpty("12345678")).toBe("12345678");
    expect(decryptFieldOrEmpty("")).toBe("");
  });

  it("returns an empty string for a value written under a different key", () => {
    process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
    const foreign = encryptField("AB123");
    process.env.FIELD_ENCRYPTION_KEY = "b".repeat(64);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(decryptFieldOrEmpty(foreign)).toBe("");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("still throws when the key itself is misconfigured", () => {
    const value = encryptField("AB123");
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => decryptFieldOrEmpty(value)).toThrow(/32 bytes/);
  });
});
