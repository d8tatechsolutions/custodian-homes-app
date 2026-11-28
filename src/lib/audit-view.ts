import { roleLabel } from "@/lib/role-labels";

/**
 * Who sees which audit entries, and how much of each (decided 2026-11-28,
 * need-to-know):
 * - system admin: every entry, in full, and can add notes;
 * - owner: entries on properties they own or are assigned to, plus their own
 *   actions, in full;
 * - custodian / caretaker: entries on properties they're actively assigned
 *   to, plus their own actions, with personal contact details hidden;
 * - tenant: their own actions and changes to their own invoices and leases;
 * - broker: their own actions only.
 * Tenants and brokers see who acted by role, not by name.
 */
export type AuditViewerRole =
  | "system-admin"
  | "admin"
  | "custodian"
  | "caretaker"
  | "tenant"
  | "broker";

export type AuditDetail = "full" | "staff" | "self";

export interface AuditViewer {
  role: AuditViewerRole;
  userId: string;
  /** Owner/staff: properties in scope. */
  propertyIds: string[];
  /** Tenant: their own invoice and lease ids. */
  invoiceIds: string[];
  leaseIds: string[];
}

export function auditDetailFor(role: AuditViewerRole): AuditDetail {
  if (role === "system-admin" || role === "admin") return "full";
  if (role === "custodian" || role === "caretaker") return "staff";
  return "self";
}

/** History filter groups → the entity types recorded for them. */
export const AUDIT_TYPE_GROUPS: Record<string, string[]> = {
  invoice: ["invoice", "invoice-run"],
  lease: ["lease"],
  tenant: ["tenant"],
  user: ["user"],
  assignment: ["ManagementAssignment"],
  listing: ["listing", "listing_publisher", "broker_listing"],
  property: ["Property"],
  commission: ["commission_accrual", "commission_agreement", "commission_payout", "attribution"],
  broker: ["broker_profile", "broker_authorization"],
};

/** The Mongo filter that limits entries to what this viewer may see. */
export function auditVisibilityFilter(viewer: AuditViewer): Record<string, unknown> {
  if (viewer.role === "system-admin") return {};
  const own = { actorUserId: viewer.userId };
  if (viewer.role === "admin" || viewer.role === "custodian" || viewer.role === "caretaker") {
    return { $or: [own, { "scope.propertyId": { $in: viewer.propertyIds } }] };
  }
  if (viewer.role === "tenant") {
    return {
      $or: [
        own,
        { entityType: "user", entityId: viewer.userId },
        { entityType: "invoice", entityId: { $in: viewer.invoiceIds } },
        { entityType: "lease", entityId: { $in: viewer.leaseIds } },
      ],
    };
  }
  return { $or: [own, { entityType: "user", entityId: viewer.userId }] };
}

/** Personal details hidden from anyone who doesn't see entries in full. */
const PERSONAL_KEY =
  /^(email|phone|phoneNumber|mobile|alternatePhone|nationalId|idNumber|kraPin|dateOfBirth|address|emergencyContact|nextOfKin|passwordHash|ipHash|userAgentHash)$/i;
/** Never shown to anyone (internal or secret material). */
const INTERNAL_KEY =
  /(password|token|secret|hash|cookie|authorization|apikey|api_key|__v|ipHash|userAgentHash)/i;

const MAX_VALUE_LENGTH = 300;

export interface AuditChange {
  field: string;
  before: string;
  after: string;
}

