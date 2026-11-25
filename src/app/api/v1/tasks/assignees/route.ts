import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveDashboardActor } from "@/app/api/v1/_helpers";
import { actorCanAccessTask } from "@/lib/maintenance/access";
import { tasksV2Disabled } from "@/lib/maintenance/route-helpers";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { ManagementAssignment } from "@/models/ManagementAssignment";
import { Property } from "@/models/Property";
import { User } from "@/models/User";
import { Vendor } from "@/models/Vendor";

/**
 * Who can be assigned work on a property: the owner admin, active staff with
 * an assignment on it, and the owner's active vendors serving it. Matches the
 * server-side checks in `resolveAssignee`, so the picker never offers someone
 * the API would refuse. Caretakers only see themselves.
 */
export async function GET(request: NextRequest) {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  const authError = await requirePermission(request, "task:read-own");
  if (authError) return authError;
  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "task:read-own");
  if (actor instanceof NextResponse) return actor;

  const propertyId = request.nextUrl.searchParams.get("propertyId") ?? "";
  const property = (await Property.findOne({ _id: propertyId, deletedAt: null })
    .select("ownerId")
    .lean()) as {
    ownerId?: string;
  } | null;
  const ownerId = String(property?.ownerId ?? "");
  if (!property || !actorCanAccessTask(actor, { ownerId, propertyId })) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const assignments = (await ManagementAssignment.find({ propertyId, status: "active" })
    .select("principalUserId")
    .lean()) as { principalUserId: string }[];
  const staffIds = [...new Set([ownerId, ...assignments.map((a) => String(a.principalUserId))])];
  const users = (await User.find({
    _id: { $in: staffIds },
    isActive: true,
    role: { $in: ["admin", "custodian", "caretaker"] },
  })
    .select("name role")
    .lean()) as { _id: unknown; name?: string; role: string }[];

  let staff = users
    .map((u) => ({ id: String(u._id), name: u.name || "Unnamed", role: u.role }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  if (actor.role === "caretaker") staff = staff.filter((s) => s.id === actor.userId);

  const vendors =
    actor.role === "caretaker"
      ? []
      : (
          (await Vendor.find({ ownerId, isActive: true, propertyIds: propertyId })
            .select("name trades phone")
            .sort({ name: 1 })
            .lean()) as { _id: unknown; name: string; trades?: string[]; phone?: string }[]
        ).map((v) => ({
          id: String(v._id),
          name: v.name,
          trades: v.trades ?? [],
          phone: v.phone ?? "",
        }));

  return NextResponse.json({ data: { staff, vendors } });
}
