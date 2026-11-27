import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit";
import { authenticateSession } from "@/lib/auth-scope";
import { getManagedOwnerId } from "@/lib/managed-owner";
import { connectToDatabase } from "@/lib/mongoose";
import { getAdminAssignmentScope } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { Property } from "@/models/Property";
import { User } from "@/models/User";

const input = z.object({ agent: z.boolean() });

/**
 * Marks a caretaker as the owner's managing agent (shown as "Agent"
 * everywhere) or back to caretaker. Label only — permissions are unchanged.
 * Allowed for the owner the caretaker works for (or an admin delegated on
 * that owner's properties) and the system-admin.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid caretaker id" }, { status: 400 });
  const auth = await authenticateSession(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await connectToDatabase();

  const actor = (await User.findById(auth.userId).select("role isActive").lean()) as {
    role?: string;
    isActive?: boolean;
  } | null;
  if (!actor?.isActive || (actor.role !== "admin" && actor.role !== "system-admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const target = (await User.findById(id).select("role").lean()) as { role?: string } | null;
  if (target?.role !== "caretaker") {
    return NextResponse.json({ error: "Only caretakers can be marked as agents" }, { status: 400 });
  }

  if (actor.role === "admin") {
    const managedBy = await getManagedOwnerId(id);
    let allowed = managedBy === auth.userId;
    if (!allowed && managedBy) {
      const scope = await getAdminAssignmentScope(auth.userId, "property:read" as never);
      const owners = scope.assignedPropertyIds.length
        ? ((await Property.find({ _id: { $in: scope.assignedPropertyIds } })
            .select("ownerId")
            .lean()) as {
            ownerId?: string;
          }[])
        : [];
      allowed = owners.some((p) => String(p.ownerId) === managedBy);
    }
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const staffTitle = parsed.data.agent ? "agent" : "";
  await User.updateOne({ _id: id }, { $set: { staffTitle } });
  await writeAuditEvent({
    actor: { userId: auth.userId, role: actor.role as "admin" | "system-admin" },
    action: "caretaker.title_changed",
    entityType: "user",
    entityId: id,
    after: { staffTitle },
    request: {
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    },
  });
  return NextResponse.json({ data: { id, staffTitle } });
}
