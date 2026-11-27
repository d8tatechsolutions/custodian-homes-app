import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateSession } from "@/lib/auth-scope";
import { createBrokerListingPublisher } from "@/lib/brokers";

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
    const publisher = await createBrokerListingPublisher(auth.userId, id);

    return NextResponse.json({
      publisher,
      shareUrl: `/marketplace/${id}?ref=${publisher.shareCode}`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to publish listing for broker" },
      { status: 400 },
    );
  }
}
