import { NextResponse } from "next/server";

export async function GET() {
  // Logging out must always succeed and always clear the cookie — even when the
  // token is already expired or malformed. Otherwise a stale cookie lingers and
  // keeps triggering 401s on every page load.
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
