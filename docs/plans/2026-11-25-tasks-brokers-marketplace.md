# Tasks & Maintenance · Broker Bids · USD/KES · UI Foundations

**Status:** PLAN, awaiting approval. No code written.
**Date:** 2026-11-25
**Author:** JaleelMwero
**Inputs:** the client's answer sheet (Q1–Q49), follow-up decisions agreed on 2026-11-25, a code survey of `stage`, and a read-only check of Vercel.
**Platform:** Custodian Homes is a **property-management system and a marketplace** (reference: BuyRent Kenya). Every feature in this plan has to serve both sides.

---

## 0. Summary

| # | Work | What it delivers | Risk | Ships |
|---|---|---|---|---|
| 0 | **Working agreement** | Sync `stage` with `dev`; agree who owns which files; feature flags | Low | First |
| 1 | **UI foundations + clickable titles** | Shared page header, data table, detail panel, status badges, money display, photo uploader; every table title clickable (Fix 3) | Low | Release 1 |
| 2 | **Daily job + USD/KES** | One daily scheduled job; a live daily exchange rate; amounts shown in both currencies | Low–Medium | Release 1 |
| 3 | **Tasks & Maintenance** | Complaints become tasks; tasks on any location; before/after photos; vendors; costs and approvals; recurring tasks; new statuses; categories; activity history; screens for every role | Medium | Release 2: all four task features together, behind a flag |
| 4 | **Broker bids & marketplace** | Admins add brokers directly; brokers bid to list with their commission; owners approve, reject or counter; several brokers per listing; duplicate-listing and photo checks; dual-currency prices | Medium | Release 3, behind a flag |
| 5 | **Notifications** | Task reminders, vendor emails, tenant in-app updates, broker invites and bid alerts | Medium | **After Abdalla finishes his email work** |
| 6 | **Data fix** | Mark the 2 occupied-but-empty units as vacant, after showing the exact change first | Low | Any time, with approval |

**Nothing existing is removed or rewritten.** All database changes **add** new fields with safe defaults and new collections. Existing documents stay valid, so no data migration is needed.

---

## 1. How we work (two developers, shared environments)

### 1.1 What Vercel actually looks like today (read-only check, 2026-11-25)

| Item | Finding | Impact |
|---|---|---|
| Projects | One project: `custodian-homes-app` (Hobby plan) | Scheduled jobs run at most **once a day** |
| Production branch | Set to `main`, but **every production deployment so far was built from `dev`** | The live site www.custodianhomes.co.ke runs `dev` code |
| Database | **One `MONGODB_URI` for Production and Preview** | `stage`/`dev` previews **write to the same data the live site shows** |
| Scheduled jobs | None | We add one (§3.2) |
| Not set on Vercel | M-Pesa callback secret, Paystack keys, `COMMISSION_PAYOUTS_ENABLED`, `EMAIL_SECURE`; `NEXT_PUBLIC_APP_URL` is set for Production only | Payments and payouts are effectively off; preview email links fall back |

**Recommendation (decide before Release 2 testing):**
- Create a **separate dev database** and a **second Vercel project** (`dev` as its Production Branch, with its own settings).
- Keep the current project for `main` with the main database.
- Until then, every test account and test task appears on the live site.

Nothing on Vercel will be changed without explicit approval.

### 1.2 Branch flow

```
stage (our work, preview) ──PR──► dev (team test / currently live) ──► main (final, real data)
                                     ▲
dev-mwero (Abdalla) ─────────PR──────┘
```

