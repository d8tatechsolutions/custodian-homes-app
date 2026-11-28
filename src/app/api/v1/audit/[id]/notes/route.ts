import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { recordAudit } from "@/lib/audit-records";
import { resolveRequestContext } from "@/lib/auth-scope";
import { connectToDatabase } from "@/lib/mongoose";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { AuditEvent } from "@/models/AuditEvent";
import { AuditNote } from "@/models/AuditNote";

const noteInput = z.object({ text: z.string().trim().min(1).max(1000) });

/**
 * POST /api/v1/audit/:id/notes — the system admin annotates an entry. The
 * entry itself is never changed; the note is stored beside it and shown to
 * everyone who can see that entry.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limited instanceof NextResponse) return limited;
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const { id } = await context.params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });
  }

  await connectToDatabase();
  const ctx = await resolveRequestContext(request);
  if (!ctx.auth || !ctx.user?.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "system-admin") {
    return NextResponse.json({ error: "Only the platform admin can add notes" }, { status: 403 });
  }

  const parsed = noteInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Write a note of up to 1000 characters" }, { status: 400 });
  }

  const event = (await AuditEvent.findById(id).select("scope").lean()) as {
    scope?: { propertyId?: string };
  } | null;
  if (!event) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  const authorUserId = String(ctx.user._id);
  const note = await AuditNote.create({
    auditEventId: id,
    authorUserId,
    authorName: ctx.user.name ?? "",
    text: parsed.data.text,
  });
  await recordAudit({
    actor: { userId: authorUserId, role: ctx.user.role },
    action: "audit.note_added",
    entityType: "audit",
    entityId: id,
    scope: { propertyId: event.scope?.propertyId ?? "" },
    after: { note: parsed.data.text },
  });

  return NextResponse.json(
    {
      data: {
        id: String(note._id),
        authorName: note.authorName || "Platform admin",
        text: note.text,
        createdAt: new Date(note.createdAt).toISOString(),
      },
    },
    { status: 201 },
  );
}
