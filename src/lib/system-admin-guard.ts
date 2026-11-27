import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { authenticate } from "@/lib/permissions";
import { User } from "@/models/User";

/**
 * Guard for system-admin-only broker/marketplace review routes: the broker
 * release flag must be on and the caller an active system-admin (checked
 * against the database, not just the token).
 */
export async function requireSystemAdmin(
  request: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await connectToDatabase();
  const auth = authenticate(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = (await User.findById(auth.userId).select("role isActive").lean()) as {
    role?: string;
    isActive?: boolean;
  } | null;
  if (!user?.isActive || user.role !== "system-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { userId: auth.userId };
}
