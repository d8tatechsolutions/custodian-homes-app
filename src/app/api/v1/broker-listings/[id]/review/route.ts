import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { writeAuditEvent } from "@/lib/audit";
import {
  type BrokerListingDoc,
  expiryFromNow,
  toPrivateBrokerListing,
} from "@/lib/broker-listings";
import { notifyBrokerListingReviewed } from "@/lib/broker-notify";
import { checkSameOrigin } from "@/lib/rate-limit";
import { requireSystemAdmin } from "@/lib/system-admin-guard";
import { BrokerListing } from "@/models/BrokerListing";

const input = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional().default(""),
});

/** System-admin approves (live for 60 days) or rejects (with a reason the broker sees). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = checkSameOrigin(request);
  if (originError) return originError;
  const actor = await requireSystemAdmin(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid listing id" }, { status: 400 });

  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  if (parsed.data.decision === "reject" && !parsed.data.note) {
    return NextResponse.json({ error: "Tell the broker why it was rejected" }, { status: 400 });
  }

  const now = new Date();
  const approve = parsed.data.decision === "approve";
  const res = await BrokerListing.updateOne(
    { _id: id, status: "submitted" },
    {
      $set: {
        status: approve ? "approved" : "rejected",
        reviewedByUserId: actor.userId,
        reviewedAt: now,
        reviewNote: parsed.data.note,
        approvedAt: approve ? now : null,
        expiresAt: approve ? expiryFromNow(now) : null,
      },
    },
  );
  if (res.modifiedCount === 0) {
    return NextResponse.json({ error: "This listing is not waiting for review" }, { status: 409 });
  }
  await writeAuditEvent({
    actor: { userId: actor.userId, role: "system-admin" },
    action: approve ? "broker_listing.approved" : "broker_listing.rejected",
    entityType: "broker_listing",
    entityId: id,
    after: { note: parsed.data.note },
  });
  const fresh = (await BrokerListing.findById(id).lean()) as BrokerListingDoc;
  await notifyBrokerListingReviewed(fresh);
  return NextResponse.json({ data: toPrivateBrokerListing(fresh) });
}
