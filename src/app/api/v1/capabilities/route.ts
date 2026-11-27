import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateSession } from "@/lib/auth-scope";
import { getCapabilities } from "@/lib/authorization";

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const capabilities = await getCapabilities(auth.userId);
  if (!capabilities) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ data: capabilities });
}
