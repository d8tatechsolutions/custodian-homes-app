import crypto from "node:crypto";
import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/brand";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { authenticate } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { BrokerProfile } from "@/models/BrokerProfile";
import { User } from "@/models/User";

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Issues a fresh set-password link for a broker who has not activated yet.
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
  const auth = authenticate(request);
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
  const broker = (await User.findById(userId).select("isActive isVerified role").lean()) as {
    isActive?: boolean;
    isVerified?: boolean;
    role?: string;
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
  const expires = new Date(Date.now() + INVITE_TTL_MS);
  await User.updateOne(
    { _id: userId },
    { $set: { verificationToken: token, verificationTokenExpiry: expires } },
  );
  return NextResponse.json({
    data: {
      inviteUrl: `${getAppUrl()}/auth/verify?token=${token}&invited=1`,
      inviteExpiresAt: expires.toISOString(),
    },
  });
}
