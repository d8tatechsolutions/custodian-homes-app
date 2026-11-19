import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  deriveAssignmentScope,
  resolveRequestContext,
  type StaffAccessRole,
} from "@/lib/auth-scope";
import {
  type ActorContext,
  evaluateActorPolicy,
  evaluatePortfolioPolicy,
} from "@/lib/authorization";
import {
  type AssignmentLike,
  type PolicyResource as CorePolicyResource,
  type PolicyAction,
  TENANT_ACTIONS,
} from "@/lib/authorization-policy";
import { getJwtSecret } from "@/lib/jwt";
import { connectToDatabase } from "@/lib/mongoose";
import { loadUnitResource } from "@/lib/policy-resources";
import { ManagementAssignment } from "@/models/ManagementAssignment";

export type Role = "tenant" | "caretaker" | "custodian" | "admin" | "broker" | "system-admin";

export const CARETAKER_PRIVILEGES = [
  "create_property",
  "edit_property",
  "delete_assigned_property",
  "manage_units",
  "manage_tenants",
  "process_move_requests",
  "manage_invoices",
  "manage_complaints",
  "manage_tasks",
  "manage_announcements",
  "send_messages",
  "manage_documents",
] as const;

export type CaretakerPrivilege = (typeof CARETAKER_PRIVILEGES)[number];

export const CUSTODIAN_PRIVILEGES = ["assign_privileges"] as const;

export type CustodianPrivilege = (typeof CUSTODIAN_PRIVILEGES)[number];

export type Privilege = CaretakerPrivilege | CustodianPrivilege;

/** A custodian trusted to manage caretaker privileges for their owner. */
export function isPrivilegedCustodian(user: {
  role: Role;
  privileges?: string[] | null;
  isActive?: boolean;
}): boolean {
  return (
    user.role === "custodian" &&
    user.isActive === true &&
    (user.privileges ?? []).includes("assign_privileges")
  );
}

export type Action =
  | "property:create"
  | "property:edit"
  | "property:delete"
  | "property-type:manage"
  | "recycle-bin:manage"
  | "unit:read"
  | "unit:manage"
  | "custodian:manage"
  | "tenant:manage"
  | "move-request:create"
  | "move-request:manage"
  | "application:manage"
  | "lease:manage"
  | "invoice:read"
  | "invoice:manage"
  | "invoice:mark-paid"
  | "invoice:generate"
  | "invoice:read-own"
  | "lead:manage"
  | "lead:read"
  | "notification:read-own"
  | "notification:manage"
  | "settings:read"
  | "settings:write"
  | "complaint:read-own"
  | "complaint:create"
  | "complaint:manage"
  | "task:read-own"
  | "task:create"
  | "task:manage"
  | "chat:read-own"
  | "chat:send"
  | "chat:manage"
  | "announcement:read"
  | "announcement:manage"
  | "document:read-own"
  | "document:manage";

export interface AuthUser {
  userId: string;
  role: Role;
  name?: string;
  email?: string;
  tokenVersion?: number;
}

export function authenticate(request: Request): AuthUser | null {
  const cookieHeader = request.headers.get("cookie");
  const token = cookieHeader
    ?.split("; ")
    .find((c) => c.startsWith("keja-token="))
    ?.split("=")[1];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as {
      userId: string;
      role: Role;
      name?: string;
      email?: string;
      tokenVersion?: number;
    };
    return {
      userId: payload.userId,
      role: payload.role,
      name: payload.name,
      email: payload.email,
      tokenVersion: payload.tokenVersion,
    };
  } catch {
    return null;
  }
}

export function isFullControlRole(role: Role): boolean {
  return role === "admin" || role === "system-admin";
}

