import { NextResponse } from "next/server";
import { getReleaseFlags } from "@/lib/feature-flags";

/**
 * Release flags for the UI. Public and non-sensitive (on/off only); every
 * server route still enforces its own flag, so this only controls what is shown.
 */
export async function GET() {
  return NextResponse.json(
    { data: getReleaseFlags() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
