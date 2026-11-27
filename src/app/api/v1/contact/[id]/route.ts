import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateSession } from "@/lib/auth-scope";

import { connectToDatabase } from "@/lib/mongoose";
import { ContactMessage } from "@/models/ContactMessage";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await authenticateSession(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "system-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await connectToDatabase();
  const updated = await ContactMessage.findByIdAndUpdate(
    id,
    { status: "read", readAt: new Date(), readBy: user.userId },
    { new: true },
  ).lean();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: updated });
}
