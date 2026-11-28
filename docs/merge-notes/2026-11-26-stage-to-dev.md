# Merging `stage` → `dev` (2026-11-26)

`dev` has only moved by merge commits of `stage` (PR #6, then `e46733f`), so merging
`stage` again has no conflicts. Merge it as is (merge commit or fast-forward; please don't
squash, the commits are grouped by area so they're easy to review and revert).

## Before you merge

- `npm ci && npm run typecheck && npm run lint && npx vitest run && npm run build` must be green.
  It was green on `stage` at the time of writing.
- **No migrations.** Every schema change is a new collection or an optional field with a
  default. New indexes build on first use.

## What turns on when

Everything new is behind release flags, which are **off unless set**:

| Flag | Covers |
|---|---|
| `TASKS_V2_ENABLED` | Tasks & Maintenance hub, auto-task from complaints, recurring jobs, task reminders and notices |
| `BROKER_BIDS_ENABLED` | Broker requests to list, add-broker (emails the invite), brokers' own listings, duplicate-photo flags, custodian "Broker requests" page |
| `FX_DISPLAY_ENABLED` | "≈ $" USD hints next to KES amounts |

On Vercel they are `true` for **Preview** and `false` for **Production**.

Things that are **not** behind a flag (they're safe as they are):
- **Labels:** "Owner" for admin accounts, "Service providers" for vendors, "Agent" for
  caretakers marked as managing agents. These change wording only; role keys are unchanged.
- **Security:**
  - Bot/crawler blocking in `src/proxy.ts`.
  - `robots.txt` rules and `X-Robots-Tag: noindex` on dashboard, API and auth pages.
  - Database-backed rate limits.
  - Brokers' payout data and national ID are no longer returned to owners.
  - `caretakerIds` are no longer returned by the public property list.
  - Bid offers no longer include internal account ids.
  - Recipient addresses in email-failure logs are masked (`j***@e***.com`), including
    addresses inside SMTP error replies (`lib/mask-email.ts`).
  - Listing create/update:
    - A malformed id is a 400 (was a 500).
    - A bad JSON body is a 400.
    - Listing photos must be files uploaded through the app, so public pages never load
      outside image links.
- **Same-origin check (`checkSameOrigin` in `lib/rate-limit.ts`):**
  - It now also accepts the address the request was served on.
  - Before, it compared only with `NEXT_PUBLIC_APP_URL`, which is set for Production only. So
    every protected write failed with "Invalid origin" on Vercel Previews, and on the bare
    domain without `www`.
  - Cross-site requests are still refused.
- **Dependencies:**
  - `next` 16.3.8 → 16.4.6 (critical and high advisories, same major version).
  - `overrides.effect = 3.22.4`. UploadThing uses this package. This fixes its high advisories
    within effect 3.x, which UploadThing's own version range allows.
- **Daily job:** `vercel.json` schedules `GET /api/v1/cron/daily` at 03:00 UTC, protected by
  `CRON_SECRET`. Its steps: FX refresh, recurring tasks, task reminders, bid expiry and listing
  expiry. Steps for a feature skip themselves while that feature's flag is off.

## Your files this touches

Changes are additive wherever possible. The main ones:

- **`models/Notification.ts`, `types/notifications.ts`, `NotificationsList.tsx`:** 8 new
  notification types (`task:*`, `broker:*`, `listing:flagged`) and their labels.
- **`lib/email.ts`:**
  - The welcome email shows display role names ("Owner").
  - Invite copy for brokers.
  - No change to sending.
- **`models/User.ts`:** optional `staffTitle` (`"" | "agent"`). It's returned by
  `/api/auth/me` and the caretakers list.
- **`CaretakerPrivilegesTable.tsx`:** an optional "Managing agent" switch (`canSetAgent`
  prop). Only the owner and system-admin pages pass it.
- **`UserRoleManager.tsx`:** role names shown via `lib/role-labels.ts`, including in the
  confirmation dialog.
- **`config/dashboardNav.ts`:** flagged nav items only (`releaseFlag`).
- **`BrokerDashboard.tsx`:**
  - Flagged tabs.
  - Notification links can open a tab via `?tab=`.
- **Admin pages:** `roleName="Owner"`.
- **`proxy.ts`:** bot guard added before your existing logic.

## Fixed in your code (on stage, with tests)

- **Server logs:** these wrote full recipient addresses to the logs. They are masked now:
  - `logEmailSendFailure` and the "SMTP not configured" warning in `lib/email.ts`.
  - The invite-failure logs in the admin users, caretakers, custodians and tenants routes.
- **`api/v1/listings/[id]` and `api/v1/listings`:** id, body and photo validation (see above).
- **`checkSameOrigin`:** Preview and bare-domain writes (see above).
- **Sign-up and email verification:**
  - Tested end to end on the live site: sign-up, email in the inbox, link, dashboard, sign-in.
  - SMTP on Vercel works. The fixes below are for the dead ends users could hit. The account
    and verification rules are unchanged, including the 24-hour expiry and rate limits.
  - **`auth/verify/page.tsx`:**
    - The page could show "Verification failed" even though the account had just been
      confirmed. This happened because the verify request ran twice and the link only works
      once: always under dev StrictMode, and in production on a double load.
    - All runs for the same token now share one request (`verifyOnce`).
  - **`api/auth` sign-in:**
    - The password is now checked before the verified check.
    - An unverified account gets `403 { code: "EMAIL_NOT_VERIFIED", email }`, so a wrong
      password never reveals that an account is unconfirmed.
  - **`api/auth` sign-up:**
    - Signing up again with an unconfirmed email gets `409 { code: "EMAIL_NOT_VERIFIED" }`.
      Before, it said "Email already registered" with no way forward.
    - A phone number already used by another account was a 500 (Mongo E11000 on the unique
      `phone` index). It is now a 409 with a clear message.
    - Validation errors return the first field's message instead of "Invalid input".
  - **`auth/page.tsx` and `hooks/use-auth.tsx`:**
    - On `EMAIL_NOT_VERIFIED`, the form shows the "check your inbox" panel with a "Send a new
      verification link" button, instead of an error toast.
    - `use-auth` throws `AuthError` (with `code` and `email`).
    - The national ID check on the form now matches the server: letters and numbers only,
      4–32 characters.
  - Tests are in `api/auth/route.test.ts` ("new users who have not confirmed their email") and
    `auth/verify/page.test.tsx` (including a StrictMode case).

## Security and stability audit (2026-11-27)

Whole-system pass: every API route, the auth flow, payments, uploads, config and dependencies,
plus every page rendered at phone (390px) and desktop (1280px) width for each role.
Decisions marked *(client)* were approved by the client before the change.

- **Account takeover (critical), `api/auth`:**
  - `verify-email` and `reset-password` passed `token` from the body straight into
    `User.findOne`. A body like `{"token": {"$ne": null}}` matched any account with a pending
    link: it could verify and sign in as that account, or set its password.
  - Both now accept text tokens only (`isLinkToken`). The new password must be text too (an
    array used to crash bcrypt with a 500).
  - Tests are under "link tokens must be text".
- **Password reset signs out everywhere** *(client)*: a reset bumps `tokenVersion`.
- **Revoked sessions kept working:**
  - 50+ routes used the bare `authenticate()`, which reads the cookie only. After a
    deactivation, role change or "sign out everywhere", the old token still worked there until
    it expired, including admin commission payouts (pay/fail), broker verification, contact
    messages, assignments, broker agreements, listings and uploads.
  - They now use `authenticateSession()` (`lib/auth-scope.ts`), the same active-account and
    `tokenVersion` check as `requirePermission`.
  - It uses the per-request context cache, so a route that also calls `requirePermission`
    makes no extra query.
  - Route tests stub it to token-only. The real check is tested in `lib/auth-scope.test.ts`.
- **Cross-site writes:**
  - `proxy.ts` now runs `checkSameOrigin` on every `POST/PUT/PATCH/DELETE` to `/api/*`.
  - 46 write routes had no origin check and relied only on the `SameSite=Lax` cookie.
  - Payment callbacks, UploadThing and cron are exempt by path (`isMachinePath`, shared with
    the bot guard). Server-to-server calls send no browser origin headers anyway.
- **Malformed input:**
  - 24 routes called `request.json()` without a catch, so bad JSON was a 500. They now use
    `readJsonBody`, and their existing schema returns a 400.
  - 11 `[id]` routes lacked an id check, so a malformed id was a 500 or leaked
    "Cast to ObjectId failed". They now return 400 `Invalid id`.
  - The public `marketplace/listings/[id]` returns 404 for a value that is neither a share code
    nor an id.
- **Listings create/update (`lib/listing-input.ts`):**
  - Field types now follow the model's own rules.
  - Updates skip model validation, so rent could be set to 0 or negative and an invalid
    visibility saved. Both are refused now.
  - `propertyId`/`unitId` must be ids, not query objects. `reason` is text only.
- **Rate limiter** *(client)*:
  - The general limiter shared one per-IP counter across 58 routes with different limits.
  - Each route now has its own counter (`routeBucket`: method + path, ids collapsed). The
    limits themselves are unchanged.
- **Image optimizer** *(client)*:
  - `images.remotePatterns` allowed any host, so anyone could use the project's image quota
    as a proxy. It is now limited to `utfs.io`, `*.ufs.sh` and `images.unsplash.com`
    (`lib/image-hosts.ts`).
  - Images on other hosts render `unoptimized` instead of failing.
- **Permissions** *(client)*:
  - Brokers can read their own notifications. Bid answers, listing reviews and enquiries were
    sent to them, but every notification route returned 403 and the bell failed on every
    broker page.
  - Staff with no assignment yet can read their own notifications and settings
    (`SELF_ONLY_ACTIONS`). Property, tenant and money actions are still refused.
- **Crash:** the system-admin Portfolio page crashed ("Application error") on a property
  without an `images` field (Sunrise Apartments on dev). Three readers now fall back to the
  placeholder.
- **Mobile layout:**
  - Shared tab bars and dialogs never exceed the screen. Tabs scroll sideways, and dialogs
    scroll inside up to the screen height.
  - The Accounting, Tenants, Portfolio and Units toolbars wrap on phones.
  - The dashboard's mobile menu scrolls and has search (search was hidden below tablet width).
  - Long page titles no longer push past the header.
  - A rendered check of all pages found 0 overflowing pages, 0 crashes and 0 server errors.
- **Broker dashboard:** the "needs your answer" dot was invisible (an inline span has no
  size). It is fixed, with a screen-reader label.
- **Dependencies:**
  - `npm audit fix` (no breaking upgrades), lockfile only. shadcn CLI 4.21.0 → 4.23.1, plus
    patch updates to vite and undici.
  - Express is gone from the tree. It was an optional peer of UploadThing's Express adapter,
    which the app doesn't use.
  - 6 moderate advisories remain, all in UploadThing's `@effect/platform` (see below).

## Email links, account privacy and hardening (2026-11-27, client-approved)

- **Hashed email links (`lib/link-tokens.ts`):**
  - Verification, invite and reset links are stored only as a SHA-256 fingerprint, so
    someone reading the database can't use a pending link. All 8 writers were changed:
    `api/auth` plus the admin users, caretakers, custodians, tenants and broker invite routes.
  - Lookups also accept the plain value (`storedLinkTokenMatch`), so links sent before this
    change keep working until they expire (24 hours at most). Nothing already sent breaks.
- **Separate reset link:**
  - New `User.resetPasswordToken` / `resetPasswordTokenExpiry` fields. Requesting a reset
    no longer cancels a pending verification link.
  - Reset links sent before this change, stored plain in `verificationToken` with a 1-hour
    expiry, are still honoured inside a 1-hour window, then cleared.
- **No account discovery:**
  - `resend-verification` gives the same 200 answer for unknown, confirmed and unconfirmed
    emails.
  - Sign-up with an email that already has an account gives the same answer as a new
    sign-up. An unconfirmed account gets a fresh verification link. A confirmed or
    deactivated one gets the new `sendAccountExistsEmail` ("you already have an account",
    with sign-in and reset links). The existing account is never changed.
  - `forgot-password` and existing-email sign-up now use the same per-email limit as resend.
  - The phone-number check on sign-up still says when a number is taken: an account can't be
    created without a unique number.
  - UI copy changed to match: "Check your inbox" toasts and a neutral "we sent an email" panel.
- **Indexes:** sparse indexes on `verificationToken` and `resetPasswordToken`, so link
  lookups don't scan the users collection. They build on first use.
- **Uploads (`lib/upload-rules.ts`, `api/uploadthing/core.ts`):**
  - All three upload routes refuse SVG (it can carry script) and files whose extension
    doesn't match their type (e.g. `evil.html` sent as `image/png`).
  - Photos must be JPG, PNG, WebP, GIF, AVIF or HEIC. Camera files with no extension pass
    on their type. Existing size and count limits are unchanged.
- **Property photos:** create/update accept only uploaded files (UploadThing hosts) or the
  site's own `/images/…` placeholders, at most 50. Before, any text was accepted: an outside
  tracking image, a `data:` blob or a `javascript:` link.
- **Overload limits (`proxy.ts`):**
  - API writes over 1 MB are refused with 413 before any route reads them. The largest real
    body is a full property structure, about 50 KB.
  - A per-IP ceiling of 600 API calls a minute applies, per instance. Payment callbacks,
    UploadThing and cron are exempt.
  - Search text is capped at 100 characters on the search and marketplace endpoints.
- **Links:** notification links are followed only if they are in-app paths
  (`lib/in-app-path.ts`). The server only ever sets fixed dashboard paths; this is a safety
  net.
- **Caching (latency):**
  - `lib/memory-cache.ts` is a short in-memory cache with one shared load per key. It is used
    for the stored USD/KES rate (5 minutes, cleared as soon as a new rate is stored).
  - Public marketplace responses (list, listing detail, broker listing detail) send
    `public, s-maxage=30, stale-while-revalidate=120` (`lib/edge-cache.ts`), so Vercel's
    edge serves them without reaching the server. Only viewer-independent routes use it.
  - Tests clear the cache after each test (`test/setup.ts`).
- **Verified against a running build:**
  - `{"$ne":null}` reset and verify tokens → 400.
  - A 1.1 MB body → 413. A write from another origin → 403. Malformed JSON → 400.
  - No user agent, or an attack-tool user agent → 403.
  - Resend answers are identical for unknown and registered emails.
  - A malformed public listing id → 404. An outside property photo → 400.
  - Both marketplace detail pages were rendered with test listings (deleted afterwards).

## CI fix and public email (2026-11-27)

- **Why CI failed on `dev` (run 45962846906):** the `biome check .` step failed on
  **formatting** in eight files (line wraps and blank lines), so typecheck, build and tests
  never ran. The `any` warnings did not fail it, because warnings don't stop the job. The eight
  files are now formatted. No code changed.
- **`any` in tests removed** (it was 21 uses, now 0):
  - Response bodies use a shared `ResponseJson` type (`test/utils/api-request.ts`).
  - `TestProperty` has optional `blocks`, so the unit tests need no cast.
  - Redaction tests now check that private fields are **absent**
    (`not.toHaveProperty`), which is stricter than the old `toBeUndefined`.
  - `scripts/wipe-and-reseed.ts` checks the DB connection instead of casting it.
- **Still warnings, not errors:** about 125 `any` uses remain in the broker, attribution
  and commission code (mostly `.lean()` results). Typing them is a refactor across those
  routes, so it was left for a separate change.
- **Public email:** the footer, contact page, FAQ, privacy and terms now show
  `info@custodianhomes.co.ke`. Signed-in help notes, email footers, and the inbox that receives
  contact-form messages still use `support@` (changed on 2026-11-28, see below).
- **Checking Biome on Windows:** with `core.autocrlf=true`, `biome check .` reports every
  file as misformatted (CRLF). To see what CI sees, check an LF worktree:
  `git -c core.autocrlf=false worktree add --detach <dir> stage`, then run Biome there.

## Owner fallback, history, drag-and-drop board, region, hardening (2026-11-28)

Decided with the project lead on 2026-11-28 (the client's answers to the open questions are
still pending; nothing here depends on them).

- **Tasks go to the owner when nobody manages the property.** If a property has no active
  caretaker, agent (a caretaker titled "agent") or custodian, a task that would be left
  unassigned is assigned to the owner. This covers tasks from tenant complaints, recurring tasks
  with no assignee, and new tasks created with no assignee (v1 and v2). If any of those staff
  exist, nothing changes. The task history says why the owner received it
  (`lib/maintenance/assignee.ts` `ownerFallbackAssignee`).
- **Every task needs a property.** An owner who left the property on "All properties" used to
  get a 500 (the model requires it). They now get 400 "Choose a property for this task".
- **History (audit) page for every role** (`/dashboard/<role>/history`, `GET /api/v1/audit`):
  - System admin: everything, and can add notes (`POST /api/v1/audit/:id/notes`, new
    `auditnotes` collection). Entries themselves are never edited or deleted.
  - Owner: entries on properties they own or are assigned to, and their own actions.
  - Custodian / caretaker: entries on properties they are actively assigned to, and their own
    actions, with phone, email and ID numbers hidden.
  - Tenant: their own invoices, leases, account and actions; staff are shown by role, not name.
  - Broker: their own actions and account.
  - Request fingerprints (`ipHash`, `userAgentHash`, `requestId`) are never sent.
- **Newly recorded in the history:** invoices created, issued, edited, voided, deleted and
  generated; payments recorded by hand; online payments; **online payments of the wrong
  amount** (not applied, now visible to the owner); leases created, changed (rent, dates),
  ended and deleted. Writes are best-effort (`lib/audit-records.ts`) and never block the
  action.
- **Drag-and-drop task board** (`@dnd-kit/core` 6.3.1, MIT): owners and caretakers get a
  List / Board toggle on the current task pages; the v2 board uses the same component. Mouse
  drag, touch press-and-hold, and keyboard (Space, arrows, Space). Allowed moves are exactly the
  existing buttons (v1) or the v2 transition rules; every card keeps a "Move to…" menu.
- **Region:** `vercel.json` now sets `"regions": ["hnd1"]` (Tokyo), next to the Atlas
  cluster (AWS ap-northeast-1). Functions run in UTC in every region and the cron schedule is
  UTC, so dates and the daily job are unchanged. Pages and cached responses still come from
  Vercel's nearest edge.
- **Errors never expose system details:** `lib/public-error.ts` passes through the app's own
  messages and replaces database, driver and runtime errors with a generic message (the real
  error is logged). `/api/health` no longer returns the driver error, which could name the
  cluster host.
- **Sessions and sign-in:** tokens are signed and verified as HS256 only (other algorithms and
  unsigned tokens are rejected; existing sessions are HS256). Sign-in takes the same time
  whether or not the account exists, and an account without a password fails like a wrong
  password. Identifier capped at 320 characters.
- **UI:**
  - The desktop sidebar's links scroll inside it, so opening a group no longer pushes
    "Need help?" out of the box.
  - Dropdown lists never run off screen.
  - Page titles get their own row on phones.
  - Every address shown in the app and in emails is `info@`. Contact-form messages are still
    delivered to `support@`.
- **Verified:**
  - In a real browser: 120 overlay checks (every sidebar group at three desktop heights, and
    every dropdown on key pages) and 182 page loads across all roles at phone and desktop
    width, with no overflow or errors.
  - On the dev database: the board's mouse, keyboard and phone moves, and the owner fallback.
    Test data was removed afterwards.

## Sign-out, dependencies, types and lint (2026-11-28, later)

- **Sign-out** is a POST now (covered by the proxy's same-origin check). A GET still works only
  when the browser marks it `Sec-Fetch-Site: same-origin` (tabs on the previous build), so a
  link or image on another site can no longer sign people out.
- **`npm audit`: 0 vulnerabilities.**
  - `overrides["@effect/platform"] = "0.97.4"` patches the advisory UploadThing 7.7.4 pulled
    in (it pins 0.90.3). Every `@effect/platform` function UploadThing calls exists in 0.97.4.
    Its HTTP client calls were run against a local server, and the existing `effect 3.22.4`
    override meets the new peer range. **When UploadThing ships a release on a patched version,
    drop this override.**
  - `vitest` and `@vitest/coverage-v8` are on `~5.0.5` (patched; 5.1.x was too new to
    adopt). `vitest` moved to devDependencies.
- **No explicit `any` left** (it was 145). `lib/lean.ts` types `.lean()` results from each
  model's schema. Eligibility and share-code results are discriminated unions. The broker routes
  now return generic errors via `publicErrorMessage`. No runtime changes.
- **Found while typing (behaviour unchanged, client decision):** `CommissionAgreement` has
  no `taxBps` or `paymentTerms` field, so every accrual uses the default tax rate
  (`DEFAULT_TAX_BPS`) and empty payment terms. Add the fields if agreements should carry their
  own values.
- **Lint: 0 warnings** (was 159). The tenant requests unit fetch keys on a stable id string; the
  service-fee refetch counter is documented as a deliberate trigger.

## Still open

- Private files need a paid UploadThing plan. Task photos and receipts rely on unguessable
  links that are only returned to people allowed to see the task.
- The general rate limiter and the new per-IP ceiling are in memory per server instance.
  Large distributed floods are handled by Vercel's built-in network protection. Vercel's
  Firewall rules and Attack Challenge Mode are dashboard settings, left to the client.
- **Atlas backups are inactive** on the cluster (Tokyo, 3-node replica set). Turn on
  continuous or snapshot backups in Atlas; nothing in the app can replace them.
- About 150 free-text fields have no individual length cap. The 1 MB body limit bounds them.

## Local `.env` note

Next.js expands `$` in `.env` values, even inside quotes. If `EMAIL_PASS` (or any secret)
contains `$`, write it as `\$` in your local `.env`, or SMTP fails with `535` (bad
credentials). Vercel's environment variables are used as is and are not affected.

## Data change already made (dev database only)

Units **GA** and **GB** had a tenant account linked as occupant, but no tenant record and no
lease. Both were set to `available` and the occupant link removed, using
`scripts/fix-orphaned-occupied-units.ts`. A backup was taken first and is kept off-repo.
**Nothing was changed on the main database.** Run the script there (dry run first) only if
the same problem shows up.
