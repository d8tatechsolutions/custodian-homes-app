# Tasks 403 · Invoice States · Clickable Table Titles

**Status:** Fix 1 implemented · Fix 2 R1 implemented (R2–R4 pending, see `docs/runbooks/invoice-states.md`) · Fix 3 not started
**Date:** 2026-11-18 · **Revised:** v2 (decisions locked)
**Repo:** `keja-yangu` (Next.js App Router + Mongoose)
**Owners:** Orchestrix (routing) · Phase 3 implementers per §6
**Inputs:** Tier 1 (`code-analyst`, `performance-engineer`, `devops-engineer`, `test-engineer`) + Tier 2 rulings (`principal-architect`, `database-architect`)

**v2 changes:** user-facing labels fixed (Draft · Unpaid · Overdue · Paid · Void); drafts redefined as **templates** (number at issue, not payable, tenant-invisible); invoice creation gains a **billed-month calendar**, due-date picker, and issue mode; clickable-title strategy locked to **link where a route exists, drawer everywhere else — no new routes**.

---

## 0. Executive summary

Three independent fixes, delivered in this order because of dependency and risk:

| # | Fix | Nature | Risk | Blocking dependency |
|---|---|---|---|---|
| 1 | `403 Forbidden` on **Tasks & Maintenance** | Authorization policy + one-time assignment backfill | **High** (security-sensitive, shared policy primitive) | none |
| 2 | Invoice states `draft` + `unpaid` (`new`) + creation form | Data contract change + expand/contract migration + UI | **Medium** (multi-release, webhook writes) | none; sequenced releases |
| 3 | Clickable **title/name** in every list table | Frontend-only | Low | none (decision locked) |

### Locked decisions

1. **Admin is owner-scoped, not globally privileged.** Full control where `ownerId === actor.userId`, unioned with active delegated `accessRole: "admin"` assignments. **No global bypass.** (Principal Architect)
2. **Caretaker `manage_tasks` grants** `task:read-own`, `task:create`, `task:manage`.
3. **Stored invoice states:** `draft | new | paid | void`. `new` renders as **“Unpaid”**. `overdue` stays **derived**.
4. **Labels:** `draft` → **Draft**, `new` → **Unpaid**, derived past-due → **Overdue**, `paid` → **Paid**, `void` → **Void**.
5. **Drafts are templates:** never payable, never visible to tenants, never notified, editable/deletable/duplicable. An invoice receives its **number, issued date and due date only when issued** (`draft → new`).
6. **Invoice creation form gets a billed-month calendar** (native `type="month"`, already the repo convention at `InvoicesManager.tsx:241`) plus due-date, issue mode, and split fields — see §2.2.
7. **Clickable titles:** link the title when a detail route exists (`/properties/[id]`, `/marketplace/[id]`, role portfolio/structure routes, existing request links); otherwise the title opens a **read-only drawer**. **No new detail routes.**
8. **No new infrastructure** — no queue, scheduler, date-picker dependency, or observability backend.

**Definition of done:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green; new Playwright specs pass in staging; both runbooks executed with verification queries recorded.

---

## 1. Fix 1 — `403 Forbidden` on Tasks & Maintenance

> “Tasks & Maintenance” is one page (`/dashboard/{admin,caretaker}/tasks`) backed by `GET/POST /api/v1/tasks` and `GET/PATCH/DELETE /api/v1/tasks/[id]`. There is no separate maintenance module.

### 1.1 Verified root causes

All five task endpoints authorize at **portfolio level** (`requirePermission` with no `resource`), so `evaluatePortfolioPolicy` decides, and it requires an active `ManagementAssignment` whose `permissions` contains the exact action.

| Cause | Evidence | Who is affected |
|---|---|---|
| **C1 — Caretaker mapping omits read/create** | `authorization-policy.ts:420` maps `manage_tasks → ["task:manage"]` only; baseline (`:407-411`) has no task action although the role maximum does (`:173-175`). | Caretakers with `manage_tasks`: GET list → 403, POST → 403. PATCH/DELETE succeed. |
| **C2 — Admin is not full-control at portfolio level** | `evaluatePortfolioPolicy` short-circuits only `system-admin` (`authorization-policy.ts:376`); `requirePermission` likewise (`permissions.ts:263`) despite `isFullControlRole()` (`:135-137`). Admin creation makes no assignments; role changes revoke them (`admin/users/[id]/role/route.ts:144-155`). | Owner-admins with zero assignments: all five endpoints 403. |
| **C3 — Sibling inconsistency** | `getTenantScope` lets admins through with an empty scope (`permissions.ts:473-507`) while `requirePermission` denies them. | Drift, not a cause by itself. |

Custodians are not affected by mapping: their assignments come from `roleMaximumActions("custodian")`, which includes all three task actions (`property-staff.ts:56`). Zero-assignment custodians 403 by design (fail-closed).

