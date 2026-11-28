import type { NextRequest } from "next/server";
import type { AuditActor } from "@/lib/audit";
import { resolveRequestContext } from "@/lib/auth-scope";

/**
 * The signed-in user behind a request, for an audit entry. Reuses the
 * request's memoized auth context, so it adds no database query after the
 * route's own permission check.
 */
export async function auditActorFrom(request: NextRequest): Promise<AuditActor> {
  const ctx = await resolveRequestContext(request);
  return {
    userId: ctx.user ? String(ctx.user._id) : (ctx.auth?.userId ?? ""),
    role: ctx.user?.role ?? "",
  };
}
