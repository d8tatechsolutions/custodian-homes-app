import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateSession } from "@/lib/auth-scope";
import { acceptCommissionAgreement } from "@/lib/brokers";
import { publicErrorMessage } from "@/lib/public-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSession(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const updated = await acceptCommissionAgreement(auth.userId, id);
    return NextResponse.json({ agreement: updated });
  } catch (err) {
    return NextResponse.json(
      { error: publicErrorMessage(err, "Failed to accept agreement") },
      { status: 400 },
    );
  }
}