### 1.2 Role × endpoint matrix (current)

| Actor | GET list | POST | GET id | PATCH/DELETE |
|---|---|---|---|---|
| system-admin | 200 | 201 | 200 | 200 |
| admin, assignment with all verbs | 200 | 201 | 200 | 200 |
| **admin, zero assignments** | **403** | **403** | **403** | **403** |
| admin, assignment with `task:manage` only | **403** | **403** | **403** | 200 |
| **caretaker with `manage_tasks`** | **403** | **403** | **403** | 200 |
| caretaker without `manage_tasks` | 403 | 403 | 403 | 403 |
| custodian with assignment | 200 | 201 | 200 | 200 |
| custodian, zero assignments | 403 (by design) | 403 | 403 | 403 |
| tenant / broker | 403 | 403 | 403 | 403 |

### 1.3 Authoritative ruling — Principal Architect

**Owner-scoped admin full control, with delegated assignments as a union.**

Rejected: global admin bypass (unlocks ~73 resource-free call sites, skips the `archived`/`merged` lifecycle guard at `authorization-policy.ts:287-289`, and `tasks/route.ts:45-49` has **no `ownerId` filter** — would expose every owner’s tasks); self-owner assignment backfill (contradicts the domain model, multiplies rows, dies on role change); per-route exceptions.

**Invariants:**

1. `admin` performs any `ADMIN_ACTIONS` action at portfolio level **without an assignment**, provided the route filter is `ownerId === actor.userId` **or** an active delegated assignment scope.
2. Resource-scoped admin checks pass when `resource.ownerId === actor.userId` or a delegated assignment covers it.
3. Cross-owner access without an assignment is forbidden. Every admin list/detail query carries an owner filter; unfiltered `find({})` is forbidden.
4. `admin` may **not** perform `PLATFORM_ACTIONS` (system-admin only).
5. `admin` remains subject to `archived`/`merged` write denial. Allows go **after** lifecycle/platform checks — never at function entry.
6. `system-admin` keeps the global bypass, lifecycle exemption and `PLATFORM_ACTIONS` exclusivity. Its **authorization** filters stay empty, but its **data** filters are owner-scoped exactly like admin's: access to an arbitrary task is by id, not by list. No unfiltered list query is permitted. *(Amended per Phase 2 ruling — the original "empty filter" wording licensed a cross-tenant enumeration primitive.)*
7. `custodian`/`caretaker` remain fail-closed on assignments.

> **Tasks are property-scoped only (by design).** `Task` carries no `blockId`/`unitId`, so block- and unit-level delegations cannot grant task access. The admin task paths deliberately use `propertyScopeIds` (property-scoped assignments) rather than `assignedPropertyIds`. Do not "correct" this asymmetry: allowing block/unit delegations would grant task access the data model cannot scope.

**Rollout order is mandatory:** fix data filters and add `ownerId` to `PolicyResource` **before** enabling admin allow.

### 1.4 Implementation steps

**Step 1.1 — Owner-aware policy resource (blocker)**
- Add `ownerId?: string` to `PolicyResource` (`authorization-policy.ts:32-37`).
- Deny resource-scoped admin checks when `ownerId` is absent (fail closed).
- Pass `ownerId` through every resource-bearing `requirePermission` call site (properties/units/invoices/leases/complaints/applications/move-requests/tenant assignment/service fees); each already loads the document.
- Do **not** enable admin yet.

**Step 1.2 — Fix admin data filters (blocker)**
- `tasks/route.ts:35-52`: for admin/system-admin, `filter.ownerId = actor.userId` when `propertyScopeIds` is empty; always `$and` owner scope with delegated scope.
- `tasks/[id]/route.ts`: add an admin ownership guard beside the caretaker/custodian checks (`:30-35, 65-70, 136-138`).
- `POST /tasks` (`route.ts:93`): derive `ownerId` from the selected property when `propertyId` is present, else `actor.managedByOwnerId || actor.userId`. (`resolveDashboardActor` returns `""` for admins, so `??` currently writes `ownerId: ""`.)
- **`POST /tasks` is a scoped write (Phase 2 ruling).** Load the property once and reuse it for derivation *and* validation; add `deletedAt: null`. Reject with 403 when the target property is outside the actor's scope:

  | Role | Permitted target | 403 condition |
  |---|---|---|
  | `admin` | `property.ownerId === actor.userId` **or** `actor.propertyScopeIds.includes(propertyId)` | `propertyId` present and neither holds |
  | `caretaker` | `actor.assignedPropertyIds.includes(propertyId)` | not assigned |
  | `custodian` | assigned **and** `property.ownerId === actor.managedByOwnerId` | either fails |
  | `system-admin` | any non-deleted property | never on scope grounds |

  No `propertyId`: admin/system-admin get `ownerId = actor.userId`; caretaker/custodian derive it only when their action-filtered scope holds exactly one property, else `400`. Missing or soft-deleted property is `400`, not `403`.
