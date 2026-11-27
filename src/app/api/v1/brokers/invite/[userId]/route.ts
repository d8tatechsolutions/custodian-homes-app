import crypto from "node:crypto";
import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateSession } from "@/lib/auth-scope";
import { BROKER_INVITE_TTL_MS, deliverBrokerInvite } from "@/lib/broker-invite";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { BrokerProfile } from "@/models/BrokerProfile";
import { User } from "@/models/User";

/**
 * Re-sends a fresh set-password link to a broker who has not activated yet.
 * Only the person who added the broker, or the system-admin, may do this.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 10 });
  if (limit instanceof NextResponse) return limit;
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { userId } = await context.params;
  if (!isValidObjectId(userId))
    return NextResponse.json({ error: "Invalid broker" }, { status: 400 });
  await connectToDatabase();
  const auth = await authenticateSession(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const caller = (await User.findById(auth.userId).select("role isActive").lean()) as {
    role?: string;
    isActive?: boolean;
  } | null;
  if (!caller?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = (await BrokerProfile.findOne({ userId }).select("addedByUserId").lean()) as {
    addedByUserId?: string;
  } | null;
  if (!profile || (caller.role !== "system-admin" && profile.addedByUserId !== auth.userId)) {
    return NextResponse.json({ error: "Broker not found" }, { status: 404 });
  }
  const broker = (await User.findById(userId)
    .select("isActive isVerified role email name")
    .lean()) as {
    isActive?: boolean;
    isVerified?: boolean;
    role?: string;
    email?: string;
    name?: string;
  } | null;
  if (broker?.role !== "broker")
    return NextResponse.json({ error: "Broker not found" }, { status: 404 });
  if (broker.isActive && broker.isVerified) {
    return NextResponse.json(
      { error: "This broker has already set their password" },
      { status: 409 },
    );
  }

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + BROKER_INVITE_TTL_MS);
  await User.updateOne(
    { _id: userId },
    { $set: { verificationToken: token, verificationTokenExpiry: expires } },
  );
  const delivery = await deliverBrokerInvite({
    email: broker.email ?? "",
    name: broker.name ?? "",
    token,
    expiresAt: expires,
  });
  return NextResponse.json({ data: delivery });
}
