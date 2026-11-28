const DEV_FALLBACK_SECRET = "dev-secret";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set");
  }
  return DEV_FALLBACK_SECRET;
}

/** Sessions are signed with HMAC-SHA256 only. */
export const JWT_ALGORITHM = "HS256" as const;

/**
 * Verify options for every session check: only HS256 is accepted, so a
 * token claiming another algorithm (or "none") is rejected outright.
 */
export const JWT_VERIFY_OPTIONS = { algorithms: [JWT_ALGORITHM] };
