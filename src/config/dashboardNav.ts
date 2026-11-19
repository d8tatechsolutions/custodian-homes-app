import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Bell,
  Building2,
  Calculator,
  CreditCard,
  DoorOpen,
  FileBarChart,
  FileText,
  Heart,
  Home,
  Mail,
  MessagesSquare,
  Search,
  Settings,
  Shield,
  Tags,
  Trash2,
  UserCog,
  Users,
  Wrench,
} from "lucide-react";

export interface DashNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon?: LucideIcon;
  items: DashNavItem[];
}

const NAV_GROUPS: Record<string, { label: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: Home },
  properties: { label: "Properties", icon: Building2 },
  people: { label: "People", icon: Users },
  operations: { label: "Operations", icon: Wrench },
  administration: { label: "Administration", icon: Settings },
  personal: { label: "Personal", icon: Heart },
  finance: { label: "Finance", icon: Calculator },
  listings: { label: "Listings", icon: Tags },
};

export const groupNavItems = (items: DashNavItem[]): NavGroup[] => {
  const groups: NavGroup[] = [];
  for (const item of items) {
    if (!item.group) continue;
    const last = groups[groups.length - 1];
    if (last && last.id === item.group) {
      last.items.push(item);
      continue;
    }
    const meta = NAV_GROUPS[item.group];
    groups.push({
      id: item.group,
      label: meta?.label ?? item.group,
      icon: meta?.icon,
      items: [item],
    });
  }
  return groups;
};

const isActiveRoute = (to: string, pathname: string): boolean => {
  const isRoot = /^\/dashboard\/[^/]+$/.test(to);
  return isRoot ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
};

export const findGroupForPath = (groups: NavGroup[], pathname: string): string | null => {
  for (const group of groups) {
    if (group.items.some((item) => isActiveRoute(item.to, pathname))) return group.id;
  }
  return null;
};

type Role = "tenant" | "caretaker" | "custodian" | "admin" | "broker" | "system-admin";

interface Section {
  slug: string;
  label: string;
  icon: LucideIcon;
  group: string;
}

const baseSections = [
  { slug: "", label: "Overview", icon: Home, group: "overview" },
  { slug: "/portfolio", label: "Portfolio", icon: Building2, group: "properties" },
  { slug: "/units", label: "Units", icon: DoorOpen, group: "properties" },
  { slug: "/tenants", label: "Tenants", icon: Users, group: "people" },
  { slug: "/applications", label: "Applications", icon: FileText, group: "people" },
  { slug: "/move-requests", label: "Move Requests", icon: ArrowLeftRight, group: "people" },
  { slug: "/team", label: "Team", icon: UserCog, group: "people" },
  { slug: "/brokers", label: "Brokers", icon: Shield, group: "people" },
  { slug: "/tasks", label: "Tasks & Maintenance", icon: Wrench, group: "operations" },
  { slug: "/accounting", label: "Accounting", icon: Calculator, group: "operations" },
  { slug: "/reports", label: "Reports", icon: FileBarChart, group: "operations" },
  { slug: "/communications", label: "Communications", icon: MessagesSquare, group: "operations" },
  { slug: "/documents", label: "Tenant Documents", icon: FileText, group: "operations" },
  { slug: "/notifications", label: "Notifications", icon: Bell, group: "operations" },
  { slug: "/settings", label: "Settings", icon: Settings, group: "administration" },
] satisfies readonly Section[];

const caretakerSections = baseSections.filter(
  (s) =>
    s.slug !== "/tenants" &&
    s.slug !== "/team" &&
    s.slug !== "/applications" &&
    s.slug !== "/brokers",
);
const custodianSections = baseSections.filter((s) =>
  [
    "",
    "/portfolio",
    "/units",
    "/tenants",
    "/applications",
    "/move-requests",
    "/team",
    "/accounting",
    "/communications",
    "/notifications",
    "/settings",
  ].includes(s.slug),
);
const systemAdminSections = baseSections.filter((s) =>
  ["", "/portfolio", "/tenants", "/communications", "/notifications", "/accounting"].includes(
    s.slug,
  ),
);

