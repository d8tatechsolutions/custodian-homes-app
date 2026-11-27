/**
 * Single scope resolver for request handlers. The JWT, the user row and the
 * principal's active assignments are resolved once per request and memoized
 * on the Request object; every downstream derivation (policy assignments,
 * admin/staff assignment scopes, managed owner, tenant bindings) reuses that
 * one load instead of re-querying per guard (plan §1.7).
 *
 * Standalone userId-based helpers (`getAdminAssignmentScope`,
 * `getStaffAssignmentScope`, `getManagedOwnerId`) share the same derivation
 * functions but keep their own single assignment query, since they have no
 * request to memoize on.
 */
import type { NextRequest } from "next/server";
import type { AssignmentLike } from "@/lib/authorization-policy";
import { connectToDatabase } from "@/lib/mongoose";
import {
  type Action,
  type AuthUser,
  authenticate,
  type Role,
  type StaffAssignmentScope,
} from "@/lib/permissions";
import { Lease } from "@/models/Lease";
import { ManagementAssignment } from "@/models/ManagementAssignment";
import { Property } from "@/models/Property";
import { Tenant } from "@/models/Tenant";
import { Unit } from "@/models/Unit";
import { User } from "@/models/User";

export type StaffAccessRole = "admin" | "custodian" | "caretaker";

export interface AuthContextUser {
  _id: unknown;
  role: Role;
  isActive: boolean;
  tokenVersion?: number;
  privileges?: string[];
  name?: string;
}

export interface TenantBindingRow {
  _id: unknown;
  propertyId: string;
  ownerId: string;
}

export interface RequestAuthContext {
  auth: AuthUser | null;
  user: AuthContextUser | null;
  /** All active assignments of the principal (any access role), loaded once. */
  assignments(): Promise<AssignmentLike[]>;
  /** Action-filtered scope; unit/lease expansion runs once per role+action. */
  assignmentScope(accessRole: StaffAccessRole, action: Action): Promise<StaffAssignmentScope>;
  /** Managing owner derived from the principal's active assignments. */
  managedOwnerId(): Promise<string>;
  /** Tenant rows bound to the user (tenant role). */
  tenantRows(): Promise<TenantBindingRow[]>;
}

const EMPTY_SCOPE: StaffAssignmentScope = {
  assignedPropertyIds: [],
  propertyScopeIds: [],
  assignedBlockIds: [],
  assignedUnitIds: [],
  assignedTenantIds: [],
  hasAssignments: false,
};

const contextCache = new WeakMap<Request, Promise<RequestAuthContext>>();

/** Resolves (or reuses) the one auth/scope context for this request. */
export function resolveRequestContext(request: NextRequest): Promise<RequestAuthContext> {
  const cached = contextCache.get(request);
  if (cached) return cached;
  const pending = loadRequestContext(request);
  contextCache.set(request, pending);
  return pending;
}

function emptyContext(auth: AuthUser | null): RequestAuthContext {
  return {
    auth,
    user: null,
    assignments: async () => [],
    assignmentScope: async () => ({ ...EMPTY_SCOPE }),
    managedOwnerId: async () => "",
    tenantRows: async () => [],
  };
}

async function loadRequestContext(request: NextRequest): Promise<RequestAuthContext> {
  const auth = authenticate(request);
  if (!auth) return emptyContext(null);

  await connectToDatabase();
  const user = (await User.findById(auth.userId)
    .select("-passwordHash")
    .lean()) as AuthContextUser | null;
  if (!user) return emptyContext(auth);

  const userId = String(user._id);
  let assignmentsPromise: Promise<AssignmentLike[]> | null = null;
  let managedOwnerPromise: Promise<string> | null = null;
  let tenantRowsPromise: Promise<TenantBindingRow[]> | null = null;
  const scopeCache = new Map<string, Promise<StaffAssignmentScope>>();

  const assignments = (): Promise<AssignmentLike[]> => {
    assignmentsPromise ??= (async () => {
      const rows = await ManagementAssignment.find({
        principalUserId: userId,
        status: "active",
      }).lean();
      return rows as unknown as AssignmentLike[];
    })();
    return assignmentsPromise;
  };

  return {
    auth,
    user,
    assignments,
    assignmentScope: (accessRole, action) => {
      const key = `${accessRole}:${action}`;
      let pending = scopeCache.get(key);
      if (!pending) {
        pending = assignments().then((rows) => deriveAssignmentScope(rows, accessRole, action));
        scopeCache.set(key, pending);
      }
      return pending;
    },
    managedOwnerId: () => {
      managedOwnerPromise ??= assignments().then(deriveManagedOwnerId);
      return managedOwnerPromise;
    },
    tenantRows: () => {
      tenantRowsPromise ??= (async () => {
        const rows = await Tenant.find({ userId, deletedAt: null })
          .select("_id propertyId ownerId")
          .lean();
        return rows as unknown as TenantBindingRow[];
      })();
      return tenantRowsPromise;
    },
  };
}

