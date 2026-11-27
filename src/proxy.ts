import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { botVerdict, isMachinePath } from "@/lib/bot-guard";
import { getJwtSecret } from "@/lib/jwt";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { getDashboardAllowedRoles, getRoleRoute, type Role } from "@/lib/role-routes";

export const config = {
  // Pages and API, excluding static assets, images, robots.txt and the
  // sitemap (crawlers must always be able to read robots.txt).
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|txt|xml|woff2?)$).*)",
  ],
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Largest accepted API write body (1 MB). */
const MAX_API_BODY_BYTES = 1_000_000;
/** Per-IP ceiling across all API calls, per server instance. */
const API_REQUESTS_PER_MINUTE = 600;

function getRoleFromToken(token: string): Role | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { role?: Role };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bot / scraper blocking (see lib/bot-guard.ts for what is and isn't blocked).
  const verdict = botVerdict(pathname, request.headers.get("user-agent"));
  if (verdict) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain", "X-Robots-Tag": "noindex, nofollow" },
    });
  }

  // Cross-site writes are refused for every API route in one place, so no route
  // depends on remembering its own check. Server-to-server callbacks (payments,
  // uploads, cron) send no browser origin headers and are exempt by path too.
  if (
    pathname.startsWith("/api/") &&
    WRITE_METHODS.has(request.method) &&
    !isMachinePath(pathname)
  ) {
    const crossSite = checkSameOrigin(request);
    if (crossSite) return crossSite;

    // No API write needs more than a few tens of KB (the largest is a full
    // property structure). Refuse oversized bodies before any route reads them.
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_API_BODY_BYTES) {
      return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    }
  }

  // Floor against floods from one address: a generous per-IP ceiling across all
  // API calls (a busy dashboard page makes 5-15). Machine callbacks are exempt;
  // per-route and database-backed limits still apply on top.
  if (pathname.startsWith("/api/") && !isMachinePath(pathname)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (ip) {
      const flood = await rateLimit(request, {
        windowMs: 60_000,
        limit: API_REQUESTS_PER_MINUTE,
        key: `api-all:${ip}`,
      });
      if (flood instanceof NextResponse) return flood;
    }
  }

  const token = request.cookies.get("keja-token")?.value;

  if (pathname.startsWith("/dashboard")) {
    if (!token) {
      return NextResponse.redirect(new URL("/auth", request.url));
    }

    const role = getRoleFromToken(token);
    if (!role) {
      // Expired/malformed token: drop the stale cookie so it stops being
      // sent on subsequent requests (and stops triggering 401s/toasts).
      const response = NextResponse.redirect(new URL("/auth", request.url));
      response.cookies.set("keja-token", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 0,
        expires: new Date(0),
        path: "/",
      });
      return response;
    }

    if (pathname === "/dashboard" || pathname === "/dashboard/") {
      return NextResponse.redirect(new URL(getRoleRoute(role), request.url));
    }

    const allowedRoles = getDashboardAllowedRoles(pathname);
    if (!allowedRoles?.includes(role)) {
      return NextResponse.redirect(new URL(getRoleRoute(role), request.url));
    }
  }

  return NextResponse.next();
}
