import { type NextRequest, NextResponse } from "next/server";

import { getAppUrl } from "@/lib/brand";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetAt < now) {
      memoryStore.delete(key);
    }
  }
}

setInterval(cleanupExpired, 60_000);

// `x-forwarded-for` is only trustworthy when deployed behind a proxy that
// overwrites it; IP-less requests fall back to a unique per-request key so they
// never share (and exhaust) a common throttle bucket. Pass an explicit `key`
// (e.g. an authenticated userId) to scope the bucket to the actor instead of
// their IP.
export async function rateLimit(
  request: NextRequest,
  options: { windowMs?: number; limit?: number; key?: string } = {},
) {
  const { windowMs = 60_000, limit = 10, key } = options;
  const ip = request.headers.get("x-forwarded-for") ?? crypto.randomUUID();
  const rateKey = key ?? `ratelimit:${ip}`;
  const now = Date.now();
  const resetAt = now + windowMs;

  const entry = memoryStore.get(rateKey);

  if (!entry || entry.resetAt < now) {
    memoryStore.set(rateKey, { count: 1, resetAt });
    return { remaining: limit - 1, reset: resetAt };
  }

  if (entry.count >= limit) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil((entry.resetAt - now) / 1000).toString() },
      },
    );
  }

  entry.count++;
  return { remaining: limit - entry.count, reset: entry.resetAt };
}

export function rateLimitHeaders(response: NextResponse, remaining: number, reset: number) {
  response.headers.set("X-RateLimit-Remaining", remaining.toString());
  response.headers.set("X-RateLimit-Reset", Math.ceil(reset / 1000).toString());
  return response;
}

/** The address this request was served on (a Vercel preview, www or the bare domain). */
function servedOrigin(request: NextRequest): string | null {
  try {
    return request.nextUrl.origin;
  } catch {
    return null;
  }
}

/**
 * Rejects cross-site writes. A request passes when its Origin is the configured app
 * address or the address it was served on. A hostile page can't pass either test:
 * the browser always sends that page's own origin.
 */
export function checkSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin")?.replace(/\/+$/, "");
  const appOrigin = getAppUrl();
  if (origin && origin !== appOrigin && origin !== servedOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "same-site") {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  return null;
}