- **Custodian `DELETE /tasks/[id]` ownership guard (Phase 2 ruling — defect).** `GET` and `PATCH` already guard `task.ownerId !== actor.managedByOwnerId`; `DELETE` omits it and deletes by bare `_id`. Add the identical guard and scope the delete predicate to the loaded task, matching `PATCH`'s `findOneAndUpdate` shape.
- Align `getTenantScope`’s admin branch (`permissions.ts:473-507`).

**Step 1.3 — Enable the admin profile**
- Allow `admin` for `ADMIN_ACTIONS` in `evaluatePortfolioPolicy` after lifecycle/platform checks; mirror in `requirePermission`. Keep `PLATFORM_ACTIONS` system-admin-only.
- Consolidate `resolveDashboardActor`, `getAdminAssignmentScope`, `getStaffAssignmentScope`, `getTenantScope`, `getManagedOwnerId` behind one scope resolver (also fixes duplicate user/assignment loads, §1.7).

**Step 1.4 — Caretaker mapping**
- `authorization-policy.ts:420` → `manage_tasks: ["task:read-own", "task:create", "task:manage"]`.
- Re-sync stored rows via `syncCaretakerPrivilegeAssignments` (`property-staff.ts:105-115`) or the backfill in §1.6 — changing the map alone does not rewrite existing assignments.

**Step 1.5 — Secondary task bugs**
- **`assignedTo` stores a display name**, not an id (`caretaker/tasks/page.tsx:89-90`, `admin/tasks/page.tsx:80-88`), making `{assignedTo,status}` unusable for real assignment. Send a user id, resolve names via a map. **Open question §7.4.**
- Gate the caretaker Tasks nav item on `manage_tasks` (`use-caretaker-nav.ts`); otherwise unprivileged users land on a 403 page.
- The admin cross-owner list leak is a security fix (Step 1.2), not a nicety.

### 1.6 Data backfill (caretaker assignments only)

New `scripts/backfill-task-permissions.ts` + `"backfill:tasks"` npm script.
- `dotenv.config({ path: ".env.local" })`, `tsx`, **dry-run by default**, `--apply` to write.
- `$addToSet` `task:read-own` + `task:create` on active `accessRole: "caretaker"` assignments for `manage_tasks` principals.
- Idempotent; respects the partial unique index (`ManagementAssignment.ts:41-51`); no blind upserts.
- `mongodump` `managementassignments` first. Verify: preflight counts → 0.
- Run on the host (the compose image ships no `tsx`); never inside the app container.

### 1.7 Performance guardrails

A caretaker task list currently costs ~10–14 DB round-trips (`requirePermission` and `resolveDashboardActor` each re-verify the JWT, re-fetch the user, re-load assignments, and `getManagedOwnerId` repeats it).

- One `AuthContext` per request; target ≤5 round-trips.
- Add `{ownerId:1, status:1, createdAt:-1}` and `{propertyId:1, status:1, createdAt:-1}` to `Task`; confirm `IXSCAN` with no `SORT` via `explain()`.
- Push assignment date/permission predicates into Mongo instead of filtering in memory.
- Widening `permissions` is free — it is an unindexed string array.

### 1.8 Tests

| # | Case | Expected | File |
|---|---|---|---|
| 1 | caretaker `manage_tasks` → derived permissions | all three task actions | `src/lib/caretaker-privilege-actions.test.ts` |
| 2 | caretaker GET list | 200; `ownerId = managedByOwnerId` + `propertyId ∈ assignedPropertyIds` | `src/app/api/v1/tasks/route.test.ts` |
| 3 | caretaker POST | 201; owner/property from assignment | same |
| 4a | caretaker, zero active assignments, GET | **403** (fail-closed gate; invariant 7) | same |
| 4b | caretaker, gate passes but derived property scope empty | 200 empty page; composed filter present, no `{}` fallback | same |
| 4c | caretaker with an assignment whose property has no tasks | 200 empty page | same |
| 5 | caretaker on unassigned property, `[id]` | 403 | new `tasks/[id]/route.test.ts` |
| 6 | custodian GET | 200, owner filter only | `route.test.ts` |
| 7 | custodian cross-owner `[id]` | 403 | `[id]/route.test.ts` |
| 8 | admin/system-admin, no assignment | 200/201/200/200 | both |
| 9 | admin, empty scope, list | 200 empty page; never another owner’s rows | `route.test.ts` |
| 10 | **admin A reads admin B’s task** | 403 / absent | `src/test/task-permission-matrix.test.ts` |
| 11 | unauthenticated | 401 | both |
| 12 | archived/merged write as admin | denied | policy test |

