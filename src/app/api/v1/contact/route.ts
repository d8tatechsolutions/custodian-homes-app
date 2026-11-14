import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { sendContactMessage } from "@/lib/email";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { contactInput } from "@/lib/schemas/contact";

export async function POST(request: NextRequest) {
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const limited = await rateLimit(request, { windowMs: 60_000, limit: 5, key: "contact" });
  if (limited instanceof NextResponse) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = contactInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const ok = await sendContactMessage(parsed.data);
  if (!ok) {
    return NextResponse.json({ error: "Failed to send message" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
