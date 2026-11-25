import type { DashboardActor } from "@/app/api/v1/_helpers";

/**
 * Task scope rules shared by every v2 task route. They mirror the original
 * `/api/v1/tasks/[id]` checks exactly so v1 and v2 can never disagree:
 *
 * - caretaker: tasks on properties in their action-filtered assignments
 * - custodian: tasks of the owner they are managed by
 * - admin: own tasks (`ownerId`) or tasks on delegated properties
 * - system-admin: everything
 */
export interface ScopedTask {
  ownerId: string;
  propertyId: string;
}

export function actorCanAccessTask(actor: DashboardActor, task: ScopedTask): boolean {
  switch (actor.role) {
    case "system-admin":
      return true;
    case "admin":
      return task.ownerId === actor.userId || actor.propertyScopeIds.includes(task.propertyId);
    case "custodian":
      return task.ownerId === actor.managedByOwnerId && task.ownerId !== "";
    case "caretaker":
      return actor.assignedPropertyIds.includes(task.propertyId);
    default:
      return false;
  }
}

/** Mongo filter equivalent of {@link actorCanAccessTask} for list queries. */
export function taskScopeFilter(actor: DashboardActor): Record<string, unknown> | null {
  switch (actor.role) {
    case "system-admin":
      return {};
    case "admin":
      return actor.propertyScopeIds.length > 0
        ? { $or: [{ ownerId: actor.userId }, { propertyId: { $in: actor.propertyScopeIds } }] }
        : { ownerId: actor.userId };
    case "custodian":
      return actor.managedByOwnerId ? { ownerId: actor.managedByOwnerId } : null;
    case "caretaker":
      return actor.assignedPropertyIds.length > 0
        ? { ownerId: actor.managedByOwnerId, propertyId: { $in: actor.assignedPropertyIds } }
        : null;
    default:
      return null;
  }
}

/** Caretakers may only assign tasks to themselves (client decision Q35). */
export function canAssignToOthers(actor: DashboardActor): boolean {
  return actor.role !== "caretaker";
}

/** Vendors, categories, thresholds and common areas are managed by admins only. */
export function canManageCatalog(actor: DashboardActor): boolean {
  return actor.role === "admin" || actor.role === "system-admin";
}

/** Recurring schedules: owner/admin and custodian (client decision Q26). */
export function canManageSchedules(actor: DashboardActor): boolean {
  return actor.role === "admin" || actor.role === "system-admin" || actor.role === "custodian";
}

/** Reopening a cancelled task is an admin decision. */
export function canReopenCancelled(actor: DashboardActor): boolean {
  return actor.role === "admin" || actor.role === "system-admin";
}