Add `makeTask` to `factories.ts`; add `use-tasks.test.tsx` and page smoke tests. **Rewrite `tasks/route.test.ts:29-44`** — it hard-codes all three actions and masks the admin gap.

### 1.9 Risks & rollback

- **Blast radius:** ~80 call sites share the primitive. Security-sensitive; route through security review.
- **Regression mode:** admin allow without owner filters = cross-owner read/write primitive. Steps 1.1/1.2 are hard gates.
- **Rollback:** redeploy previous image (restores 403s, not a leak). Data: `$pull` the two tokens; revoke (never delete) inserted rows; emit audit events.
- **Emergency only:** allow admin in **task routes only** + `ownerId: actor.userId` filter in the same patch. Never global.

---

## 2. Fix 2 — Invoice states, labels and creation form

### 2.1 Target state model

| Stored | UI label | Meaning | Numbered | Payable | Editable | Tenant-visible | Terminal action |
|---|---|---|---|---|---|---|---|
| `draft` | **Draft** | **Template** — reusable, unissued | **No** (`invoiceNumber: ""`) | **No** | Yes | **No** | Delete / duplicate |
| `new` | **Unpaid** | Issued, awaiting payment | Yes | Yes | No | Yes | `paid` / `void` |
| `paid` | **Paid** | Settled | Yes | No | No | Yes | — |
| `void` | **Void** | Cancelled | Yes | No | No | Yes | — |
| *(derived)* | **Overdue** | Stored `new` past `dueDate` | — | Yes | No | Yes | — |

Transitions: `draft → new` (issue: assign number, `issuedAt`, `dueDate`), `new → paid`, `new → void`, `draft → deleted`, `draft → duplicate` (new draft). `draft → void` remains tolerated but is not offered in the UI (deprecate later). `new → draft` is rejected.

**Draft template rules**
- No invoice number, no notifications, no tenant visibility, no receipt.
- Editable in full (including billed month and due date); deletable.
- “Duplicate” clones the draft into a new template (billed month resets to the selected month, amounts/source/notes copied).
- Issuing is idempotent and reserves the number atomically (`nextInvoiceNumber`), then flips to `new`.

### 2.2 Creation form — required changes

`InvoiceFormDialog` currently has **no billed-month field**; manual creates always use `currentPeriod()`, and `dueDate` is always `computeDueDate(period)` (`invoices/route.ts:191,351`). Replace with:

| Field | Control | Default | Notes |
|---|---|---|---|
| **Billed month** | `<Input type="month">` (calendar picker) | current UTC month | Required; `YYYY-MM`; **future months rejected**. This is the invoice `period`. Reuse the existing convention at `InvoicesManager.tsx:241`, so no date-picker dependency. |
| **Due date** | `<Input type="date">` | 5th of the month after the billed month (`computeDueDate`) | Required; must be ≥ billed-month start; editable. |
| **Save as** | Segmented/select | Draft | `Draft (template)` or `Issue as unpaid`. |
| **Source** | Select (existing) | From lease | `From lease` or `Manual`. |
| **Lease** *or* **Tenant + Property** | Selects (existing) | — | Required per source; drives tenant/property/owner/rent derivation. |
| **Amount due** | Number (manual only) | — | Required for manual; lease source derives it. |
| **Service charge** | Number (manual only, new) | 0 | Optional; `rentAmount = amountDue − serviceChargeAmount`. Lease source derives the split from unit config. |
| **Notes** | Textarea (existing) | empty | Internal note; included in staff serialization. |
| **Invoice number** | read-only preview | “Assigned on issue” | Shown only after issuing. |
| *Removed* | Payment method | — | Belongs in `RecordPaymentDialog`, not invoice creation. |

Manual invoices must also show the derived rent/service-charge split so staff do not double-count.

### 2.3 API / schema / model changes (beyond the rename)

- `invoiceInput` (`schemas/invoice.ts`): add `period` (`PERIOD_REGEX`, optional → defaults to current month), `dueDate` (ISO date string, optional → defaults to `computeDueDate(period)`), `serviceChargeAmount` (non-negative, manual only); `status` accepts `draft` **only** at creation (issuing is a separate action, or `status: "new"` to issue immediately with validation).
- `invoiceUpdate`: draft-only; add `period` and `dueDate`; reject `new → draft`.
- `POST /api/v1/invoices`: accept `period`/`dueDate`; reject future periods (same rule as generation); create draft with `invoiceNumber: ""`; create issued with a reserved number.
- **New `POST /api/v1/invoices/[id]/issue`**: guard `status === "draft"`, `amountDue > 0`, billed month not future; reserve number, set `status: "new"`, `issuedAt`, `dueDate` (keep draft’s due date if set); idempotent (second call 409).
- **New `POST /api/v1/invoices/[id]/duplicate`**: clone a draft (or issued invoice) into a new draft; no numbering.
- `invoice-generation.ts` keeps issuing directly as `new` with reserved numbers (bulk generation is not affected).

