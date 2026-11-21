import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import { decryptField } from "@/lib/crypto";
import { getJwtSecret } from "@/lib/jwt";
import { getManagedOwnerId } from "@/lib/managed-owner";
import { connectToDatabase } from "@/lib/mongoose";
import { User } from "@/models/User";

const CLEAR_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 0,
  expires: new Date(0),
  path: "/",
};

function unauthorized(message: string) {
  const response = NextResponse.json({ error: message }, { status: 401 });
  response.cookies.set("keja-token", "", CLEAR_COOKIE);
  return response;
}

export async function GET(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie");
    const token = cookieHeader
      ?.split("; ")
      .find((c) => c.startsWith("keja-token="))
      ?.split("=")[1];
    if (!token) {
      // Anonymous visitor: this is a normal state (login page, after logout),
      // not an expired session. Return 200 so the client does not surface an error.
      return NextResponse.json({ user: null });
    }

    const decoded = jwt.verify(token, getJwtSecret()) as {
      userId: string;
    };
    await connectToDatabase();
    const user = await User.findById(decoded.userId).select("-passwordHash").lean();
    if (!user?.isActive) {
      return unauthorized("User not found");
    }

    return NextResponse.json({
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        role: user.role,
        privileges: user.privileges ?? [],
        managedByOwnerId:
          user.role === "custodian" || user.role === "caretaker"
            ? ((await getManagedOwnerId(String(user._id))) ?? "")
            : "",
        phone: user.phone ?? "",
        whatsapp: user.whatsapp ?? "",
        nationalId: decryptField(user.nationalId ?? ""),
        userCode: user.userCode ?? "",
      },
    });
  } catch (_error) {
    // Invalid or expired token: clear the stale cookie so it stops being sent.
    return unauthorized("Invalid token");
  }
}
