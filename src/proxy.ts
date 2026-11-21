import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getJwtSecret } from "@/lib/jwt";
import { getDashboardAllowedRoles, getRoleRoute, type Role } from "@/lib/role-routes";

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};

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