### 2.4 Numbering-at-issue and index changes (required for templates)

Because drafts carry `invoiceNumber: ""`, two partial unique indexes must exclude empty numbers:

| Index | Current partial filter | New partial filter |
|---|---|---|
| `{invoiceNumber: 1}` unique | `{ deletedAt: null }` | `{ deletedAt: null, invoiceNumber: { $gt: "" } }` |
| `{leaseId: 1, period: 1}` unique | `{ leaseId: { $gt: "" }, deletedAt: null }` | `{ leaseId: { $gt: "" }, deletedAt: null, invoiceNumber: { $gt: "" } }` |

This also **allows multiple draft templates for the same lease + month**, which is the point of a template. Existing drafts that already hold numbers keep them (harmless); only new drafts are number-less.

Ops: drop + recreate both indexes in a short window during R1 (below). Verify no duplicate live issued invoices exist first. Do **not** use `syncIndexes()` from `migrate-soft-delete-indexes.ts` — its local invoice schema omits five live indexes and would drop them.

### 2.5 Authoritative migration ruling — Database Architect

**Expand/contract across releases.** Rejected: atomic rename (webhooks write invoices; no write freeze; a lagging backfill breaks payment guards) and UI-only aliasing (contradicts the stored-state change).

| Phase | Action | Gate |
|---|---|---|
| **R1 — Expand** | Add `"new"` to `INVOICE_STATUSES`; keep default `pending`. Widen every reader/guard so `pending ≡ new`: `deriveStatus` maps both to `overdue`; list filters `{$in:["pending","new"]}`; `status=pending` aliases; `notifications.ts:522` uses `$in`; optimistic guards `{$in:["pending","new","draft"]}`; zod + UI types accept both. Add the new indexes (§2.4) and the `issue`/`duplicate` endpoints. | All instances on R1; `count({status:"new"}) === 0`; V3 unchanged; a legacy `pending` doc appears under `status=overdue`. |
| **R2 — Backfill** | Batched, guarded `pending → new` over all docs (including soft-deleted / missing `deletedAt`). | Dry-run reviewed; V1/V2/V3/V5 pass; draft/paid/void counts unchanged. |
| **R3 — Flip writers** | Model default `new`; generation defaults `new`; `resolveManualPayment` returns `new`; zod emits `new`; narrow payment guards to `new` only. Readers still accept `pending`. | No `ValidationError`/400 spike; new invoices are `new`; V6 passes. |
| **R2b — Reconcile** | Re-run the identical backfill. | `count({status:"pending"}) === 0`. |
| **R4 — Contract** | Remove `pending` from enum, zod, TS unions, filters, `deriveStatus`, UI, factories/tests. | V1–V6 pass; 24h monitor. |

**Ordering invariant:** R1 before R2 (in-flight guarded updates otherwise match 0 rows and overdue notifications silently stop); R3 after R1 (otherwise `runValidators:true` writes throw).

### 2.6 Backfill mechanics

`scripts/migrate-invoice-statuses.ts` (+ `"migrate:invoices"`).
- Filter `{status:"pending"}` with **no** `deletedAt` predicate; the soft-delete plugin does not narrow `updateMany`.
- Guard every batch on `status:"pending"`; batch ~500; resume by `_id`; `maxTimeMS`; no multi-doc transaction.
- **Do not touch `updatedAt`** (raw collection update or `{ timestamps: false }`); **`runValidators: false`**.
- Idempotent; log matched/modified per batch + total; connection settings mirror `migrate-soft-delete-indexes.ts:125-130`.

### 2.7 Verification queries (raw collection, fixed `now`)

| ID | Query | Expected |
|---|---|---|
| V1 | `count({status:"pending"})` | `0` after R2/R2b/R4 |
| V2 | `count({status:{$nin:["draft","new","paid","void"]}})` | `0` |
| V3 | `count({status:{$in:["pending","new"]}, dueDate:{$lt:NOW}})` | **identical** before/after R2 |
| V4 | `aggregate group by status` | 4 keys after R4; draft/paid/void unchanged |
| V5 | `count({status:"pending", deletedAt:{$exists:false}})` | `0` |
| V6 | `count({status:"draft", $or:[{amountPaid:{$gt:0}},{paidAt:{$exists:true}}]})` | `0`; if >0 **stop** before R3 (§7.5) |
| V7 | `count({status:"draft", invoiceNumber:{$ne:""}})` | informational only (legacy numbered drafts) |

### 2.8 UI changes

