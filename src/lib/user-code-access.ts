import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { authenticate } from "@/lib/permissions";
import { User } from "@/models/User";

/**
 * The only roles permitted to resolve a user code to an account record.
 *
 * Deliberately narrow: `admin` is a landlord/portfolio owner, not platform
 * staff, so granting it here would give every landlord an oracle over the
 * entire user base. Widen this list only with a security review.
 */
export const USER_CODE_LOOKUP_ROLES = ["system-admin"] as const;

export type UserCodeLookupRole = (typeof USER_CODE_LOOKUP_ROLES)[number];

export interface UserCodeLookupActor {
  userId: string;
  role: UserCodeLookupRole;
}

function isLookupRole(role: string | undefined): role is UserCodeLookupRole {
  return role !== undefined && (USER_CODE_LOOKUP_ROLES as readonly string[]).includes(role);
}

/**
 * Resolves the caller of the code-lookup surface.
 *
 * The JWT is only used to identify *which* user is asking; the role, active
 * flag and token version are always re-read from the database so a stale or
 * forged role claim cannot reach this surface. The returned response (401/403)
 * is what the route should send as-is.
 */
export async function requireUserCodeLookupActor(
  request: NextRequest,
): Promise<NextResponse | UserCodeLookupActor> {
  const auth = authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const user = await User.findById(auth.userId).select("role isActive tokenVersion").lean();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isActive) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if ((user.tokenVersion ?? 0) !== (auth.tokenVersion ?? 0)) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }
  if (!isLookupRole(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { userId: String(user._id), role: user.role };
}
