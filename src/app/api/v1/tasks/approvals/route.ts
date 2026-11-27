import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap, resolveDashboardActor } from "@/app/api/v1/_helpers";
import { serializeTaskV2, type TaskDoc, tasksV2Disabled } from "@/lib/maintenance/route-helpers";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { Task } from "@/models/Task";

/** Costs waiting for the caller's approval (the Approvals tab). */
export async function GET(request: NextRequest) {
  const disabled = tasksV2Disabled();
  if (disabled) return disabled;
  const authError = await requirePermission(request, "task:read-own");
  if (authError) return authError;

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "task:read-own");
  if (actor instanceof NextResponse) return actor;

  const rows = (await Task.find({
    status: "waiting-approval",
    "cost.approval.status": "pending",
    "cost.approval.approverUserId": actor.userId,
  })
    .sort({ "cost.quote.at": 1 })
    .limit(200)
    .lean()) as TaskDoc[];
  const titles = await propertyTitleMap(rows.map((t) => t.propertyId));
  return NextResponse.json({ data: rows.map((t) => serializeTaskV2(t, titles)) });
}
