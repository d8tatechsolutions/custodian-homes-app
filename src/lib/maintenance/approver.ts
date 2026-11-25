import { ManagementAssignment } from "@/models/ManagementAssignment";
import { PropertyOwnership } from "@/models/PropertyOwnership";

export type ApproverSource = "owner-account" | "custodian" | "managing-admin" | "property-owner";

export interface CostApprover {
  userId: string;
  source: ApproverSource;
}

/**
 * Who approves a task cost on a property (client decision, 2026-11-25):
 *
 * 1. An active ownership held by a platform user → that user (the owner).
 * 2. Ownership recorded but only external holders (owner has no account) →
 *    the property's active custodian; if none, the managing admin
 *    (`property.ownerId`).
 * 3. No ownership recorded (all properties today) → the property's owner
 *    admin (`property.ownerId`).
 *
 * The primary-payee user wins when several user holders exist, then the
 * largest share.
 */
export async function resolveCostApprover(
  propertyId: string,
  propertyOwnerId: string,
): Promise<CostApprover | null> {
  const ownerships = (await PropertyOwnership.find({ propertyId, status: "active" })
    .select("holderType holderUserId shareBps isPrimaryPayee")
    .lean()) as {
    holderType: "user" | "external";
    holderUserId?: string;
    shareBps?: number;
    isPrimaryPayee?: boolean;
  }[];

  const userHolders = ownerships
    .filter((o) => o.holderType === "user" && o.holderUserId)
    .sort(
      (a, b) =>
        Number(Boolean(b.isPrimaryPayee)) - Number(Boolean(a.isPrimaryPayee)) ||
        (b.shareBps ?? 0) - (a.shareBps ?? 0),
    );
  if (userHolders.length > 0) {
    return { userId: String(userHolders[0].holderUserId), source: "owner-account" };
  }

  if (ownerships.length > 0) {
    const custodian = (await ManagementAssignment.findOne({
      propertyId,
      accessRole: "custodian",
      status: "active",
    })
      .sort({ grantedAt: 1 })
      .select("principalUserId")
      .lean()) as { principalUserId?: string } | null;
    if (custodian?.principalUserId) {
      return { userId: String(custodian.principalUserId), source: "custodian" };
    }
    return propertyOwnerId ? { userId: propertyOwnerId, source: "managing-admin" } : null;
  }

  return propertyOwnerId ? { userId: propertyOwnerId, source: "property-owner" } : null;
}

/** Whether a quote of `amount` KES needs approval under the property's threshold. */
export function quoteNeedsApproval(amount: number, threshold: number | null | undefined): boolean {
  if (!(amount > 0)) return false;
  if (threshold === null || threshold === undefined) return true;
  return amount > threshold;
}