function display(value: unknown, depth = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.slice(0, MAX_VALUE_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (depth > 2) return "…";
  try {
    return JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
  } catch {
    return "…";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Field-by-field differences between the recorded before and after. */
export function auditChanges(before: unknown, after: unknown, detail: AuditDetail): AuditChange[] {
  const b = asRecord(before);
  const a = asRecord(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const changes: AuditChange[] = [];
  for (const field of keys) {
    if (INTERNAL_KEY.test(field)) continue;
    const beforeText = display(b[field]);
    const afterText = display(a[field]);
    if (beforeText === afterText && Object.keys(b).length > 0) continue;
    const hide = detail !== "full" && PERSONAL_KEY.test(field);
    changes.push({
      field,
      before: hide ? "hidden" : beforeText,
      after: hide ? "hidden" : afterText,
    });
  }
  return changes.slice(0, 40);
}

const ACTION_LABELS: Record<string, string> = {
  "invoice.created": "Invoice created",
  "invoice.generated": "Monthly invoices generated",
  "invoice.issued": "Invoice issued",
  "invoice.updated": "Invoice edited",
  "invoice.voided": "Invoice voided",
  "invoice.deleted": "Draft invoice deleted",
  "invoice.payment_recorded": "Payment recorded by hand",
  "invoice.paid_online": "Online payment received",
  "invoice.online_payment_mismatch": "Online payment of the wrong amount (not applied)",
  "lease.created": "Lease started",
  "lease.updated": "Lease changed",
  "lease.ended": "Lease ended",
  "lease.deleted": "Lease deleted",
  "tenant.created": "Tenant added",
  "tenant.updated": "Tenant updated",
  "tenant.deleted": "Tenant removed",
  "user.created": "Account created",
  "user.invited": "Person invited",
  "user.role_changed": "Role changed",
  "user.status_changed": "Account activated or deactivated",
  "assignment.grant": "Access granted",
  "assignment.accept": "Access accepted",
  "assignment.revoke": "Access removed",
  "property.structure.update": "Property layout changed",
  "listing.updated": "Listing edited",
  "listing.deleted": "Listing deleted",
  "listing.state_transition": "Listing status changed",
  "caretaker.privileges.updated": "Caretaker permissions changed",
  "caretaker.title_changed": "Caretaker title changed",
  "custodian.updated": "Custodian updated",
  "custodian.revoked": "Custodian removed",
  "commission.accrued": "Commission earned",
  "commission.approved": "Commission approved",
  "commission.reversed": "Commission reversed",
  "commission.clawback_created": "Commission clawed back",
  "commission.payout_created": "Commission payout created",
  "commission.payout_executed": "Commission paid out",
  "commission.payout_failed": "Commission payout failed",
  "audit.note_added": "Note added to history",
};

export function auditActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const words = action.replace(/[._:-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Change";
}

export interface AuditEntryRow {
  _id: unknown;
  actorUserId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string;
  scope?: { propertyId?: string; blockId?: string; unitId?: string };
  before?: unknown;
  after?: unknown;
  createdAt?: Date | string;
}

export interface AuditNoteView {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface AuditEntryView {
  id: string;
  at: string;
  action: string;
  label: string;
  entityType: string;
  entityId: string;
  actor: { name: string; role: string; isYou: boolean };
  propertyId: string;
  propertyTitle: string;
  changes: AuditChange[];
  notes: AuditNoteView[];
}

export function toAuditEntryView(
  row: AuditEntryRow,
  viewer: AuditViewer,
  lookups: {
    names: Map<string, string>;
    propertyTitles: Map<string, string>;
    notes: Map<string, AuditNoteView[]>;
  },
): AuditEntryView {
  const detail = auditDetailFor(viewer.role);
  const id = String(row._id);
  const isYou = row.actorUserId === viewer.userId;
  const role = roleLabel(row.actorRole) || "System";
  const name =
    row.actorUserId === "system"
      ? "System"
      : isYou
        ? "You"
        : detail === "self"
          ? role
          : lookups.names.get(row.actorUserId) || role;
  const propertyId = row.scope?.propertyId ?? "";
  return {
    id,
    at: row.createdAt ? new Date(row.createdAt).toISOString() : "",
    action: row.action,
    label: auditActionLabel(row.action),
    entityType: row.entityType,
    entityId: detail === "self" ? "" : (row.entityId ?? ""),
    actor: { name, role, isYou },
    propertyId: detail === "self" ? "" : propertyId,
    propertyTitle: lookups.propertyTitles.get(propertyId) ?? "",
    changes: auditChanges(row.before, row.after, detail),
    notes: lookups.notes.get(id) ?? [],
  };
}
