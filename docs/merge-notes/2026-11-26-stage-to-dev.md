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

## Still open

- UploadThing has no patched 7.x release for the current advisory, and private files need a
  paid plan. Task photos and receipts rely on unguessable links that are only returned to
  people allowed to see the task.

## Data change already made (dev database only)

Units **GA** and **GB** had a tenant account linked as occupant, but no tenant record and no
lease. Both were set to `available` and the occupant link removed, using
`scripts/fix-orphaned-occupied-units.ts`. A backup was taken first and is kept off-repo.
**Nothing was changed on the main database.** Run the script there (dry run first) only if
the same problem shows up.
