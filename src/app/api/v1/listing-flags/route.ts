import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { propertyTitleMap } from "@/app/api/v1/_helpers";
import { requireSystemAdmin } from "@/lib/system-admin-guard";
import { Listing } from "@/models/Listing";
import { ListingFlag } from "@/models/ListingFlag";

/** Possible duplicate listings for the system-admin (`?status=open|all`). */
export async function GET(request: NextRequest) {
  const actor = await requireSystemAdmin(request);
  if (actor instanceof NextResponse) return actor;
  const status = request.nextUrl.searchParams.get("status") ?? "open";
  const filter = status === "all" ? {} : { status: "open" };
  const flags = (await ListingFlag.find(filter).sort({ createdAt: -1 }).limit(300).lean()) as {
    _id: unknown;
    listingId: string;
    matchedListingId: string;
    propertyId: string;
    matchedPropertyId: string;
    url: string;
    matchedUrl: string;
    distance: number;
    status: string;
    createdAt: Date;
  }[];
  const listingIds = [...new Set(flags.flatMap((f) => [f.listingId, f.matchedListingId]))];
  const listings = (await Listing.find({ _id: { $in: listingIds } })
    .select("headline state")
    .lean()) as {
    _id: unknown;
    headline: string;
    state: string;
  }[];
  const byId = new Map(listings.map((l) => [String(l._id), l]));
  const titles = await propertyTitleMap([
    ...new Set(flags.flatMap((f) => [f.propertyId, f.matchedPropertyId])),
  ]);
  return NextResponse.json({
    data: flags.map((f) => ({
      ...f,
      _id: String(f._id),
      listing: {
        headline: byId.get(f.listingId)?.headline ?? "",
        state: byId.get(f.listingId)?.state ?? "",
      },
      matchedListing: {
        headline: byId.get(f.matchedListingId)?.headline ?? "",
        state: byId.get(f.matchedListingId)?.state ?? "",
      },
      property: titles.get(f.propertyId) ?? "",
      matchedProperty: titles.get(f.matchedPropertyId) ?? "",
    })),
  });
}
