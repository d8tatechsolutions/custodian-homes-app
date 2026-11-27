import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { RateLimitBucket } from "@/models/RateLimitBucket";

/**
 * Database-backed rate limiting, shared by every server instance.
 *
 * The in-memory limiters reset per Vercel instance, so on their own they are
 * easy to get around. This counts in MongoDB with one atomic upsert per
 * request (fixed windows, auto-expired by a TTL index). Used for sign-in,
 * sign-up, password reset and public forms — not for every API call.
 *
 * If the database is unreachable the check fails OPEN (logged), so a database
 * hiccup never locks everyone out of signing in.
 */

export function clientIp(request: Request): string {
  // Vercel sets x-forwarded-for to the real client first.
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function hitDurableLimit(
  key: string,
  options: { windowMs: number; limit: number },
  now = Date.now(),
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  // Unit tests mock the database; they exercise the in-memory limiters instead.
  if (process.env.NODE_ENV === "test" && !process.env.DURABLE_RATE_LIMIT_IN_TESTS) {
    return { limited: false, retryAfterSeconds: 0 };
  }
  const windowIndex = Math.floor(now / options.windowMs);
  const windowEnd = (windowIndex + 1) * options.windowMs;
  try {
    await connectToDatabase();
    const bucket = (await RateLimitBucket.findOneAndUpdate(
      { _id: `${key}:${windowIndex}` },
      { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(windowEnd + 60_000) } },
      { upsert: true, new: true },
    ).lean()) as { count: number } | null;
    const count = bucket?.count ?? 1;
    return {
      limited: count > options.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1000)),
    };
  } catch (error) {
    console.error(
      "[rate-limit] durable check failed (allowing):",
      error instanceof Error ? error.message : error,
    );
    return { limited: false, retryAfterSeconds: 0 };
  }
}

/** 429 response when over the limit, otherwise null. */
export async function durableRateLimit(
  request: Request,
  options: { windowMs: number; limit: number; key: string; perIp?: boolean },
): Promise<NextResponse | null> {
  const key = options.perIp === false ? options.key : `${options.key}:${clientIp(request)}`;
  const { limited, retryAfterSeconds } = await hitDurableLimit(key, options);
  if (!limited) return null;
  return NextResponse.json(
    { error: "Too many attempts. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
