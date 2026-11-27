import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runCronSteps } from "@/lib/cron/daily";
import { dailySteps } from "@/lib/cron/steps";
import { connectToDatabase } from "@/lib/mongoose";

export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Daily scheduled job. Vercel Cron calls this with
 * `Authorization: Bearer $CRON_SECRET`; any other caller gets 401. When the
 * secret is not configured the job refuses to run at all.
 */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const results = await runCronSteps(dailySteps());
  const ok = results.every((r) => r.ok);
  console.info("[cron] daily", JSON.stringify(results));
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
}
