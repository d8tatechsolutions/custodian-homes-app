import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { authenticateSession } from "@/lib/auth-scope";
import { verifyBrokerProfile } from "@/lib/brokers";
import { connectToDatabase } from "@/lib/mongoose";
import { User } from "@/models/User";

const verifySchema = z.object({
  decision: z.enum(["verified", "rejected", "suspended"]),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSession(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const user = await User.findById(auth.userId).select("role isActive").lean();
  if (!user?.isActive || user.role !== "system-admin") {
    return NextResponse.json({ error: "Forbidden: system-admin required" }, { status: 403 });
  }

  const { id } = await params;

  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = await readJsonBody(request);
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const updated = await verifyBrokerProfile(
      id,
      { userId: auth.userId, role: user.role },
      parsed.data.decision,
      parsed.data.notes,
    );

    return NextResponse.json({ profile: updated });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to verify broker profile" },
      { status: 400 },
    );
  }
}