- Tabs: **Draft · Unpaid · Overdue · Paid · Void** (`new` key, “Unpaid” label). Counts derive from the widened list.
- `InvoiceTable` badge: `draft` muted, `new` warning, `overdue` destructive, `paid` success, `void` muted. Status maps must be exhaustive over `DerivedInvoiceStatus`.
- Row actions: **draft** → Edit, Issue, Duplicate, Delete; **new** → Record payment, Void; **paid/void** → receipt only.
- `InvoiceFormDialog` per §2.2; `RecordPaymentDialog` keeps method + reference/date.
- Tenant payments page: “upcoming” = `new | overdue`; **drafts must never render**.
- Receipt/notification copy uses “Unpaid”, never the raw `new`.

### 2.9 Tests

- **State machine:** enum contents; `deriveStatus(new, past) → overdue`; draft/paid/void never flip; `canMarkPaid(new|overdue)` only; `canPayOnline` only `new` with zero balance; `canDelete(draft)`; partial payment stays `new`.
- **Drafts-as-templates:** draft has `invoiceNumber === ""`; not returned by tenant routes; not notified; multiple drafts for the same lease+month allowed; issue assigns a number exactly once (idempotent 409 on retry); duplicate produces a draft.
- **Creation form/API:** billed month required and future months rejected; due date defaults to 5th of next month and is honored; manual service charge splits rent correctly; issue mode `draft` vs `new`.
- **API contract:** `status=new` filter; generate produces `new`; PATCH `draft→new` and `new→draft` rejected; DELETE draft 204 / new 409; mark-paid on new/overdue only; tenant serialization excludes drafts and `serviceFeeItems`.
- **Migration:** `src/test/invoice-status-migration.test.ts` mapper + idempotent rerun; `src/models/Invoice.test.ts` enum/default.
- **UI:** badge/tab/count tests; `InvoiceFormDialog.test.tsx` for month/due-date/issue-mode fields.
- **Factories:** `TestInvoice.status` → `"draft" | "new" | "paid" | "void"`, default `"new"`.
- **e2e:** `e2e/invoice-lifecycle.spec.ts` — create draft with a past billed month → issue → record payment; tenant sees Unpaid, never Draft.
- Coverage ≥85% on `src/lib/invoicing.ts` and invoice route handlers.

### 2.10 Risks & rollback

- Mixed-version readers are safe only during R1/R3; removing `pending` early is not survivable.
- Legacy `pending` rows remain readable after R4 (validation is on write, not hydration/`.lean()`), but any write assigning `"pending"` must be renamed in R3.
- Notification-storm guard: halt before R2 if V3 drifts.
- Index drop/recreate in R1 is the riskiest ops step; verify no duplicate live issued invoices first.
- Rollback: deploy the R1/R3 image (accepts both) → reverse script (`new → pending`) → verify `new === 0`; `mongodump` before R2. Reverting the index change is safe once no number-less issued invoices exist.
- Deferred, separate release: `EXPLAIN`-driven `{ownerId:1,status:1,dueDate:1}` partial index for the overdue sweep.

---

## 3. Fix 3 — Clickable title/name in every list table

### 3.1 Locked strategy

- **Title is a link when a detail route already exists** → `/properties/[id]`, `/marketplace/[id]`, role-scoped portfolio/structure routes, existing request/listing links.
- **Otherwise the title opens a read-only drawer** built on `src/components/ui/sheet.tsx`, fed from the already-loaded row (no extra fetch).
- **No new detail routes** for tenants, units, invoices, tasks, users, documents, commissions, etc.
- Only troubled cells already linked stay as-is (notifications row click, tenant requests).

### 3.2 Inventory and target per surface

