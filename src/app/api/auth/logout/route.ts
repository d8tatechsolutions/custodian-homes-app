import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Clears the session cookie. Logging out must always succeed — even when the
 * token is already expired or malformed — otherwise a stale cookie lingers and
 * keeps triggering 401s on every page load.
 */
function clearSession(): NextResponse {
  const response = NextResponse.json({ message: "OK" });
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

/** The app logs out with POST; the proxy's same-origin check covers it. */
export async function POST() {
  return clearSession();
}

/**
 * Kept for pages still running the previous build, but only when the browser
 * says the request came from this site. A link or image on another site
 * (Sec-Fetch-Site: cross-site / same-site / none) can no longer sign people out.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return NextResponse.json({ error: "Use POST to sign out" }, { status: 405 });
  }
  return clearSession();
}
