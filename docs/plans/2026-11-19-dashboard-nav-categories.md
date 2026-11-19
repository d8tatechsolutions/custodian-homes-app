# Dashboard Navigation: Categories + Single-Open Accordion

**Status:** In progress
**Date:** 2026-11-19
**Branch:** `feat/dashboard-nav-categories`
**Repo:** keja-yangu

## 0. Goal

Reorganize all dashboard links into categories (related links together). Clicking a category reveals its items. Only one category open at a time (accordion). Persist the open category across route changes.

## 1. Tier 1 findings (synthesized)

- **code-analyst:** Nav is a flat `DashNavItem[]` per role in `src/config/dashboardNav.ts`, rendered solely by `DashboardShell.tsx` (desktop aside + mobile Sheet). No categories/accordion exist. `DashNavItem` is declared twice (config + shell). Active state via `usePathname` with root-exact vs `startsWith`. `useCaretakerNav` filters dynamically. Page tests mock the shell.
- **performance-engineer:** The nav shell remounts on every route change (it lives in pages, not layout), causing an unread-count fetch per navigation and resetting any local accordion state. Recommends lifting open-state to a layout-level provider (and optionally moving the shell to layout as a follow-up). Use CSS keyframes, not framer-motion. Radix ~10-16KB.
- **devops-engineer:** No infra-heavy work. No feature flag/dark launch. Rollback = redeploy. Optional Playwright visual baselines at 320/768/1280. CSP unchanged unless analytics added.
- **test-engineer:** Unit (config categories, item integrity, role membership, route→category resolution, persisted state), component (single-open invariant, keyboard a11y, both surfaces, empty category), integration (active highlight, deep-link auto-expand, role-based, keyboard, mobile), e2e (Playwright with self-skip). Coverage thresholds per-file.

## 2. Design decisions

1. **Grouping lives in config, not presentation.** Add an optional `group?: string` field to `DashNavItem`. The shell groups consecutive items sharing the same `group` value. Items without `group` render as standalone links (backward compat). No page edits required.
2. **Accordion implementation: native `<details name="dashboard-nav">`** for exclusive single-open (zero new dependencies, aligns with the existing `Faq.tsx` precedent and the landing-page plan). Controlled `open` attribute for auto-opening the active route's group. JS handles focus management on collapse.
3. **Open-state persistence across route changes:** lift to a layout-level context provider (`NavAccordionProvider`) in `src/app/dashboard/layout.tsx`, reading/writing `localStorage` in an effect (SSR-safe, no hydration mismatch). Provider holds `openGroup: string | null`.
4. **Active group auto-opens** when `pathname` changes (derive owning group from items).
5. **Shell placement refactor (moving entire shell to layout) is deferred** to a follow-up; only open-state is lifted now. This keeps the change focused and avoids reworking title/subtitle flow. The unread-count-per-route issue is noted but out of scope here.
6. **No new dependencies.** (Avoids Tier 2 principal-architect trigger for new runtime dep.)

## 3. Grouping scheme (per role)

Groups (id → label):
- `overview` — Overview
- `properties` — Properties (Portfolio, Units, Market Listings)
- `people` — People (Tenants, Team, Brokers, Applications, Move Requests, Prospects)
- `operations` — Operations (Tasks & Maintenance, Accounting, Reports, Communications, Tenant Documents, Notifications)
- `administration` — Administration (Commissions, Contact Messages, Users & Roles, Property Types, Recycle Bin, Settings, Profile, Authorizations)
- `personal` — Personal (Overview handled separately; Favourites, My Home, etc. for tenant)

Tenant items: Overview (standalone), Browse (external), then groups: personal (Favourites, My Home, Requests, Payments, Messages, Documents, Notifications, Settings).

Broker: Overview, Properties (Market Listings), People (Prospects, Authorizations), Finance (Commissions), Settings (Broker Profile).

Caretaker: Overview, Properties, People (Tenants, Applications, Move Requests), Operations (Tasks, Accounting, Communications, Documents, Notifications), Administration (Settings, Team handled separately). Note: Team is admin-only in baseSections filter; caretaker excludes it.

Custodian: Overview, Properties, People, Operations (subset).

System-admin: Overview, Properties, People (Tenants), Operations (Accounting, Notifications), Administration (Users & Roles, Property Types, Recycle Bin, Commissions).

Admin: base + Commissions, Contact Messages (grouped into Administration).

## 4. Implementation steps

### Step 1 — Config (`src/config/dashboardNav.ts`)
- Add `group?: string` to `DashNavItem`.
- Assign `group` to every item in baseSections, brokerSections, tenantSections, and the admin/system-admin extras.
- Keep `buildDashboardNav`, exports, and `tenantSubRoutes` unchanged (flat arrays still work).
- Add optional `buildDashboardNavGroups(role)` returning `NavGroup[]`? OR rely on shell grouping. Decision: shell groups by `group` field; no new export needed. But tests may want grouped data; add `groupNavItems(items): NavGroup[]` helper exported for testing.

### Step 2 — Context (`src/contexts/NavAccordionContext.tsx` or `src/hooks/use-nav-accordion.ts`)
- Client provider holding `openGroup: string | null`.
- `setOpenGroup(id | null)`.
- Reads initial from localStorage in useEffect (key `keja-nav-open-group:<role>`? or just one key since role changes reset). Use one key `keja-nav-open-group` storing the group id; reset to null on role change (provider receives role).
- Exports `useNavAccordion()`.

### Step 3 — Shell (`src/components/DashboardShell.tsx`)
- Consume `useNavAccordion`.
- Group `nav` items by `group` (consecutive). Render each group as a `<details name="dashboard-nav" open={openGroup===group.id}>` with a `<summary>` trigger (button-styled) showing group icon + label + chevron. Inside, render the item links.
- Items without `group` render as standalone links (backward compat).
- Auto-open: useEffect on pathname → find the group whose items contain the active route; if found and not already open, setOpenGroup(that group). Only auto-open, don't force-close user's manual choice? Actually for accordion, opening active group should close others — that's the single-open contract. Use setOpenGroup(activeGroupId) when active group differs.
- Focus management: when a group collapses while focus is inside, move focus to its trigger.
- Mobile sheet: same navList, closes on item click.
- Keep active highlight logic (root exact vs startsWith).
- Add aria-expanded, aria-controls, role region.

### Step 4 — Layout (`src/app/dashboard/layout.tsx`)
- Wrap AuthGuard children in NavAccordionProvider, passing role (derive from pathname via getDashboardAllowedRoles? or use useAuth). Use useAuth role.

### Step 5 — Tests
- Update `dashboardNav.test.ts` for grouped data + integrity.
- Add `DashboardShell.test.tsx` for single-open invariant, keyboard, deep-link auto-open, mobile, empty group.
- Coverage thresholds.

## 5. Risks
- Type ripple: `group?` optional avoids breaking consumers.
- Hydration: open state read in useEffect (collapsed initial, then expand) — may flash. Acceptable; matches ThemeProvider pattern.
- Native `<details name>` browser support: Chrome 120+, Safari 17.2+, Firefox 130+. Modern enough.
- Mobile overflow: ensure Sheet content scrolls.

## 6. Out of scope
- Moving entire shell to layout (perf follow-up).
- Playwright visual baselines (optional).
- Feature flag.
EOF
echo written