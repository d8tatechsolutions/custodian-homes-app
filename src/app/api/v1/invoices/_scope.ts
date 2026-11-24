import type { InvoiceActor } from "@/app/api/v1/_helpers";

function adminScopeMatches(
  doc: { propertyId: string; unitId?: string; tenantId?: string },
  actor: InvoiceActor,
): boolean {
  const propMatch = actor.propertyScopeIds.includes(doc.propertyId);
  const unitMatch = doc.unitId && actor.assignedUnitIds.includes(doc.unitId);
  const tenantMatch = doc.tenantId && actor.assignedTenantIds.includes(doc.tenantId);
  return Boolean(propMatch || unitMatch || tenantMatch);
}

/** Whether a staff actor may act on this invoice (shared by every `[id]` route). */
export function invoiceInScope(
  doc: { ownerId: string; propertyId: string; unitId?: string; tenantId?: string },
  actor: InvoiceActor,
): boolean {
  if (actor.role === "system-admin") return true;
  if (actor.role === "custodian") {
    if (actor.staffAssignmentBacked) {
      return adminScopeMatches(doc, actor);
    }
    return doc.ownerId === actor.managedByOwnerId;
  }
  if (actor.role === "caretaker") {
    if (actor.staffAssignmentBacked) {
      return adminScopeMatches(doc, actor);
    }
    return (
      doc.ownerId === actor.managedByOwnerId && actor.assignedPropertyIds.includes(doc.propertyId)
    );
  }
  if (actor.role === "admin") {
    return adminScopeMatches(doc, actor);
  }
  return false;
}