/**
 * Action-filtered assignment scope shared by the request context and the
 * standalone scope helpers. The principal/status predicates live in the
 * caller's query; the access-role, permission and time-window predicates are
 * applied here exactly as the legacy per-guard loads did.
 */
export async function deriveAssignmentScope(
  assignments: AssignmentLike[],
  accessRole: StaffAccessRole,
  action: Action,
): Promise<StaffAssignmentScope> {
  const now = new Date();
  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.accessRole === accessRole &&
      (assignment.permissions ?? []).includes(action) &&
      (!assignment.startsAt || new Date(assignment.startsAt).getTime() <= now.getTime()) &&
      (!assignment.endsAt || new Date(assignment.endsAt).getTime() > now.getTime()),
  );
  const assignedPropertyIds = [
    ...new Set(activeAssignments.map((assignment) => assignment.propertyId)),
  ];
  const propertyScopeIds = [
    ...new Set(
      activeAssignments
        .filter((assignment) => assignment.scopeType === "property")
        .map((assignment) => assignment.propertyId),
    ),
  ];
  const assignedBlockIds = [
    ...new Set(
      activeAssignments
        .filter((assignment) => assignment.scopeType === "block" && assignment.blockId)
        .map((assignment) => String(assignment.blockId)),
    ),
  ];
  const unitScopeQueries: Record<string, unknown>[] = [];
  for (const assignment of activeAssignments) {
    if (assignment.scopeType === "block" && assignment.blockId) {
      unitScopeQueries.push({ propertyId: assignment.propertyId, blockId: assignment.blockId });
    } else if (assignment.scopeType === "unit" && assignment.unitId) {
      unitScopeQueries.push({ _id: assignment.unitId, propertyId: assignment.propertyId });
    }
  }
  const scopedUnits = unitScopeQueries.length
    ? await Unit.find({ $or: unitScopeQueries }).select("_id").lean()
    : [];
  const assignedUnitIds = [...new Set(scopedUnits.map((unit) => String(unit._id)))];
  const leases = assignedUnitIds.length
    ? await Lease.find({ unitId: { $in: assignedUnitIds }, status: "active" })
        .select("tenantId")
        .lean()
    : [];
  const assignedTenantIds = [...new Set(leases.map((lease) => String(lease.tenantId)))];

  return {
    assignedPropertyIds,
    propertyScopeIds,
    assignedBlockIds,
    assignedUnitIds,
    assignedTenantIds,
    hasAssignments: activeAssignments.length > 0,
  };
}

/**
 * Managing owner from the principal's active assignments (any access role,
 * no action/window filter — mirrors the legacy `getManagedOwnerId` query).
 */
export async function deriveManagedOwnerId(assignments: AssignmentLike[]): Promise<string> {
  const propertyIds = [...new Set(assignments.map((assignment) => String(assignment.propertyId)))];
  if (propertyIds.length === 0) return "";
  const properties = await Property.find({ _id: { $in: propertyIds } })
    .select("ownerId")
    .lean();
  const owners = new Set(
    properties.map((property) => String(property.ownerId ?? "")).filter(Boolean),
  );
  return [...owners][0] ?? "";
}

/**
 * The signed-in user, only while the session is still valid: the account exists
 * and is active, and the token has not been revoked (sign-out everywhere, a role
 * change or deactivation bump `tokenVersion`). Use this instead of the bare
 * `authenticate()` so a revoked token stops working at once, as it does for
 * routes behind `requirePermission`. The role comes from the account, not the token.
 */
export async function authenticateSession(request: NextRequest): Promise<AuthUser | null> {
  const ctx = await resolveRequestContext(request);
  if (!ctx.auth || !ctx.user?.isActive) return null;
  if ((ctx.user.tokenVersion ?? 0) !== (ctx.auth.tokenVersion ?? 0)) return null;
  return { ...ctx.auth, role: ctx.user.role };
}
