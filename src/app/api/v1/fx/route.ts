import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getUsdKesRate, getUsdKesRateOn } from "@/lib/fx";
import { connectToDatabase } from "@/lib/mongoose";
import { rateLimit } from "@/lib/rate-limit";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Public USD/KES rate (`1 USD = rate KES`). Optional `?date=YYYY-MM-DD` returns
 * the rate that applied on that day (used by reports). Responds 503 only when
 * no rate has ever been stored and the provider is unreachable.
 */
export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 60 });
  if (limit instanceof NextResponse) return limit;

  const date = request.nextUrl.searchParams.get("date");
  if (date && !DAY.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  await connectToDatabase();
  const quote = date ? await getUsdKesRateOn(date) : await getUsdKesRate();
  if (!quote) {
    return NextResponse.json({ error: "Exchange rate unavailable" }, { status: 503 });
  }
  return NextResponse.json(
    { data: { base: "USD", quote: "KES", ...quote } },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
