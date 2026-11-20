import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { isUserCode, normalizeUserCode, userCodeLookupFilter } from "@/lib/user-code";
import { requireUserCodeLookupActor } from "@/lib/user-code-access";
import { User } from "@/models/User";

export const dynamic = "force-dynamic";

interface UserLookupDoc {
  _id: unknown;
  name?: string;
  role?: string;
  isActive?: boolean;
  userCode?: string;
}

const MINUTE_WINDOW_MS = 60_000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves a single `CXXXXXX` user code to a minimal account record.
 *
 * Every control here is deliberate: the actor is resolved from the database
 * before the limiter runs (so the bucket is keyed to a real identity), the code
 * is validated before any query (so malformed input cannot become a scan
 * trigger), only an exact `$eq` filter is ever issued, and a hit is audited
 * before the record leaves the server.
 */
export async function GET(request: NextRequest) {
  const actor = await requireUserCodeLookupActor(request);
  if (actor instanceof NextResponse) return actor;

  // Actor-keyed buckets: passing `key` keeps the limiter off the spoofable
  // `x-forwarded-for` path entirely. `rateLimit` returns its headers only via
  // `rateLimitHeaders`, which this route never calls — an enumerator must not
  // get a remaining-count to schedule probes against.
  const perMinute = await rateLimit(request, {
    windowMs: MINUTE_WINDOW_MS,
    limit: 10,
    key: `user-code-lookup:${actor.userId}`,
  });
  if (perMinute instanceof NextResponse) return perMinute;

  const perDay = await rateLimit(request, {
    windowMs: DAY_WINDOW_MS,
    limit: 100,
    key: `user-code-lookup-day:${actor.userId}`,
  });
  if (perDay instanceof NextResponse) return perDay;

  const raw = request.nextUrl.searchParams.get("code") ?? "";
  if (!isUserCode(raw)) {
    return NextResponse.json({ error: "Invalid user code" }, { status: 400 });
  }

  const code = normalizeUserCode(raw);
  const found = (await User.findOne(userCodeLookupFilter(code))
    .select("name role isActive userCode")
    .lean()) as UserLookupDoc | null;

  if (!found) {
    // Uniform empty result: a well-formed miss must be indistinguishable from a
    // code that was never issued. Never log the code alongside any PII.
    console.warn("[user-code] lookup miss", { actorUserId: actor.userId, code });
    return NextResponse.json({ data: [] });
  }

  const userCode = found.userCode ?? code;

  try {
    await writeAuditEvent({
      actor: { userId: actor.userId, role: actor.role },
      action: "user.code_lookup",
      entityType: "user",
      entityId: String(found._id),
      after: { userCode, surface: "lookup" },
      request: {
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    });
  } catch {
    // An unaudited lookup must not succeed: fail closed rather than hand back
    // the record.
    console.error("[user-code] audit write failed", {
      actorUserId: actor.userId,
      entityId: String(found._id),
    });
    return NextResponse.json({ error: "Unable to complete lookup" }, { status: 500 });
  }

  return NextResponse.json({
    data: [
      {
        id: String(found._id),
        name: found.name ?? "",
        role: found.role ?? "",
        isActive: found.isActive !== false,
        userCode,
      },
    ],
  });
}
