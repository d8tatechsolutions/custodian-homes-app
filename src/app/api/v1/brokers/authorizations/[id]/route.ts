import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { authenticateSession } from "@/lib/auth-scope";
import { revokeBrokerAuthorization } from "@/lib/brokers";
import { connectToDatabase } from "@/lib/mongoose";
import { User } from "@/models/User";

const patchSchema = z.object({
  status: z.literal("revoked"),
  reason: z.string().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSession(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const user = await User.findById(auth.userId).select("role isActive").lean();
  if (!user?.isActive || (user.role !== "admin" && user.role !== "system-admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = await readJsonBody(request);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const updated = await revokeBrokerAuthorization(
      { userId: auth.userId, role: user.role },
      id,
      parsed.data.reason,
    );

    return NextResponse.json({ authorization: updated });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update authorization" },
      { status: 400 },
    );
  }
}