| Surface (shared component) | Entity | Today | Target |
|---|---|---|---|
| `admin/page.tsx:175,198`, `system-admin/page.tsx:132,155`, `caretaker/page.tsx:156,178` | Property | plain `p.title` | **Link** `/properties/[id]` |
| `PropertyCard*`, `caretaker/portfolio`, `tenant/page`, `tenant/favourites` | Property | already linked | no change |
| `units/UnitsView.tsx:364,405`, `property/PropertyUnitsTable.tsx:261,309` | Unit | plain | **Drawer** |
| `tenants/TenantsManager.tsx:384,400` (4 pages) | Tenant | plain | **Drawer** |
| `invoices/InvoiceTable.tsx:40,57` (4 accounting pages + tenant) | Invoice | plain number | **Drawer** (staff actions inside) |
| `tenant/payments/page.tsx:273,283` | Invoice | plain | **Drawer** (tenant-safe fields only) |
| `applications/ApplicationsView.tsx:145,172` (3 pages) | Application → property | plain title | **Link** `/properties/[id]` when `propertyId` present, else drawer |
| `move-requests/MoveRequestsView.tsx:139,166` (3 pages) | Move request | plain | **Drawer** |
| `admin/CommissionManager.tsx:159,172` | Accrual/payout | raw ids | **Drawer** |
| `admin/UserRoleManager.tsx:205,227`, `team/CustodianManager.tsx:100,117`, `team/CaretakerPrivilegesTable.tsx:113,140` | User/staff | plain name | **Drawer** |
| `admin/brokers/page.tsx:378,436` | Broker authorization/profile | raw ids | **Drawer** |
| `admin/documents/page.tsx:147,178` + caretaker/tenant documents | Document | plain name | **Drawer** |
| `contact/ContactMessagesList.tsx:95,113` | Contact message | plain subject | **Drawer** |
| `service-fees/ServiceFeesManager.tsx:163,192` | Service-fee item | plain label | **Drawer** |
| `broker/BrokerDashboard.tsx:300,401,480,541,583` | Listing / prospect / commission / auth / agreement | plain | Listing → `/marketplace/[id]`; rest **Drawer** |
| `notifications/NotificationsList.tsx:208,228` (5 pages) | Notification | row click | leave |
| `tenant/TenantRequestsPanel.tsx:401` | Request | already linked | leave |
| `admin|caretaker/tasks` (card grids) | Task | plain title | **Drawer** |

### 3.3 Implementation notes

- Add `prefetch={false}` to every per-row link (a 100-row page would otherwise fire ~100 RSC prefetches). Keep prefetch on primary CTAs only.
- Never nest a `<Link>` inside a button; do not put row action buttons inside the link. `PropertyCardWithActions` already overlays actions — do not regress it.
- Drawer opens on title click; title is a real `<button>` styled as a link (`hover:underline`) with `aria-haspopup="dialog"`; focus returns to the trigger on close.
- `InvoiceTable` is used on tenant surfaces: the staff drawer must omit `serviceFeeItems`.
- Virtualized tables (`UnitsView`, `PropertyUnitsTable`) keep the trigger inside the measured row; re-check measurement.
- One generic `RecordDrawer` (title, meta grid, sections, action slot) shared by managers, rather than 12 bespoke sheets.
- No migration; no infra. No new routes, so `role-routes.ts`, `next.config.ts` and `proxy.ts` are untouched.

### 3.4 Tests

- New `src/test/utils/title-link.tsx`: asserts `role="link"` + accessible name === visible title + correct `href` + keyboard focus, or drawer fallback (`aria-haspopup`, dialog role, Escape closes, focus returns).
- Extend `PropertyCardWithActions.test.tsx`, `PortfolioView.test.tsx`, `InvoiceTable.test.tsx`, `TenantsManager.test.tsx`, `UnitsView.test.tsx`, `PropertyUnitsTable.test.tsx`, `ApplicationsView.test.tsx`, `MoveRequestsView.test.tsx`.
- `e2e/dashboard-title-links.spec.ts`: property title → structure URL; tenant/unit title → drawer opens/closes; keyboard-only navigation; action buttons do not trigger navigation.
- Assert no nested interactive elements and no double navigation.

---

## 4. Contradictions recorded and resolved

| # | Domain | Conflict | Ruling |
|---|---|---|---|
| 1 | Authorization | `code-analyst` proposed global admin full control; `principal-architect` rejected (unfiltered task query, lifecycle bypass). | Owner-scoped admin (§1.3). |
| 2 | Invoice migration | `code-analyst` proposed an atomic rename; `database-architect` ruled it unsafe (webhook writers cannot be frozen). | Expand/contract R1–R4 (§2.5). |
| 3 | Draft void | `test-engineer` assumed `draft→void` valid; `database-architect` says do not tighten in this change. | Keep temporarily; UI omits it; deprecate later. |
| 4 | Clickable target | User confirmed routes+drawer but “link only where a route exists”. | Link for existing routes, drawer elsewhere, **no new routes** (§3.1). |

---

## 5. Sequencing

```
Fix 1:  1.1 policy ownerId ──► 1.2 admin filters ──► 1.3 enable admin
        1.4 caretaker map ──► 1.6 backfill           (1.4/1.6 parallel with 1.1–1.2)

Fix 2:  R1 expand (+ indexes, issue/duplicate, form) ──► R2 backfill ──► R3 writers
        ──► R2b reconcile ──► R4 contract            (each phase a separate deploy)

Fix 3:  shared title-link/trigger + RecordDrawer ──► per-table sweep ──► e2e
```

Do **Fix 1 first**: the invoice routes’ admin owner filters must be correct before the admin allow lands, and Fix 2 touches the same invoice authorization surface.

---

## 6. Work breakdown for Phase 3

