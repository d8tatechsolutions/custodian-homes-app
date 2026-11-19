import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveDashboardActor } from "@/app/api/v1/_helpers";
import { decideRequest, serializeRequest } from "@/lib/chat/dm";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limited instanceof NextResponse) return limited;
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
  }
  const authError = await requirePermission(request, "chat:send");
  if (authError) return authError;

  await connectToDatabase();
  const actor = await resolveDashboardActor(request, "chat:send");
  if (actor instanceof NextResponse) return actor;

  const result = await decideRequest({
    requestId: id,
    actorUserId: actor.userId,
    decision: "declined",
  });
  if ("error" in result) {
    const status = result.error === "not-found" ? 404 : result.error === "forbidden" ? 403 : 409;
    return NextResponse.json({ error: "Request cannot be declined" }, { status });
  }
  const chatRequest = serializeRequest(result.request);
  return NextResponse.json({ data: chatRequest, request: chatRequest });
}
