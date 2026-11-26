import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { BidError, decideBid } from "@/lib/broker-bids";
import { viewBids } from "@/lib/broker-bids-view";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { authenticate, type Role } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { bidDecisionInput, toBidTerms } from "@/lib/schemas/broker-bids";
import { User } from "@/models/User";

/** The property's approver approves, rejects (with a reason) or counters a broker's request. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid request id" }, { status: 400 });

  await connectToDatabase();
  const auth = authenticate(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = (await User.findById(auth.userId).select("role isActive").lean()) as {
    role?: Role;
    isActive?: boolean;
  } | null;
  if (!user?.isActive || !user.role || user.role === "broker" || user.role === "tenant") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bidDecisionInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid decision", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const bid = await decideBid({ userId: auth.userId, role: user.role }, id, {
      action: parsed.data.action,
      note: parsed.data.note,
      terms: parsed.data.action === "counter" ? toBidTerms(parsed.data.terms) : undefined,
    });
    const [view] = await viewBids([bid]);
    return NextResponse.json({ data: view });
  } catch (error) {
    if (error instanceof BidError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
