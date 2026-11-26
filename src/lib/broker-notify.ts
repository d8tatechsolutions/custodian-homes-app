import { getAppUrl } from "@/lib/brand";
import type { BidView } from "@/lib/broker-bids-view";
import { noticeEmailContent, noticeEmailText } from "@/lib/notice-email";
import { notifyUser } from "@/lib/notifications";
import type { NotificationType } from "@/models/Notification";
import { User } from "@/models/User";

/**
 * Broker & marketplace notifications (Phase 5). Best-effort: never throws.
 *
 * Owners/custodians see the broker's name, agency and proposed terms (what
 * they need to decide). Brokers see the listing, the decision and any note —
 * never the owner's contact details or account ids.
 */

type Terms = {
  basis?: string;
  rateBps?: number;
  fixedAmountMinor?: number;
  currency?: string;
};

export function describeTerms(terms: Terms | undefined): string {
  if (!terms) return "";
  if (terms.basis === "first_month_rent") return "First month's rent";
  if (terms.basis === "percentage_of_rent") return `${(terms.rateBps ?? 0) / 100}% of rent`;
  const amount = (terms.fixedAmountMinor ?? 0) / 100;
  const currency = terms.currency === "USD" ? "USD" : "KES";
  return `${currency} ${amount.toLocaleString("en-KE", { maximumFractionDigits: 2 })} fixed`;
}

function bidReviewPath(role: string): string {
  if (role === "custodian") return "/dashboard/custodian/brokers";
  if (role === "system-admin") return "/dashboard/system-admin/marketplace";
  return "/dashboard/admin/brokers";
}

async function roleOf(userId: string): Promise<string> {
  try {
    const user = (await User.findById(userId).select("role isActive").lean()) as {
      role?: string;
      isActive?: boolean;
    } | null;
    return user?.isActive === false ? "" : String(user?.role ?? "");
  } catch {
    return "";
  }
}

async function send(
  userId: string,
  notice: {
    type: NotificationType;
    eventId: string;
    title: string;
    body: string;
    link: string;
    details?: [string, string][];
    cta?: string;
    email: boolean;
  },
) {
  const linkUrl = `${getAppUrl()}${notice.link}`;
  const content = { message: notice.body, details: notice.details, cta: notice.cta };
  await notifyUser(userId, {
    type: notice.type,
    title: notice.title,
    body: notice.body,
    link: notice.link,
    data: { eventId: notice.eventId },
    channels: notice.email ? ["in-app", "email"] : ["in-app"],
    email: notice.email
      ? {
          subjectPrefix: notice.title,
          content: noticeEmailContent(content),
          text: noticeEmailText(content, linkUrl),
          linkUrl,
        }
      : undefined,
  });
}

function bidDetails(view: BidView): [string, string][] {
  const latest = view.offers[view.offers.length - 1];
  return [
    ["Listing", view.listingHeadline],
    ["Property", view.property],
    ["Broker", [view.broker.name, view.broker.agency].filter(Boolean).join(" · ")],
    ["Commission", describeTerms(latest)],
  ];
}

export type BidEvent =
  | "placed"
  | "countered"
  | "approved"
  | "rejected"
  | "counter-accepted"
  | "counter-declined"
  | "withdrawn";

/**
 * One notice per bid event, to whoever has to act or wants to know:
 * placed / counter answered / withdrawn → the approver; countered / approved /
 * rejected → the broker.
 */
export async function notifyBidEvent(
  view: BidView,
  approverUserId: string,
  event: BidEvent,
): Promise<void> {
  try {
    const eventId = `bid:${view._id}:${event}:${view.offers.length}`;
    if (
      event === "placed" ||
      event === "counter-accepted" ||
      event === "counter-declined" ||
      event === "withdrawn"
    ) {
      const role = await roleOf(approverUserId);
      if (!role) return;
      const who = view.broker.agency || view.broker.name || "A broker";
      const copy = {
        placed: {
          title: `Broker request: ${view.listingHeadline}`,
          body: `${who} wants to market "${view.listingHeadline}" for ${describeTerms(view.offers[view.offers.length - 1])}.`,
        },
        "counter-accepted": {
          title: `Counter-offer accepted: ${view.listingHeadline}`,
          body: `${who} accepted your terms and can now share "${view.listingHeadline}".`,
        },
        "counter-declined": {
          title: `Counter-offer declined: ${view.listingHeadline}`,
          body: `${who} declined your counter-offer for "${view.listingHeadline}".`,
        },
        withdrawn: {
          title: `Request withdrawn: ${view.listingHeadline}`,
          body: `${who} withdrew their request to market "${view.listingHeadline}".`,
        },
      }[event];
      await send(approverUserId, {
        type: "broker:bid",
        eventId,
        ...copy,
        link: bidReviewPath(role),
        details: bidDetails(view),
        cta: event === "placed" ? "Review the request" : "Open broker requests",
        email: event !== "withdrawn",
      });
      return;
    }

    const copy = {
      countered: {
        title: `Counter-offer: ${view.listingHeadline}`,
        body: `The owner proposed ${describeTerms(view.offers[view.offers.length - 1])} for "${view.listingHeadline}". Accept or decline it in your requests.`,
      },
      approved: {
        title: `Approved: ${view.listingHeadline}`,
        body: `Your request to market "${view.listingHeadline}" was approved. Your share link is ready in your dashboard.`,
      },
      rejected: {
        title: `Not approved: ${view.listingHeadline}`,
        body: `Your request to market "${view.listingHeadline}" was not approved${view.decisionNote ? `: ${view.decisionNote}` : "."}`,
      },
    }[event];
    await send(view.broker.id, {
      type: "broker:bid",
      eventId,
      ...copy,
      link: "/dashboard/broker?tab=requests",
      details: [
        ["Listing", view.listingHeadline],
        ["Property", view.property],
        ["Commission", describeTerms(view.offers[view.offers.length - 1])],
      ],
      cta: "Open my requests",
      email: true,
    });
  } catch (error) {
    console.warn("[broker-notify] bid failed", error instanceof Error ? error.message : "");
  }
}