1. **Before any new work:** fast-forward `stage` to `origin/dev`. `stage` is 5 commits behind (Abdalla's email fixes) and has nothing of its own, so this is clean.
2. Commits are small and categorised (`feat(tasks)`, `feat(brokers)`, `feat(ui)`, …), authored as JaleelMwero.
3. Before each push: `git fetch` and rebase or fast-forward onto `origin/dev` so PRs to `dev` stay conflict-free.
4. Each slice passes `typecheck`, `lint`, the full test suite and `next build` before it is pushed.

### 1.3 Not getting in Abdalla's way

He is currently changing these files. **We do not edit them until he says his work is done:**

```
src/lib/email.ts                    src/lib/notifications.ts
src/app/api/v1/admin/users/route.ts src/app/api/v1/caretakers/route.ts
src/app/api/v1/custodians/route.ts  src/app/api/v1/tenants/route.ts
src/hooks/use-caretakers.tsx        src/hooks/use-user-invites.tsx
scripts/test-email.ts
```

- **All new work goes in new files and folders:**
  - `src/components/tasks/`, `src/components/vendors/`, `src/components/brokers/`, `src/components/money/`
  - `src/lib/tasks/`, `src/lib/fx.ts`
  - `src/app/api/v1/vendors/`, `…/task-schedules/`, `…/broker-bids/`, `…/cron/`
- **Shared files we must touch** (nav config, task routes, complaints routes, broker pages) get small, additive edits only.
- **Everything that sends an email or notification is held** until Phase 5 (§7). Until then, features record what *would* be sent, and the broker invite shows a **"Copy invite link"** button instead of emailing.

### 1.4 Feature flags (new code stays invisible until switched on)

| Flag | Turns on |
|---|---|
| `TASKS_V2_ENABLED` | Everything in Phase 3 |
| `BROKER_BIDS_ENABLED` | Everything in Phase 4 |
| `FX_DISPLAY_ENABLED` | USD equivalents on screens (rates are still fetched when off) |

- All three default to **off**, like the existing `ROLE_MANAGEMENT_ENABLED`.
- The UI reads them through the existing `/api/v1/capabilities` endpoint, so no `NEXT_PUBLIC_` rebuild is needed.
- This lets code merge into `dev` (which is live) without changing what users see.
- To test on previews, the flags are set for the **Preview** environment only. That is a Vercel change and needs approval.

---

## 2. Phase 1: UI foundations and clickable titles

**Goal:** every new screen looks and behaves the same, works on a phone, and supports light and dark mode.

Today each page builds its own cards, tables and dialogs inline. For example, the current tasks page is a single 320-line file.

### 2.1 Missing primitives (`src/components/ui/`, same shadcn/Radix style as the existing ones)

- `card`
- `dropdown-menu` (row actions)
- `popover` (filters)
- `checkbox`
- `avatar`
- `separator`
- `skeleton` (loading states)
- `progress`
- `command` (searchable pickers)
- `scroll-area`

### 2.2 Shared building blocks (`src/components/common/`)

| Component | Used for |
|---|---|
| `PageHeader` | Title, subtitle, primary action, breadcrumb, consistent spacing |
| `DataTable` | Sorting, filters, column visibility, pagination, row actions, **clickable title column**, a card layout on mobile instead of horizontal scroll, empty/loading/error states |
| `FilterBar` | Search plus filter chips (property, status, priority, category, assignee, date range) |
| `DetailSheet` | Side panel for quick views (Fix 3 drawers, task quick view) |
| `StatusBadge` | One colour scheme for all statuses (task, complaint, invoice, bid, listing) |
| `Timeline` | Activity history (tasks, complaints, bids) |
| `PhotoUploader` / `PhotoGrid` | Before/after photos; phone camera capture; limits enforced; lightbox (reuses `PropertyLightbox`) |
| `MoneyInput` | Amount with a **KES/USD** switch and a live "≈ other currency" line |
| `Money` | Shows `KES 12,950 · ≈ $100.00` with an "as of" tooltip |
| `EmptyState` | Illustration, message and next action |
| `LocationPicker` | Property → block → floor → unit / common area |

### 2.3 Fix 3: clickable titles (decision Q49 = a)

- Where a page exists, the title links to the item's full page. Otherwise it opens a read-only `DetailSheet`.
- This applies to: tenants, units, properties, invoices, applications, move requests, leads, listings, brokers and tasks.
- Delivered as part of moving each table onto `DataTable`.

**Acceptance:** keyboard-accessible, works on mobile, no layout shift, component tests for every table touched.

---

## 3. Phase 2: daily job and USD/KES

### 3.1 Exchange rate

- **Source:** a free daily USD→KES rate service that needs no key (e.g. open.er-api.com). It requires a visible attribution line, which goes in the footer.
- **New collection `FxRate`:** `{ base:"USD", quote:"KES", rate, source, effectiveDate, fetchedAt }`, one row per day. We keep history.
- **When it's fetched:** by the daily job, and on demand if the newest rate is older than 36 hours. The on-demand path means previews (where the job doesn't run) still work.
- **If the service is down:** use the last known rate and show its date ("rate as of 24 Nov"). Never block a page.
- **`src/lib/fx.ts`:** `getRate()`, `convertMinor(amount, from, to, rate)` (integer minor units, banker's rounding), `formatDual()`.
- **`useFxRate()` hook** feeding the `Money` and `MoneyInput` components.

**Where both currencies appear (decided):**
1. **Broker bids and commissions.** The broker enters KES or USD, and the other is shown live.
2. **Marketplace prices.** KES first with "≈ $"; a KES/USD switch remembered per visitor.
3. **Owner reports.** A KES/USD switch (open question O1 covers which rate).

**Payout rule (decided):**
- A commission agreed in USD stays in USD.
- It is converted to KES **at the rate on payout day**.
- The payout records the USD amount, the rate, the rate date and the KES amount.

### 3.2 Daily scheduled job

- **Route:** `GET /api/v1/cron/daily`. It only accepts calls carrying `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this automatically).
- **Schedule:** `vercel.json` → `{"crons":[{"path":"/api/v1/cron/daily","schedule":"0 3 * * *"}]}`, which is 06:00 Nairobi time. Hobby runs it within that hour.
- **Steps, each independent and safe to re-run:**
  1. Refresh the exchange rate.
  2. Create due copies of recurring tasks.
  3. Mark overdue tasks.
  4. *(Phase 5)* Send reminders.
- Logs a summary.
- **Needs on Vercel:** `CRON_SECRET` on the deployment that runs production. Added when Release 2 is ready, with approval.
- Vercel runs scheduled jobs **only on the Production deployment**; see §1.1.

---

## 4. Phase 3: Tasks & Maintenance (all four features, one release)

### 4.1 Decisions this phase implements

| Area | Decision |
|---|---|
| Complaint → task | **Every complaint creates a task automatically.** It is assigned to the property's **caretaker** (unassigned if none). Due date by priority: **High 1 day · Medium 3 days · Low 7 days** |
| Linking | One complaint → many tasks; one task → many complaints |
| Task done | Staff are asked **"Also resolve the complaint?"** |
| Tenant view | Status **plus the scheduled date**; in-app message when done; tenant confirms **fixed / not fixed** (not fixed reopens it) |
| Location | Property, block, floor, unit or **common area**. Common areas are named per property by staff |
| Photos | Before and after, **up to 3 + 3**. The creator adds "before", the assignee adds "after". "After" is optional |
| Files | PDFs and receipts allowed |
| Who sees photos | Staff, the owner, and the tenant if the task is linked to their complaint |
| Vendors | Outside companies or own staff. Name, phone, trade/skills, optional email. **Each admin keeps a list and picks which properties each vendor serves.** No vendor login. Vendor emailed **after the cost is approved** |
| Costs | In order: **quote → approval → actual cost (labour/materials) → receipts → vendor paid** |
| Approval | Needed above a **threshold set per property**. Approver: **owner**. If the owner has no account: **custodian, otherwise admin** |
| Who pays | Chosen per task: **owner / tenant / service-charge fund**. "Bill to tenant" creates a **draft invoice** (uses the R1 draft-template flow) |
| Reports | Maintenance costs appear in owner reports |
| Recurring | Created by the **owner, admin or custodian**. Daily / weekly / monthly / every X months / yearly / custom "every N". Ends: never, after X times, or on a date. **The next copy is created on schedule** even if the last isn't done |
| Reminders | On assignment, 1 day before, on the due date, then **daily while overdue**. Overdue alerts go to the admin, owner and custodian. **Email + in-app** (Phase 5) |
| Who creates | Admin, custodian, caretaker, owner |
| Assignees | Caretaker, custodian, admin, vendor. **A caretaker can only assign to themselves** |
| Statuses | Open → In progress → Done, plus **Waiting for approval, Waiting for parts, Waiting for vendor, Cancelled** |
| Categories | Starting list (Plumbing, Electrical, Cleaning, Security, Painting, Carpentry, Pest control, Other). **Admins add their own** |
| History | Comments and an activity log on every task |
| Owner rights | View, comment, approve costs |

### 4.2 Who "the owner" is (from the current code)

- The platform's roles are `tenant`, `caretaker`, `custodian`, `admin`, `broker` and `system-admin`. There is no separate owner role.
- An **owner** is an `admin` whose user ID matches the property's `ownerId`.
- A property's owner can also be **external** (`PropertyOwnership.holderType = "external"`): a person with no account, managed by an admin acting as managing agent.

The approval rule resolves the approver in this order:
1. The owner, if the owner is a user on the platform.
2. Otherwise, the property's custodian, through an active `ManagementAssignment`.
3. Otherwise, the managing admin.

This lives in a single function, `resolveCostApprover(propertyId)`, with tests.

### 4.3 Data model (all additive)

**`Task`** (existing; new fields are optional with defaults, so old tasks stay valid):

```
category            string ("" = uncategorised)
location            { kind: property|block|floor|unit|common_area, blockId, floorId, unitId, commonAreaId, label }
status              + waiting_approval | waiting_parts | waiting_vendor | cancelled
assignee            { kind: staff|vendor, userId, vendorId, name }   (old assignedTo/assignedToName kept and mirrored)
complaintIds        string[]
scheduledFor        date | null           (shown to the tenant)
photos              { before: Media[≤3], after: Media[≤3] }
attachments         Media[]               (PDF quotes, receipts)
cost                { quote: {amountMinor, currency, file, by, at},
                      approval: {required, status: pending|approved|rejected, approverUserId, by, at, note},
                      actual: {labourMinor, materialsMinor, currency},
                      receipts: Media[],
                      payer: owner|tenant|service_charge,
                      tenantInvoiceId,
                      vendorPayment: {status: unpaid|paid, paidAt, method, reference} }
scheduleId          string                (set on copies created by a recurring schedule)
cancelledAt/By, startedAt
```

**New collections:**

| Collection | Key fields | Indexes |
|---|---|---|
| `TaskActivity` | `taskId, actorId, actorRole, kind (comment\|status\|assign\|photo\|cost\|approval\|link), data, createdAt` | `taskId+createdAt` |
| `Vendor` | `ownerId (admin), name, phone, email?, trades[], propertyIds[], isActive, notes, deletedAt` | `ownerId+isActive`, `propertyIds` |
| `TaskSchedule` | `ownerId, propertyId, template{title, category, location, priority, assignee, notes}, rule{freq, interval, byWeekday, byMonthDay}, startDate, end{kind: never\|count\|until, count, until}, occurrences, nextRunAt, isActive, createdBy` | `isActive+nextRunAt` |
| `TaskCategory` | `ownerId, name, isActive` (built-in list lives in code) | `ownerId+name` unique |
| `PropertyOperations` | `propertyId, approvalThresholdMinor, currency, commonAreas[{id, name}]` | `propertyId` unique |

`PropertyOperations` is deliberately **separate from `Property`**, so the large shared property schema isn't touched.

**`Complaint`** (existing, additive):
- `taskIds[]`
- `tenantConfirmation {status: none|fixed|not_fixed, at, note}`
- `reopenedCount`

### 4.4 Rules (in `src/lib/tasks/`, unit-tested)

- **Status transitions:** a fixed table of allowed moves.
  - Moving into `waiting_approval` happens automatically when a quote is above the threshold.
  - `done` requires the approval to be approved, or no approval needed.
  - `cancelled` is final, except an admin can reopen.
- **Auto-task from a complaint:**
  - Created in the complaints POST handler, in a new helper.
  - If task creation fails, the complaint is still saved and the failure is logged.
  - Behind `TASKS_V2_ENABLED`.
- **Done → complaint:**
  - The UI asks the question; the API takes `resolveComplaints: boolean`.
  - When a tenant says "not fixed", the complaint goes back to `open`, the task is reopened, and both are logged.
- **Photos:**
  - Limits of 3 + 3 enforced on the server.
  - Only the creator adds "before"; only the assignee (or staff above them) adds "after".
- **Caretaker:** can create tasks, with the assignee forced to themselves.
- **Bill to tenant:** creates a **draft** invoice for the unit's active lease, linked both ways. Nothing is issued automatically.
- **Recurring:**
  - `nextRunAt` is computed with Nairobi local dates.
  - The daily job creates each due copy **once**: a unique `scheduleId + occurrenceDate` guard makes it safe to re-run.
  - The schedule stops at its end condition.
- **Scope/permissions:** reuse the existing `requirePermission` and assignment scope. New actions:
  - `task:approve-cost`
  - `vendor:manage`
  - `task-schedule:manage`

**Permission matrix:**

| Action | Admin (owner) | Admin (agent) | Custodian | Caretaker | Tenant |
|---|---|---|---|---|---|
| View tasks (scoped) | ✓ | ✓ | ✓ | own and assigned | via complaint only |
| Create task | ✓ | ✓ | ✓ | self-assigned only | (complaint) |
| Assign | anyone in scope or vendor | same | same | self | – |
| Approve cost | ✓ | if owner is external and no custodian | if owner is external | – | – |
| Vendors | manage | manage | view | view | – |
| Recurring schedules | ✓ | ✓ | ✓ | – | – |
| Categories, threshold, common areas | ✓ | ✓ | view | view | – |

### 4.5 API (new routes are new files)

```
GET/POST        /api/v1/tasks                      (extended: filters for category, location, assignee kind, status set)
GET/PATCH/DEL   /api/v1/tasks/[id]                 (extended)
POST            /api/v1/tasks/[id]/status          transition (+ resolveComplaints)
POST            /api/v1/tasks/[id]/photos          add/remove (before|after)
POST            /api/v1/tasks/[id]/quote           set quote → may move to waiting_approval
POST            /api/v1/tasks/[id]/approval        approve | reject (approver only)
POST            /api/v1/tasks/[id]/cost            actual cost, receipts, payer, vendor payment
POST            /api/v1/tasks/[id]/bill-tenant     create draft invoice
GET/POST        /api/v1/tasks/[id]/activity        timeline + comments
GET/POST        /api/v1/vendors · GET/PATCH/DEL /api/v1/vendors/[id]
GET/POST        /api/v1/task-schedules · PATCH/DEL /api/v1/task-schedules/[id]
GET/PUT         /api/v1/properties/[id]/operations   threshold, common areas
GET/POST        /api/v1/task-categories
POST            /api/v1/tenant/me/complaints/[id]/confirm   fixed | not_fixed
```

All new routes follow the existing pattern: rate limit, same-origin check, `requirePermission`, Zod schema in `src/lib/schemas/`, and a scope check.

### 4.6 Screens

**Staff hub: "Tasks & Maintenance"** for admin, custodian (new nav item) and caretaker. Tabs, each shown only to roles that can use it:

1. **Tasks**
   - `DataTable` with filters (property, location, category, status, priority, assignee, due).
   - Views: **List** and **Board** (columns by status, drag to change status, phone-friendly).
   - Count cards: Open, In progress, Waiting, Overdue, Done this month.
2. **Complaints**
   - Staff currently have **no complaints screen**; complaints only reach them as notifications.
   - Inbox of tenant complaints, each showing its linked tasks; actions: open task, create extra task, link to an existing task.
3. **Approvals** (approvers only): cards showing the quote amount (`Money`), vendor, attached quote, the task and photos. **Approve** or **Reject**, with a note.
4. **Recurring:** list of schedules (next run, rule in plain words such as "Every 3 months on the 1st", end condition), pause/resume.
5. **Vendors** (admins): list, plus a create/edit sheet (name, phone, email, trades, properties served).

**Task detail page** (`/dashboard/{role}/tasks/[id]`):
- **Header:** title, status, priority, category, location breadcrumb (Property › Block A › Floor 3 › 3B), and an action bar with the allowed status moves.
- **Main column:**
  - description
  - **Before / After photos**
  - linked complaints (with tenant confirmation state)
  - **Cost card**: a stepper showing Quote → Approval → Work → Receipts → Vendor paid, with who pays and the "Bill to tenant" action
- **Side column:** assignee (staff or vendor with tap-to-call), due and scheduled dates, recurrence link, created by.
- **Activity:** timeline with a comment box.

**Create/edit task:** a side sheet with sections:
1. What (title, category, priority, notes)
2. Where (`LocationPicker`)
3. Who (assignee picker grouped into Staff / Vendors; caretakers fixed to self)
4. When (due date, scheduled date, "make this recurring")
5. Photos ("before")

**Caretaker on a phone:** "My tasks" sorted by due date, large **Start** / **Done** buttons, and "Add after photo" opens the camera.

**Tenant (existing complaints panel, extended):**
- Each complaint shows a progress timeline: **Received → Assigned → Scheduled (date) → Done**.
- When done, a **"Is it fixed?" Yes / No** prompt.

**Settings › Property operations** (admins): approval threshold, common areas, custom categories.

**Reports:** a **Maintenance** section showing spend by property and month, split by who paid, with the KES/USD switch.

### 4.7 Uploads

- A new UploadThing route, `taskMedia`: images up to 4 MB, PDFs up to 8 MB.
- Same auth and active-user check as `propertyImages`.
- Limits are re-checked when files are attached to a task.
- Privacy of quotes and receipts: see open question O2.

---

## 5. Phase 4: Brokers, bids and the marketplace

### 5.1 What already exists (kept, not replaced)

| Piece | Today |
|---|---|
| `BrokerProfile` | Statuses pending, verified, rejected, suspended; agency, licence, counties, payout method |
| `BrokerAuthorization` | Admin grants a broker a property, block or unit scope |
| `CommissionAgreement` | Basis `first_month_rent`, `percentage_of_rent` or `fixed`; rate; fixed amount; **`currency` field already present (KES)** |
| `ListingPublisher` | Broker's share link on a listing; unique per broker and listing |
| `Listing` | **Already one live listing per unit** (partial unique index); this is the base of "no double listing" |
| Attribution, accruals, payouts | Who brought the tenant; commission calculated and approved; payouts behind `COMMISSION_PAYOUTS_ENABLED` |

**Commission maths, attribution and listing rules stay unchanged.** The new flow ends by creating the same authorization, agreement and share-link records the platform already uses.

### 5.2 Decisions this phase implements

| Area | Decision |
|---|---|
| Who adds brokers | **System-admin and admin** |
| Details | Full name, phone, email, national ID (encrypted like users'), agency/company, payout details. *(No age, no KRA PIN)* |
| Access | Broker gets a link to set their own password (shown as "Copy invite link" until Phase 5 email) |
| Usable immediately | Admin-added brokers are created **verified** |
| Where they work | **Any listed property**, for **any admin** |
| Bidding | A broker **requests to list** a property and enters their proposed commission |
| Review | Owner (or custodian/admin for external owners) can **approve, reject or counter**; the broker accepts or declines a counter |
| Competition | **Several brokers** can be approved on the same listing; whoever brings the tenant earns the commission |
| Duplicates | A unit can't be listed twice (message says who holds it); **matching photos are flagged to the system-admin** |
| Deactivation | **System-admin only**; commission already earned is **still paid** |
| Old self-signed-up brokers | Treated the same once active |
| Currency | The commission can be KES or USD, with live conversion shown both ways |

### 5.3 Data model (additive)

**New collection `BrokerBid`:**
```
listingId, unitId, propertyId, brokerUserId
offers: [{ by: broker|owner, basis, rateBps, fixedAmountMinor, currency (KES|USD), message, at }]
status: pending | countered | accepted | rejected | withdrawn | expired
decidedByUserId, decidedAt, decisionNote
result: { authorizationId, agreementId, publisherId }     (filled on accept)
expiresAt                                                  (see O5)
```
- Unique index: **one open bid per broker per listing**.
- Further indexes: `listingId+status` and `brokerUserId+status`.

**Additive fields on existing models:**
- `BrokerProfile`: `nationalId` (encrypted), `addedByUserId`, `addedVia: self|admin|system`.
- `CommissionAgreement`: `bidId`. The existing `currency` now also accepts `USD` for fixed amounts. Percentage bases stay currency-neutral, because rent is in KES.
- `CommissionPayout`: `fx {sourceCurrency, sourceAmountMinor, rate, rateDate}`.

**New collection `MediaFingerprint`:**
- Fields: `{ url, hash (64-bit perceptual), listingId, propertyId, uploadedBy }`.
- Computed with `sharp`, which is already installed.

**New collection `ListingFlag`:**
- Fields: `{ kind: duplicate_photo, listingId, matchedListingId, distance, status: open|dismissed|actioned }`.

### 5.4 Flows

1. **Add broker** (system-admin › Users › Brokers, or admin › Brokers):
   - Dialog with the fields above.
   - Creates a broker `User` and a **verified** `BrokerProfile` in a **new** route (`/api/v1/brokers/invite`), not in Abdalla's `admin/users` route.
   - Returns an invite link to copy.
   - An admin may also authorise the broker on their own properties right away, with commission terms (see O4).
2. **Find and bid** (broker dashboard › **Find listings**):
   - Marketplace-style grid of live listings.
   - **Request to list** dialog:
     - Commission basis
     - Rate or fixed amount, using `MoneyInput` with KES/USD and the live "≈" line
     - A message
   - Then the **My requests** tab shows statuses, and counter-offers can be accepted or declined.
3. **Review** (admin › Brokers › **Requests**):
   - Grouped by listing, so competing bids can be compared side by side: broker, agency, past results, commission in both currencies.
   - **Approve**, **Counter** (shows the new terms and the conversion) or **Reject** (with a note).
4. **On approval**, the existing records are created in one guarded step:
   - an active `BrokerAuthorization` (unit scope)
   - an active `CommissionAgreement`, with terms already accepted because they came from the broker's own offer
   - a `ListingPublisher` share link
5. **Duplicates:**
   - Publishing or claiming a unit that already has a live listing is refused with "Already listed by …".
   - New listing photos are fingerprinted. Near-matches against **other** properties raise a `ListingFlag` in a new **system-admin › Flags** page (dismiss / take down).
6. **Deactivate** (system-admin): suspends the profile and stops new bids and share links. Earned accruals continue to payout.

### 5.5 Screens

| Role | Screen | Change |
|---|---|---|
| Broker | Dashboard | New tabs **Find listings** and **My requests**; commissions shown with `Money` (dual currency); existing tabs kept and moved onto the shared components |
| Admin | Brokers | Restructured into **Requests (n)** · **Brokers on my properties** · **Add broker**; existing authorise/agreement tools kept |
| System-admin | Users | Separate **Owners** and **Brokers** lists (see O3); broker detail panel; suspend / reactivate |
| System-admin | Flags | New: duplicate-photo review |
| Public | Marketplace + listing page | Price in KES with "≈ $"; KES/USD switch; "Listed by owner" / "Shared by broker" label (see O3) |

---

## 6. Phase 6: data fix

**What:** set the 2 units that are marked occupied but have no tenant or lease to **vacant**.

**How:**
1. A read-only list is shown first.
2. A dry-run script, with a backup of the previous values.
3. Applied only after approval, then verified.

---

## 7. Phase 5: notifications (after Abdalla's email work)

Built on his finished `email.ts` and `notifications.ts`, with templates in new files:

| Event | Who | Channel |
|---|---|---|
| Task assigned / due tomorrow / due today / overdue (daily) | Assignee; overdue also admin, owner, custodian | Email + in-app |
| Cost waiting for approval / approved / rejected | Approver / task creator | Email + in-app |
| Job approved → vendor | Vendor (if email set) | Email |
| Complaint progress, work done, "is it fixed?" | Tenant | In-app |
| Broker invite | New broker | Email (replaces "copy link") |
| Bid received / countered / approved / rejected | Owner-side approver / broker | Email + in-app |
| Duplicate photo flagged | System-admin | In-app |

Until this phase ships, the daily job and the actions write the same events to the task activity log, so nothing is lost and the history is complete.

---

## 8. Database changes at a glance

| Type | Items |
|---|---|
| New collections | `TaskActivity`, `Vendor`, `TaskSchedule`, `TaskCategory`, `PropertyOperations`, `FxRate`, `BrokerBid`, `MediaFingerprint`, `ListingFlag` |
| New optional fields | `Task` (location, category, photos, attachments, cost, complaintIds, scheduledFor, scheduleId…), `Complaint` (taskIds, tenantConfirmation), `BrokerProfile` (nationalId, addedBy, addedVia), `CommissionAgreement` (bidId), `CommissionPayout` (fx) |
| Enum additions | Task status + 4 values; agreement currency + `USD` |
| Removed or renamed | **Nothing** |
| Migrations | **None needed.** New indexes are built automatically on deploy |

---

## 9. Testing and release

**Per slice:**
- Unit tests for the rules: transitions, approver resolution, recurrence dates, FX maths, bid state machine, duplicate detection.
- Route tests for every endpoint: permissions per role, scope, validation.
- Component tests for every new screen.
- `typecheck`, `lint`, full test suite and `next build` all green before pushing.

**Before a flag is switched on (on a preview):**
- A written click-through script per role: admin-owner, admin-agent, custodian, caretaker, tenant, broker and system-admin.
- Each run is recorded with screenshots.
- Test data is named `TEST – …` and cleaned up afterwards with a listed, approved script. This matters because the database is shared with the live site until §1.1 is resolved.

**Releases:**

| Release | Contents | Flag(s) on |
|---|---|---|
| 1 | UI foundations, clickable titles, FX service, daily job (FX step only) | `FX_DISPLAY_ENABLED` (after review) |
| 2 | Tasks & Maintenance, all four features | `TASKS_V2_ENABLED` |
| 3 | Broker bids and marketplace | `BROKER_BIDS_ENABLED` |
| 4 | Notifications (after Abdalla) | n/a |

Each release goes `stage` → PR to `dev` → test → `main`, as in §1.2.

---

## 10. Decisions on the open questions (answered 2026-11-25)

| # | Question | Decision |
|---|---|---|
| O1 | Owner reports in USD: which rate? | **The rate on each payment's date.** History never changes |
| O2 | Privacy of quotes and receipts | **Private files**, opened through the app only by people allowed to see the task |
| O3 | "Separate Owners list / Broker list" | **Both:** separate Owners and Brokers lists in system-admin › Users, **and** a "Listed by owner" / "Shared by broker" label on marketplace listings |
| O4 | Commission when a system-admin adds a broker | A **default commission saved on the broker profile**, pre-filled in their bids. An admin adding a broker can also authorise them on their own properties with terms right away |
| O5 | Bid expiry | Unanswered bids **expire after 14 days**; the broker can bid again |
| O6 | Separate dev database and second Vercel project | **Later.** Until then, the shared database means all test data is named `TEST – …` and removed afterwards with a listed, approved script |
| O7 | Who makes Vercel changes | **Me, through the signed-in Vercel CLI**: I prepare the exact change, and you approve **each time** before it's applied |
| – | Still with the client | **Q50** (extra invoicing items), **Q54** (who manages which property) |

---

## 11. Order of work after approval

1. Sync `stage` ← `dev`; confirm the file-ownership list with Abdalla.
2. Phase 1 (UI foundations, Fix 3) → Phase 2 (FX, daily job) → **Release 1**.
3. Phase 3 (tasks) in slices on `stage` behind the flag → test on preview → **Release 2**.
4. Phase 4 (brokers) the same way → **Release 3**.
5. Phase 5 once Abdalla's email work is done → **Release 4**.
6. Phase 6 data fix whenever approved.
