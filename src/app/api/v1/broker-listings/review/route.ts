import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { type BrokerListingDoc, toPrivateBrokerListing } from "@/lib/broker-listings";
import { requireSystemAdmin } from "@/lib/system-admin-guard";
import { BrokerListing } from "@/models/BrokerListing";
import { BrokerProfile } from "@/models/BrokerProfile";
import { User } from "@/models/User";

/** System-admin review queue (`?status=submitted|approved|rejected|all`), oldest first. */
export async function GET(request: NextRequest) {
  const actor = await requireSystemAdmin(request);
  if (actor instanceof NextResponse) return actor;
  const status = request.nextUrl.searchParams.get("status") ?? "submitted";
  const filter = status === "all" ? {} : { status };
  const rows = (await BrokerListing.find(filter)
    .sort({ submittedAt: 1, updatedAt: -1 })
    .limit(300)
    .lean()) as BrokerListingDoc[];

  const brokerIds = [...new Set(rows.map((r) => r.brokerUserId))];
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: brokerIds } })
      .select("name email phone")
      .lean() as Promise<{ _id: unknown; name?: string; email?: string; phone?: string }[]>,
    BrokerProfile.find({ userId: { $in: brokerIds } })
      .select("userId agencyName status")
      .lean() as Promise<{ userId: string; agencyName?: string; status?: string }[]>,
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const profileById = new Map(profiles.map((p) => [p.userId, p]));

  return NextResponse.json({
    data: rows.map((r) => ({
      ...toPrivateBrokerListing(r),
      broker: {
        name: userById.get(r.brokerUserId)?.name ?? "",
        email: userById.get(r.brokerUserId)?.email ?? "",
        phone: userById.get(r.brokerUserId)?.phone ?? "",
        agency: profileById.get(r.brokerUserId)?.agencyName ?? "",
        profileStatus: profileById.get(r.brokerUserId)?.status ?? "",
      },
    })),
  });
}
