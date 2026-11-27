import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { writeAuditEvent } from "@/lib/audit";
import { checkSameOrigin } from "@/lib/rate-limit";
import { requireSystemAdmin } from "@/lib/system-admin-guard";
import { Listing } from "@/models/Listing";
import { ListingFlag } from "@/models/ListingFlag";

const input = z.object({
  action: z.enum(["dismiss", "take_down"]),
  note: z.string().trim().max(1000).optional().default(""),
});

/**
 * Resolves a duplicate-photo flag: dismiss (genuine), or take the flagged
 * listing down (withdrawn — no longer shown on the marketplace).
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = checkSameOrigin(request);
  if (originError) return originError;
  const actor = await requireSystemAdmin(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid flag id" }, { status: 400 });

  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (parsed.data.action === "take_down" && !parsed.data.note) {
    return NextResponse.json(
      { error: "Add a reason for taking the listing down" },
      { status: 400 },
    );
  }

  const flag = (await ListingFlag.findOne({ _id: id, status: "open" }).lean()) as {
    listingId: string;
    propertyId: string;
  } | null;
  if (!flag)
    return NextResponse.json({ error: "Flag not found or already resolved" }, { status: 404 });

  if (parsed.data.action === "take_down") {
    await Listing.updateOne({ _id: flag.listingId }, { $set: { state: "withdrawn" } });
  }
  await ListingFlag.updateOne(
    { _id: id, status: "open" },
    {
      $set: {
        status: parsed.data.action === "dismiss" ? "dismissed" : "actioned",
        resolvedByUserId: actor.userId,
        resolvedAt: new Date(),
        note: parsed.data.note,
      },
    },
  );
  await writeAuditEvent({
    actor: { userId: actor.userId, role: "system-admin" },
    action: parsed.data.action === "dismiss" ? "listing.flag_dismissed" : "listing.taken_down",
    entityType: "listing",
    entityId: flag.listingId,
    scope: { propertyId: flag.propertyId },
    after: { flagId: id, note: parsed.data.note },
  });
  return NextResponse.json({ data: { id } });
}