| WP | Content | Routing | Depends on |
|---|---|---|---|
| WP1 | `PolicyResource.ownerId`, fail-closed resource scoping, consolidated scope resolver | `@developer-prime` | — |
| WP2 | Task route owner filters, POST `ownerId`, `[id]` admin guard, indexes | `@developer-prime` | WP1 |
| WP3 | Enable admin profile; platform/lifecycle exclusions; `getTenantScope` alignment | `@developer-prime` | WP1, WP2 |
| WP4 | Caretaker mapping + re-sync | `@developer-fast` | — |
| WP5 | `scripts/backfill-task-permissions.ts` + runbook | `@devops-engineer` | WP4 |
| WP6 | Invoice R1: enum/readers/guards/schemas; index drop+recreate; `issue`/`duplicate` routes; numbering-at-issue | `@developer-prime` | Fix 1 owner filters |
| WP7 | Invoice creation form (billed-month calendar, due date, issue mode, manual service charge) + table/tabs/labels | `@developer-prime` | WP6 |
| WP8 | `scripts/migrate-invoice-statuses.ts` + verification | `@devops-engineer` | WP6 |
| WP9 | Invoice R3/R4 writer flip + contract sweep | `@developer-prime` | WP8 |
| WP10 | Shared `RecordDrawer` + title-link/trigger pattern | `@developer-prime` | — |
| WP11 | Per-table link/drawer sweep | `@developer-fast` | WP10 |
| WP12 | Tests + e2e per §1.8, §2.9, §3.4 | `@test-engineer` | each WP |

---

## 7. Open questions

1. ~~Invoice label~~ → **Unpaid** (locked; `void` stays “Void”).
2. ~~Drafts payable~~ → **No**; drafts are templates.
3. ~~Clickable target~~ → link existing routes, drawer elsewhere, no new routes.
4. **`Task.assignedTo`:** store a user id (recommended), a vendor name, or free text?
5. **Paid drafts:** if V6 > 0 at R3, decide convert-to-`new` vs void/refund before flipping writers.
6. **Unprivileged caretaker nav:** hide Tasks entirely or keep it with an explanatory empty state?
7. **Legacy numbered drafts:** leave their numbers (recommended, no sequence gaps) or clear them so every draft is truly number-less?

---

## 8. Out of scope

- Moving the overdue-notification sweep out of the GET read path (perf P1; separate change).
- Virtualizing invoice/notification/application/move-request tables.
- New observability backend (none exists; adding one is a new dependency requiring sign-off).
- Broker/platform authorization changes.
- Payment-provider internals, commission maths, receipt PDF layout.
- New detail **routes** (drawer approach chosen instead).

---

## 9. Appendix — reference index

**Fix 1**: `authorization-policy.ts` (32-37, 173-175, 287-289, 376-401, 407-424) · `permissions.ts` (135-137, 218-303, 334-416, 473-530) · `authorization.ts` (30-51) · `property-staff.ts` (53-56, 105-115) · `managed-owner.ts` · `_helpers.ts` (124-199) · `api/v1/tasks/{route.ts,[id]/route.ts}` · `models/{Task,ManagementAssignment}.ts` · `hooks/use-tasks.tsx` · `dashboard/{admin,caretaker}/tasks/page.tsx`

**Fix 2**: `lib/invoicing.ts` · `models/Invoice.ts` · `lib/schemas/invoice.ts` · `lib/invoice-generation.ts` · `lib/invoice-numbering.ts` · `lib/billing-accounts.ts` · `api/v1/invoices/**` · `api/v1/tenant/me/invoices/**` · `lib/payments/settle.ts` · `lib/notifications.ts` (511-534) · `hooks/use-{invoices,my-invoices}.tsx` · `components/invoices/**` · `dashboard/tenant/payments/page.tsx` · `test/utils/factories.ts`

**Fix 3**: `components/{invoices,tenants,units,property,applications,move-requests,admin,team,contact,service-fees,notifications,broker}/**` · `components/ui/{table,sheet}.tsx` · `app/dashboard/**` · `app/properties/[id]` · `app/marketplace/[id]` · `lib/role-routes.ts`

**Ops**: migrations run on host via `tsx` + `.env.local` (dry-run default, `--apply` to write); no `tsx` in the compose image. Required env: `MONGODB_URI`, `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`, plus email/payment vars for full boot. CI today: `biome check .` → `typecheck` → `build` → `test:coverage`; Playwright is not in CI. **Do not use `npm run check` as a gate — it writes.**

**CI gate checklist**
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test` (no skips)
- [ ] `npm run build`
- [ ] new Playwright specs in staging
- [ ] Fix 1: assignment preflight counts → 0; tasks smoke 200/201 with real caretaker + admin tokens; `npm run audit:phase9` exits 0
- [ ] Fix 2: index rebuild verified; V1–V6 recorded; migration dry-run output attached; `pending = 0` before contract
