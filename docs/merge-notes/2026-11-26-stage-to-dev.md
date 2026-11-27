# Merging `stage` → `dev` (2026-11-26)

`dev` has not moved since `stage` branched from it, so this is a **fast-forward**: no
conflicts. Open a PR `stage → dev` and merge it as is (merge commit or fast-forward; please
don't squash, the commits are grouped by area so they're easy to review and revert).

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

## Still open

- UploadThing has no patched 7.x release for the current advisory, and private files need a
  paid plan. Task photos and receipts rely on unguessable links that are only returned to
  people allowed to see the task.
- **Found but not changed (each would change behaviour; raise with the client first):**
  - Verification and reset links are stored in plain text, so a database leak exposes the
    pending links. Hashing them would invalidate links already sent.
  - Verification and reset share one token field, so requesting a reset cancels a pending
    verification link.
  - `resend-verification` answers "User not found", which reveals whether an email is
    registered. Sign-up reveals the same thing by design.
  - The general rate limiter is in memory per server instance. On Vercel each instance counts
    separately; the database-backed limiter covers sign-in and enquiries.
  - The marketplace and broker listing detail pages were not rendered in the layout check:
    the dev database has no live listing.

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
