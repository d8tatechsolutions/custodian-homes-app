import { createHash } from "node:crypto";

/**
 * Email links (verification, invites, password reset) carry a random token. Only
 * its SHA-256 fingerprint is stored, so someone who reads the database cannot
 * use a pending link. The emailed link keeps the plain token.
 */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Matches a token from a link against the stored value. Links sent before
 * hashing was introduced were stored as plain text; they still match until they
 * expire (24 hours at most), so no link already in someone's inbox breaks.
 */
export function storedLinkTokenMatch(token: string): { $in: string[] } {
  return { $in: [hashLinkToken(token), token] };
}
