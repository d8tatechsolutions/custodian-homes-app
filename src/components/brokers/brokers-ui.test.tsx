import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BidView } from "@/types/brokers";

vi.mock("@/hooks/use-properties", () => ({
  useProperties: () => ({
    properties: [{ _id: "p1", title: "Sunrise", ownerId: "owner-1", blocks: [] }],
    loading: false,
  }),
}));
vi.mock("@/lib/uploadthing", () => ({
  useUploadThing: () => ({ startUpload: vi.fn(), isUploading: false }),
}));

import { AddBrokerDialog } from "@/components/brokers/AddBrokerDialog";
import { BidRequestsPanel } from "@/components/brokers/BidRequestsPanel";
import { BrokerRequestsPanel } from "@/components/brokers/BrokerRequestsPanel";
import { describeTerms } from "@/components/brokers/CommissionTermsFields";
import { MarketplaceBrokerListings } from "@/components/brokers/MarketplaceBrokerListings";
import { resetFxCaches } from "@/hooks/use-fx";

function bid(overrides: Partial<BidView> = {}): BidView {
  return {
    _id: "b1",
    listingId: "l1",
    listingHeadline: "2-bed in Kilimani",
    askingRent: 50000,
    propertyId: "p1",
    property: "Sunrise",
    unitId: "u1",
    status: "pending",
    awaiting: "owner",
    expiresAt: "2026-12-10T00:00:00Z",
    createdAt: "2026-11-26T00:00:00Z",
    offers: [
      {
        basis: "first_month_rent",
        rateBps: 1000,
        by: "broker",
        byUserId: "br",
        at: "2026-11-26",
        message: "Know the area",
      },
    ],
    decisionNote: "",
    shareCode: "",
    broker: { id: "br", name: "Amina", agency: "Prime Homes", tenantsBrought: 4 },
    ...overrides,
  };
}

let calls: { url: string; body?: unknown }[] = [];
function mockApi(routes: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      return new Response(JSON.stringify({ data: key ? routes[key] : null }), {
        status: key ? 200 : 404,
      });
    }),
  );
}

beforeEach(() => resetFxCaches());
afterEach(() => vi.unstubAllGlobals());

describe("describeTerms", () => {
  it("reads naturally", () => {
    expect(describeTerms({ basis: "first_month_rent", rateBps: 1000 })).toBe(
      "10% of the first month's rent",
    );
    expect(describeTerms({ basis: "percentage_of_rent", rateBps: 250 })).toBe(
      "2.5% of rent collected",
    );
    expect(describeTerms({ basis: "fixed", fixedAmountMinor: 10_000, currency: "USD" })).toBe(
      "$100.00 fixed",
    );
  });
});

describe("BidRequestsPanel (owner)", () => {
  it("groups competing brokers per listing and shows their track record", () => {
    mockApi({});
    render(
      <BidRequestsPanel
        bids={[
          bid(),
          bid({ _id: "b2", broker: { id: "x", name: "Brian", agency: "", tenantsBrought: 0 } }),
        ]}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("2-bed in Kilimani")).toBeInTheDocument();
    expect(screen.getByText(/2 brokers/)).toBeInTheDocument();
    expect(screen.getByText(/4 tenants brought before/)).toBeInTheDocument();
  });

  it("approves after confirmation and requires a reason to reject", async () => {
    mockApi({ "/api/v1/broker-bids/b1/decision": bid({ status: "accepted", awaiting: null }) });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<BidRequestsPanel bids={[bid()]} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: /Reject/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Approve/ }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.at(-1)?.body).toEqual({ action: "approve", note: "" });
  });
});

describe("BrokerRequestsPanel (broker)", () => {
  it("lets the broker accept a counter-offer", async () => {
    const countered = bid({
      status: "countered",
      awaiting: "broker",
      offers: [
        bid().offers[0],
        {
          basis: "first_month_rent",
          rateBps: 800,
          by: "owner",
          byUserId: "owner-1",
          at: "2026-11-27",
        },
      ],
    });
    mockApi({ "/api/v1/broker-bids/b1/respond": countered });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<BrokerRequestsPanel bids={[countered]} onChanged={onChanged} />);
    expect(screen.getByText(/Owner countered/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Accept 8% of the first month's rent/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.at(-1)?.body).toEqual({ action: "accept" });
  });
});

describe("AddBrokerDialog", () => {
  it("guides the user until the required details are in, then shows the set-password link", async () => {
    mockApi({
      "/api/v1/brokers/invite": {
        id: "u9",
        name: "Amina",
        inviteUrl: "https://x/auth/verify?token=t",
        inviteExpiresAt: "z",
      },
    });
    const user = userEvent.setup();
    render(<AddBrokerDialog inviterRole="admin" currentUserId="owner-1" />);
    await user.click(screen.getByRole("button", { name: /Add broker/ }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Add broker" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Full name"), "Amina Wanjiku");
    await user.type(within(dialog).getByLabelText("Email"), "amina@example.com");
    await user.type(within(dialog).getByLabelText("Phone"), "+254712345678");
    await user.type(within(dialog).getByLabelText("National ID"), "12345678");
    await user.type(within(dialog).getByLabelText("M-Pesa number"), "0712345678");
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(await screen.findByDisplayValue("https://x/auth/verify?token=t")).toBeInTheDocument();
  });
});

describe("MarketplaceBrokerListings", () => {
  it("renders nothing when there are no broker listings", async () => {
    mockApi({ "/api/v1/marketplace/broker-listings": [] });
    const { container } = render(<MarketplaceBrokerListings />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("labels broker listings and links to their page", async () => {
    mockApi({
      "/api/v1/marketplace/broker-listings": [
        {
          id: "x1",
          purpose: "sale",
          title: "Villa",
          area: "Runda",
          county: "Nairobi",
          price: 45_000_000,
          bedrooms: 5,
          bathrooms: 4,
          propertyType: "House",
          photos: [],
          listedBy: "Prime Homes",
        },
      ],
    });
    render(<MarketplaceBrokerListings />);
    expect(await screen.findByText("Listed by Prime Homes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Villa/ })).toHaveAttribute(
      "href",
      "/marketplace/broker/x1",
    );
  });
});