export async function requireAuth(
  request: NextRequest,
  roles?: Role[],
): Promise<NextResponse | null> {
  const user = authenticate(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (roles && !roles.includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export interface PermissionResource {
  _id?: unknown;
  ownerId?: string;
  propertyId?: string;
  blockId?: string;
  unitId?: string;
  lifecycleState?: "draft" | "active" | "archived" | "merged";
}

function stringId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "toString" in value) {
    const rendered = String(value);
    return rendered.length > 0 ? rendered : undefined;
  }
  return undefined;
}

/**
 * Converts a legacy route resource into the canonical policy scope. Property
 * documents expose `_id` rather than `propertyId`, so infer it only when the
 * route has not already supplied a narrower scope.
 */
export function toPolicyResource(
  resource: PermissionResource | undefined,
): CorePolicyResource | undefined {
  if (!resource) return undefined;
  const propertyId =
    stringId(resource.propertyId) ?? (resource.unitId ? undefined : stringId(resource._id));
  const blockId = stringId(resource.blockId);
  const unitId = stringId(resource.unitId);
  if (!propertyId) return undefined;
  const ownerId = stringId(resource.ownerId);
  return {
    propertyId,
    ...(ownerId ? { ownerId } : {}),
    ...(blockId ? { blockId } : {}),
    ...(unitId ? { unitId } : {}),
    ...(resource.lifecycleState ? { lifecycleState: resource.lifecycleState } : {}),
  };
}

async function resolvePolicyResource(
  resource: PermissionResource,
): Promise<CorePolicyResource | null> {
  const requested = toPolicyResource(resource);
  if (!requested) return null;
  if (!requested.unitId) return requested;

  const resolved = await loadUnitResource(requested.unitId);
  if (!resolved.ok || resolved.resource.propertyId !== requested.propertyId) return null;
  if (requested.blockId && resolved.resource.blockId !== requested.blockId) return null;

  const ownerId = requested.ownerId ?? resolved.resource.ownerId;
  return {
    ...resolved.resource,
    ...(ownerId ? { ownerId } : {}),
    lifecycleState: requested.lifecycleState ?? resolved.resource.lifecycleState,
  };
}

/**
 * Permission entry point (clean slate): the scoped assignment policy is the
 * only decider. Authentication semantics (401s, tokenVersion) are preserved.
 *
 * Platform actions (property-type:manage, recycle-bin:manage) remain
 * system-admin only. Caretaker property:create / property:delete stay
 * privilege-gated (create_property / delete_assigned_property) with no
 * scoped-policy override — the backfill cannot represent those privileges.
 * Staff without active assignments are denied (no legacy fallback).
 */
export async function requirePermission(
  request: NextRequest,
  action: Action,
  opts?: { resource?: PermissionResource },
): Promise<NextResponse | null> {
  const ctx = await resolveRequestContext(request);
  if (!ctx.auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = ctx.user;
  if (!user?.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((user.tokenVersion ?? 0) !== (ctx.auth.tokenVersion ?? 0)) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  // The property taxonomy and recycle bin are platform-wide: only the system
  // administrator may change them.
  if (
    (action === "property-type:manage" || action === "recycle-bin:manage") &&
    user.role !== "system-admin"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (user.role === "tenant") {
    return TENANT_ACTIONS.has(action as PolicyAction)
      ? null
      : NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (user.role === "system-admin") return null;

  if (user.role === "caretaker") {
    const privileges = (user.privileges ?? []) as CaretakerPrivilege[];
    if (action === "property:create" && !privileges.includes("create_property")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (action === "property:delete" && !privileges.includes("delete_assigned_property")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const context: ActorContext = {
    actor: { userId: String(user._id), role: user.role, isActive: user.isActive },
    assignments: await ctx.assignments(),
  };

  // A route that supplies a real resource is decided against that scope. A
  // route without a concrete resource (list endpoints, collection creates) is
  // decided at portfolio level: an active assignment granting the action
  // passes, and the route narrows the data to the assignment scope itself.
  let policyResource: CorePolicyResource | undefined;
  if (opts?.resource) {
    const base = toPolicyResource(opts.resource);
    if (base) {
      const resolved = await resolvePolicyResource(opts.resource);
      if (!resolved) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      policyResource = resolved;
    }
  }

  // Fail closed (plan Step 1.1): an admin resource-scoped check without a
  // known owner is denied — an absent owner must never match anything. The
  // owner-scoped admin allow (WP3) lands on top of this guard, after the
  // lifecycle/platform checks inside the policy.
  if (policyResource && user.role === "admin" && !policyResource.ownerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fail closed for unresolvable resources: a route that declares a resource
  // but supplies no propertyId/_id cannot be scoped, so an admin must not be
  // allowed through the portfolio path. (Invariant 2 — an absent owner must
  // never match anything.) Without this, ownerId-only resources silently
  // pass; the only such call sites are caretaker-only conditionals (audit
  // Change 4), so this has no effect on admin routes today.
  if (opts?.resource && !policyResource && user.role === "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const decision = policyResource
    ? evaluateActorPolicy(context, action as PolicyAction, policyResource)
    : evaluatePortfolioPolicy(context, action as PolicyAction);
  if (!decision.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export interface TenantScope {
  filter: Record<string, unknown>;
  leaseFilter?: Record<string, unknown>;
  userId: string;
  role: Role;
  managedByOwnerId: string;
  assignedPropertyIds?: string[];
  propertyScopeIds?: string[];
  assignedUnitIds?: string[];
  assignedTenantIds?: string[];
  /** Custodian/caretaker scope resolved from ManagementAssignment (not legacy fields). */
  staffAssignmentBacked?: boolean;
}

export interface AdminAssignmentScope {
  assignedPropertyIds: string[];
  propertyScopeIds: string[];
  assignedBlockIds: string[];
  assignedUnitIds: string[];
  assignedTenantIds: string[];
}

export interface StaffAssignmentScope extends AdminAssignmentScope {
  /** True when the principal holds at least one active assignment (in window, with the action). */
  hasAssignments: boolean;
}

async function getAssignmentScope(
  userId: string,
  accessRole: StaffAccessRole,
  action: Action,
): Promise<StaffAssignmentScope> {
  await connectToDatabase();
  const assignments = await ManagementAssignment.find({
    principalUserId: userId,
    accessRole,
    status: "active",
  }).lean();
  return deriveAssignmentScope(assignments as unknown as AssignmentLike[], accessRole, action);
}

export async function getAdminAssignmentScope(
  userId: string,
  action: Action,
): Promise<AdminAssignmentScope> {
  const { hasAssignments, ...scope } = await getAssignmentScope(userId, "admin", action);
  void hasAssignments;
  return scope;
}

/**
 * Assignment-backed scope for custodian/caretaker staff. Staff without an
 * active assignment have no scope (fail closed).
 */
export async function getStaffAssignmentScope(
  userId: string,
  accessRole: "custodian" | "caretaker",
  action: Action,
): Promise<StaffAssignmentScope> {
  return getAssignmentScope(userId, accessRole, action);
}

type TenantScopeAction = "tenant:manage" | "lease:manage" | "unit:manage";

/**
 * Tenant list filter from an assignment-backed staff scope: property-scoped
 * assignments match by property, unit-level coverage matches via the tenants
 * already assigned to those units. Mirrors the admin branch's $or clauses.
 */
function staffTenantFilter(scope: StaffAssignmentScope): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];
  if (scope.propertyScopeIds.length > 0) {
    clauses.push({ propertyId: { $in: scope.propertyScopeIds } });
  }
  if (scope.assignedTenantIds.length > 0) {
    clauses.push({ _id: { $in: scope.assignedTenantIds } });
  }
  if (clauses.length === 0) return { _id: { $in: [] } };
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

/**
 * Lease list filter from an assignment-backed staff scope (mirror of the
 * admin lease clauses): property-scoped assignments match by property,
 * unit-scoped assignments match by unit.
 */
function staffLeaseFilter(scope: StaffAssignmentScope): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];
  if (scope.propertyScopeIds.length > 0) {
    clauses.push({ propertyId: { $in: scope.propertyScopeIds } });
  }
  if (scope.assignedUnitIds.length > 0) {
    clauses.push({ unitId: { $in: scope.assignedUnitIds } });
  }
  if (clauses.length === 0) return { _id: { $in: [] } };
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

export async function getTenantScope(
  request: NextRequest,
  action: TenantScopeAction = "tenant:manage",
): Promise<NextResponse | TenantScope> {
  const ctx = await resolveRequestContext(request);
  if (!ctx.auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = ctx.user;
  if (!user?.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = String(user._id);
  const managedByOwnerId =
    user.role === "custodian" || user.role === "caretaker" ? await ctx.managedOwnerId() : "";

  if (user.role === "admin") {
    const { hasAssignments, ...assignmentScope } = await ctx.assignmentScope("admin", action);
    void hasAssignments;

    const tenantClauses: Record<string, unknown>[] = [{ ownerId: userId }];
    const leaseClauses: Record<string, unknown>[] = [{ ownerId: userId }];
    if (assignmentScope.propertyScopeIds.length > 0) {
      tenantClauses.push({ propertyId: { $in: assignmentScope.propertyScopeIds } });
      leaseClauses.push({ propertyId: { $in: assignmentScope.propertyScopeIds } });
    }
    if (assignmentScope.assignedTenantIds.length > 0) {
      tenantClauses.push({ _id: { $in: assignmentScope.assignedTenantIds } });
    }
    if (assignmentScope.assignedUnitIds.length > 0) {
      leaseClauses.push({ unitId: { $in: assignmentScope.assignedUnitIds } });
    }
    const tenantFilter = tenantClauses.length
      ? tenantClauses.length === 1
        ? tenantClauses[0]
        : { $or: tenantClauses }
      : { _id: { $in: [] } };
    const leaseFilter = leaseClauses.length
      ? leaseClauses.length === 1
        ? leaseClauses[0]
        : { $or: leaseClauses }
      : { _id: { $in: [] } };

    return {
      filter: action === "lease:manage" ? leaseFilter : tenantFilter,
      leaseFilter,
      userId,
      role: user.role,
      managedByOwnerId,
      ...assignmentScope,
    };
  }
  if (user.role === "custodian" || user.role === "caretaker") {
    // Assignment-only scoping (clean slate): staff without an active
    // assignment have no scope and are denied.
    const staffScope = await ctx.assignmentScope(user.role, action);
    if (!staffScope.hasAssignments) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return {
      filter: staffTenantFilter(staffScope),
      leaseFilter: staffLeaseFilter(staffScope),
      userId,
      role: user.role,
      managedByOwnerId,
      ...staffScope,
      staffAssignmentBacked: true,
    };
  }
  if (user.role === "system-admin") {
    return { filter: {}, leaseFilter: {}, userId, role: user.role, managedByOwnerId };
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function tenantMatchesScope(
  tenant: { _id?: unknown; ownerId: string; propertyId: string },
  scope: TenantScope,
): boolean {
  if (scope.role === "admin") {
    return (
      tenant.ownerId === scope.userId ||
      (scope.propertyScopeIds?.includes(tenant.propertyId) ?? false) ||
      (scope.assignedTenantIds?.includes(String(tenant._id ?? "")) ?? false)
    );
  }
  if (scope.role === "system-admin") {
    return true;
  }
  if (scope.role === "custodian" || scope.role === "caretaker") {
    return (
      (scope.propertyScopeIds?.includes(tenant.propertyId) ?? false) ||
      (scope.assignedTenantIds?.includes(String(tenant._id ?? "")) ?? false)
    );
  }
  return false;
}
