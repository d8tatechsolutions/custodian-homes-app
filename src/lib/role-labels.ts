/**
 * What users SEE for each role (client decision 2026-11-26). Internal role
 * codes are unchanged — only labels: the `admin` role is shown as "Owner",
 * and a caretaker flagged as a managing agent is shown as "Agent".
 */
export const ROLE_LABELS: Record<string, string> = {
  tenant: "Tenant",
  caretaker: "Caretaker",
  custodian: "Custodian",
  admin: "Owner",
  broker: "Broker",
  "system-admin": "Platform admin",
  system: "System",
};

export type StaffTitle = "" | "agent";

/** Display name for a role; caretakers marked as managing agents read "Agent". */
export function roleLabel(
  role: string | null | undefined,
  staffTitle?: StaffTitle | string | null,
): string {
  if (role === "caretaker" && staffTitle === "agent") return "Agent";
  if (!role) return "";
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

/** Plural / generic wording used in sentences ("Only the owner can …"). */
export const OWNER_WORD = "owner";