const brokerSections = [
  { slug: "", label: "Overview", icon: Home, group: "overview" },
  { slug: "/listings", label: "Market Listings", icon: Building2, group: "properties" },
  { slug: "/authorizations", label: "Authorizations", icon: UserCog, group: "people" },
  { slug: "/prospects", label: "Prospects", icon: Users, group: "people" },
  { slug: "/messages", label: "Messages", icon: MessagesSquare, group: "operations" },
  { slug: "/commissions", label: "Commissions", icon: Calculator, group: "finance" },
  { slug: "/profile", label: "Broker Profile", icon: Settings, group: "administration" },
] satisfies readonly Section[];

export const buildDashboardNav = (role: Exclude<Role, "tenant">): DashNavItem[] => {
  const base = `/dashboard/${role}`;
  let sectionsToUse = baseSections;
  if (role === "caretaker") sectionsToUse = caretakerSections;
  if (role === "custodian") sectionsToUse = custodianSections;
  if (role === "system-admin") sectionsToUse = systemAdminSections;
  if (role === "broker") sectionsToUse = brokerSections;
  return sectionsToUse.map((s) => ({
    to: `${base}${s.slug}`,
    label: s.label,
    icon: s.icon,
    group: s.group,
  }));
};

export const adminNav: DashNavItem[] = [
  ...buildDashboardNav("admin"),
  {
    to: "/dashboard/admin/commissions",
    label: "Commissions",
    icon: Calculator,
    group: "administration",
  },
  {
    to: "/dashboard/admin/contact-messages",
    label: "Contact Messages",
    icon: Mail,
    group: "administration",
  },
];
export const caretakerNav = buildDashboardNav("caretaker");
export const custodianNav = buildDashboardNav("custodian");
export const brokerNav = buildDashboardNav("broker");

export const caretakerNavWithTenants: DashNavItem[] = [
  ...caretakerNav,
  { to: "/dashboard/caretaker/tenants", label: "Tenants", icon: Users, group: "people" },
  {
    to: "/dashboard/caretaker/applications",
    label: "Applications",
    icon: FileText,
    group: "people",
  },
];

export const systemAdminNav: DashNavItem[] = [
  ...buildDashboardNav("system-admin"),
  {
    to: "/dashboard/system-admin/users",
    label: "Users & Roles",
    icon: Users,
    group: "administration",
  },
  {
    to: "/dashboard/system-admin/property-types",
    label: "Property Types",
    icon: Tags,
    group: "administration",
  },
  {
    to: "/dashboard/system-admin/recycle-bin",
    label: "Recycle Bin",
    icon: Trash2,
    group: "administration",
  },
  {
    to: "/dashboard/system-admin/commissions",
    label: "Commissions",
    icon: Calculator,
    group: "administration",
  },
];

interface TenantSection {
  slug: string;
  label: string;
  icon: LucideIcon;
  group: string;
  external?: string;
}

const tenantSections: TenantSection[] = [
  { slug: "", label: "Overview", icon: Home, group: "overview" },
  {
    slug: "/browse",
    label: "Browse",
    icon: Search,
    group: "listings",
    external: "/properties",
  },
  { slug: "/favourites", label: "Favourites", icon: Heart, group: "personal" },
  { slug: "/home", label: "My Home", icon: DoorOpen, group: "personal" },
  { slug: "/requests", label: "Requests", icon: ArrowLeftRight, group: "personal" },
  { slug: "/payments", label: "Payments", icon: CreditCard, group: "personal" },
  { slug: "/messages", label: "Messages", icon: MessagesSquare, group: "personal" },
  { slug: "/documents", label: "Documents", icon: FileText, group: "personal" },
  { slug: "/notifications", label: "Notifications", icon: Bell, group: "personal" },
  { slug: "/settings", label: "Settings", icon: Settings, group: "personal" },
];

export const tenantNav: DashNavItem[] = tenantSections.map((s) => ({
  to: s.external ?? `/dashboard/tenant${s.slug}`,
  label: s.label,
  icon: s.icon,
  group: s.group,
}));

export const tenantSubRoutes = tenantSections
  .filter((s) => !s.external && s.slug)
  .map((s) => `/dashboard/tenant${s.slug}`);
