import { describe, expect, it } from "vitest";
import {
  adminNav,
  brokerNav,
  buildDashboardNav,
  caretakerNav,
  caretakerNavWithTenants,
  custodianNav,
  findGroupForPath,
  groupNavItems,
  systemAdminNav,
  tenantNav,
  tenantSubRoutes,
} from "@/config/dashboardNav";

describe("tenant navigation", () => {
  it("includes the tenant discovery and favourites entries", () => {
    expect(tenantNav.map((item) => item.label)).toEqual([
      "Overview",
      "Browse",
      "Favourites",
      "My Home",
      "Requests",
      "Payments",
      "Messages",
      "Documents",
      "Notifications",
      "Settings",
      "History",
    ]);
  });

  it("routes each entry to its consolidated page, keeping Browse external", () => {
    expect(tenantNav.map((item) => item.to)).toEqual([
      "/dashboard/tenant",
      "/properties",
      "/dashboard/tenant/favourites",
      "/dashboard/tenant/home",
      "/dashboard/tenant/requests",
      "/dashboard/tenant/payments",
      "/dashboard/tenant/messages",
      "/dashboard/tenant/documents",
      "/dashboard/tenant/notifications",
      "/dashboard/tenant/settings",
      "/dashboard/tenant/history",
    ]);
  });

  it("derives sub-routes from the internal entries only", () => {
    expect(tenantSubRoutes).toEqual([
      "/dashboard/tenant/favourites",
      "/dashboard/tenant/home",
      "/dashboard/tenant/requests",
      "/dashboard/tenant/payments",
      "/dashboard/tenant/messages",
      "/dashboard/tenant/documents",
      "/dashboard/tenant/notifications",
      "/dashboard/tenant/settings",
      "/dashboard/tenant/history",
    ]);
  });
});

describe("admin navigation", () => {
  it("provides full admin dashboard sections pointing to /dashboard/admin", () => {
    expect(adminNav.some((item) => item.to === "/dashboard/admin")).toBe(true);
    expect(adminNav.some((item) => item.to === "/dashboard/admin/portfolio")).toBe(true);
    expect(adminNav.some((item) => item.to === "/dashboard/admin/units")).toBe(true);
    expect(adminNav.some((item) => item.to === "/dashboard/admin/tenants")).toBe(true);
    expect(adminNav.some((item) => item.to === "/dashboard/admin/accounting")).toBe(true);
    expect(adminNav.some((item) => item.to === "/dashboard/admin/team")).toBe(true);
    expect(adminNav.some((item) => item.to === "/dashboard/admin/brokers")).toBe(true);
  });
});

describe("manager navigation is unaffected", () => {
  it("keeps applications and move requests on the manager dashboard", () => {
    expect(adminNav.some((item) => item.to === "/dashboard/admin/applications")).toBe(true);
    expect(adminNav.some((item) => item.to === "/dashboard/admin/move-requests")).toBe(true);
  });

  it("still hides applications from caretakers", () => {
    expect(caretakerNav.some((item) => item.to === "/dashboard/caretaker/applications")).toBe(
      false,
    );
  });
});

describe("custodian navigation", () => {
  it("includes Communications", () => {
    expect(custodianNav.some((item) => item.to === "/dashboard/custodian/communications")).toBe(
      true,
    );
  });
});

describe("system admin navigation", () => {
  it("includes Communications", () => {
    expect(
      systemAdminNav.some((item) => item.to === "/dashboard/system-admin/communications"),
    ).toBe(true);
  });
});

describe("broker navigation", () => {
  it("includes broker specific sections pointing to /dashboard/broker", () => {
    expect(brokerNav.map((item) => item.to)).toEqual([
      "/dashboard/broker",
      "/dashboard/broker/listings",
      "/dashboard/broker/authorizations",
      "/dashboard/broker/prospects",
      "/dashboard/broker/messages",
      "/dashboard/broker/commissions",
      "/dashboard/broker/profile",
      "/dashboard/broker/history",
    ]);
  });
});

describe("nav grouping", () => {
  const allNavs = [
    adminNav,
    caretakerNav,
    caretakerNavWithTenants,
    custodianNav,
    brokerNav,
    systemAdminNav,
    tenantNav,
    buildDashboardNav("admin"),
  ];
  const knownGroups = new Set([
    "overview",
    "properties",
    "people",
    "operations",
    "administration",
    "personal",
    "finance",
    "listings",
  ]);

  it("assigns every configured item a known group", () => {
    for (const nav of allNavs) {
      for (const item of nav) {
        expect(item.group, `${item.label} (${item.to})`).toBeDefined();
        expect(knownGroups.has(item.group as string), `${item.label} (${item.to})`).toBe(true);
      }
    }
  });

  it("groups consecutive items by their group slug", () => {
    expect(groupNavItems(adminNav).map((g) => [g.id, g.label, g.items.length])).toEqual([
      ["overview", "Overview", 1],
      ["properties", "Properties", 2],
      ["people", "People", 5],
      ["operations", "Operations", 6],
      ["administration", "Administration", 4],
    ]);
  });

  it("groups tenant personal links and keeps discovery in listings", () => {
    expect(groupNavItems(tenantNav).map((g) => [g.id, g.items.length])).toEqual([
      ["overview", 1],
      ["listings", 1],
      ["personal", 9],
    ]);
  });

  it("groups broker messages under operations, commissions under finance and profile under administration", () => {
    expect(groupNavItems(brokerNav).map((g) => [g.id, g.items.length])).toEqual([
      ["overview", 1],
      ["properties", 1],
      ["people", 2],
      ["operations", 1],
      ["finance", 1],
      ["administration", 2],
    ]);
  });

  it("skips items without a group", () => {
    const plain = { ...adminNav[0], group: undefined };
    expect(groupNavItems([plain])).toEqual([]);
    expect(groupNavItems([])).toEqual([]);
  });
});

describe("findGroupForPath", () => {
  const adminGroups = groupNavItems(adminNav);
  const tenantGroups = groupNavItems(tenantNav);

  it("matches root routes exactly", () => {
    expect(findGroupForPath(adminGroups, "/dashboard/admin")).toBe("overview");
    expect(findGroupForPath(adminGroups, "/dashboard/admin/portfolio")).not.toBe("overview");
  });

  it("matches nested routes by prefix", () => {
    expect(findGroupForPath(adminGroups, "/dashboard/admin/portfolio/123")).toBe("properties");
    expect(findGroupForPath(adminGroups, "/dashboard/admin/notifications")).toBe("operations");
    expect(findGroupForPath(adminGroups, "/dashboard/admin/settings")).toBe("administration");
  });

  it("resolves tenant deep links and external routes", () => {
    expect(findGroupForPath(tenantGroups, "/dashboard/tenant/favourites")).toBe("personal");
    expect(findGroupForPath(tenantGroups, "/properties")).toBe("listings");
  });

  it("returns null for unknown paths or empty groups", () => {
    expect(findGroupForPath(adminGroups, "/dashboard/admin/unknown")).toBeNull();
    expect(findGroupForPath([], "/dashboard/admin")).toBeNull();
  });
});
