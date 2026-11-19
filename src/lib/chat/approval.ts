import type { ChatRequestStatus } from "@/lib/domain-enums";

/**
 * Canonical DM identity for an unordered pair. Both sides compute the same key
 * so dedupe and thread lookup work regardless of who initiated the request.
 */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export function dmKey(key: string): string {
  return `dm:${key}`;
}

/** In-property = both users belong to at least one common property. */
export function requiresApproval(
  requesterPropertyIds: string[],
  recipientPropertyIds: string[],
): boolean {
  const requester = new Set(requesterPropertyIds.filter((id) => id));
  return !recipientPropertyIds.some((id) => id && requester.has(id));
}

/**
 * `pending` is the only non-terminal state. The recipient decides
 * approved/declined; the requester alone may cancel. Callers pass both flags
 * so a single actor can never satisfy both sides of the transition.
 */
export function canTransition(
  from: ChatRequestStatus,
  to: ChatRequestStatus,
  isRecipient: boolean,
  isRequester: boolean,
): boolean {
  if (from !== "pending") return false;
  if (isRecipient && (to === "approved" || to === "declined")) return true;
  if (isRequester && to === "cancelled") return true;
  return false;
}