async function systemAdminIds(): Promise<string[]> {
  const admins = (await User.find({ role: "system-admin", isActive: true })
    .select("_id")
    .limit(50)
    .lean()) as { _id: unknown }[];
  return admins.map((a) => String(a._id));
}

/** New duplicate-photo flags → platform admins (in-app). */
export async function notifyListingFlagged(listingId: string, count: number): Promise<void> {
  try {
    if (count <= 0) return;
    for (const id of await systemAdminIds()) {
      await send(id, {
        type: "listing:flagged",
        eventId: `flag:${listingId}:${Date.now()}`,
        title: "Possible duplicate listing photos",
        body: `${count} photo${count === 1 ? "" : "s"} on a listing closely match photos on another property. Review them in Brokers & Listings.`,
        link: "/dashboard/system-admin/marketplace",
        email: false,
      });
    }
  } catch (error) {
    console.warn("[broker-notify] flag failed", error instanceof Error ? error.message : "");
  }
}

/** A broker's own listing was submitted for review → platform admins (in-app). */
export async function notifyBrokerListingSubmitted(listing: {
  _id: unknown;
  title: string;
  duplicateFlags?: number;
}): Promise<void> {
  try {
    for (const id of await systemAdminIds()) {
      await send(id, {
        type: "broker:listing",
        eventId: `broker-listing:${String(listing._id)}:submitted:${Date.now()}`,
        title: `Listing to review: ${listing.title}`,
        body: `A broker submitted "${listing.title}" for review${listing.duplicateFlags ? ` (${listing.duplicateFlags} possible duplicate photo${listing.duplicateFlags === 1 ? "" : "s"})` : ""}.`,
        link: "/dashboard/system-admin/marketplace",
        email: false,
      });
    }
  } catch (error) {
    console.warn("[broker-notify] submitted failed", error instanceof Error ? error.message : "");
  }
}

/** Review outcome of a broker's own listing → that broker (email + in-app). */
export async function notifyBrokerListingReviewed(listing: {
  _id: unknown;
  brokerUserId: string;
  title: string;
  status: string;
  reviewNote?: string;
}): Promise<void> {
  try {
    const approved = listing.status === "approved";
    await send(listing.brokerUserId, {
      type: "broker:listing",
      eventId: `broker-listing:${String(listing._id)}:${listing.status}:${Date.now()}`,
      title: approved ? `Listing live: ${listing.title}` : `Listing not approved: ${listing.title}`,
      body: approved
        ? `"${listing.title}" is now live on the marketplace for 60 days.`
        : `"${listing.title}" was not approved${listing.reviewNote ? `: ${listing.reviewNote}` : "."} You can edit it and submit again.`,
      link: "/dashboard/broker?tab=own",
      cta: "Open my listings",
      email: true,
    });
  } catch (error) {
    console.warn("[broker-notify] reviewed failed", error instanceof Error ? error.message : "");
  }
}

/**
 * New marketplace enquiry → the broker (email + in-app). The enquirer's
 * contact details stay in the dashboard; they are not put in the email.
 */
export async function notifyBrokerEnquiry(input: {
  enquiryId: string;
  brokerUserId: string;
  title: string;
}): Promise<void> {
  try {
    await send(input.brokerUserId, {
      type: "broker:listing",
      eventId: `broker-enquiry:${input.enquiryId}`,
      title: `New enquiry: ${input.title}`,
      body: `Someone asked about "${input.title}". Open your listings to see their details and reply.`,
      link: "/dashboard/broker?tab=enquiries",
      cta: "See the enquiry",
      email: true,
    });
  } catch (error) {
    console.warn("[broker-notify] enquiry failed", error instanceof Error ? error.message : "");
  }
}
