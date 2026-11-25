import type { NextRequest, NextResponse } from "next/server";
import { type DashboardActor, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { tasksV2Disabled } from "@/lib/maintenance/route-helpers";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { Property } from "@/models/Property";

/**
 * Whose catalogue (vendors, categories) the caller sees: admins their own;
 * custodians and caretakers the admin they work for. Others have none.
 */
export function catalogOwnerId(actor: DashboardActor): string {
  if (actor.role === "admin") return actor.userId;
  if (actor.role === "custodian" || actor.role === "caretaker") return actor.managedByOwnerId;
  return "";
}

/** Flag + auth + actor for catalogue routes (vendors, categories, operations). */
export async function catalogActor(request: NextRequest): Promise<DashboardActor | NextResponse> {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  const authError = await requirePermission(request, "task:read-own");
  if (authError) return authError;
  await connectToDatabase();
  return resolveDashboardActor(request, "task:read-own");
}

/** True when every id is a live property owned by `ownerId`. */
export async function propertiesOwnedBy(ownerId: string, propertyIds: string[]): Promise<boolean> {
  const unique = [...new Set(propertyIds)];
  if (unique.length === 0) return true;
  const count = await Property.countDocuments({ _id: { $in: unique }, ownerId, deletedAt: null });
  return count === unique.length;
}
