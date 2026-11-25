import type { DashboardActor } from "@/app/api/v1/_helpers";
import { canAssignToOthers } from "@/lib/maintenance/access";
import { ManagementAssignment } from "@/models/ManagementAssignment";
import type { ITaskAssignee } from "@/models/Task";
import { User } from "@/models/User";
import { Vendor } from "@/models/Vendor";

export interface AssigneeInput {
  kind: "staff" | "vendor";
  userId?: string;
  vendorId?: string;
}

export interface ResolvedAssignee {
  assignee: ITaskAssignee | null;
  /** Legacy mirror fields read by the v1 pages and the `assignedTo` filter. */
  assignedTo: string;
  assignedToName: string;
}

const STAFF_ROLES = new Set(["caretaker", "custodian", "admin"]);

/**
 * Validates an assignee for a task on `propertyId` owned by `ownerId`:
 * - caretakers may only assign themselves;
 * - staff must be active and either own the property or hold an active
 *   assignment on it;
 * - vendors must belong to the property's admin, be active and serve it.
 */
export async function resolveAssignee(
  actor: DashboardActor,
  input: AssigneeInput | null | undefined,
  propertyId: string,
  ownerId: string,
): Promise<ResolvedAssignee | { error: string }> {
  if (!input) return { assignee: null, assignedTo: "", assignedToName: "" };

  if (!canAssignToOthers(actor) && !(input.kind === "staff" && input.userId === actor.userId)) {
    return { error: "Caretakers can only assign tasks to themselves" };
  }

  if (input.kind === "vendor") {
    const vendor = (await Vendor.findOne({ _id: input.vendorId, ownerId, isActive: true })
      .select("name propertyIds")
      .lean()) as { _id: unknown; name: string; propertyIds?: string[] } | null;
    if (!vendor) return { error: "That vendor is not available" };
    if (!(vendor.propertyIds ?? []).includes(propertyId)) {
      return { error: "That vendor does not serve this property" };
    }
    return {
      assignee: { kind: "vendor", vendorId: String(vendor._id), userId: "", name: vendor.name },
      assignedTo: "",
      assignedToName: vendor.name,
    };
  }

  const user = (await User.findById(input.userId).select("name role isActive").lean()) as {
    _id: unknown;
    name?: string;
    role?: string;
    isActive?: boolean;
  } | null;
  if (!user?.isActive || !STAFF_ROLES.has(user.role ?? "")) {
    return { error: "That person cannot be assigned tasks" };
  }
  const userId = String(user._id);
  if (userId !== ownerId) {
    const onProperty = await ManagementAssignment.exists({
      principalUserId: userId,
      propertyId,
      status: "active",
    });
    if (!onProperty) return { error: "That person does not work on this property" };
  }
  return {
    assignee: { kind: "staff", userId, vendorId: "", name: user.name ?? "" },
    assignedTo: userId,
    assignedToName: user.name ?? "",
  };
}
