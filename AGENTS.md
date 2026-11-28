<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on Custodian Homes

Guidance for developers and coding agents. `CONTRIBUTING.md` is the full team guide; the
latest merge notes live in `docs/merge-notes/`.

## Ground rules

- **Don't change business logic without approval.** Rent, invoices, payments, deposits,
  commissions, permissions and task rules are client decisions. If a fix would change what a
  user can do or what money moves, stop and ask; record the decision in the merge notes.
- **Branches:** work on `stage` → merge to `dev` (deployed test environment) → `main` (real
  data). Never push to `dev` or `main` without the project lead's go-ahead. Commit in small,
  categorized commits (`fix(security): …`, `feat(tasks): …`, `test: …`, `docs: …`); never
  squash a stage → dev merge.
- **Never commit `.env`** or print secrets. The local `.env` database is the dev database; ask
  before writing to it, name any test data `TEST - …`, and delete it afterwards.
- **Vercel and Atlas settings are not code changes.** Anything in the Vercel dashboard or
  Atlas (env vars, firewall, promotion to production, backups) is the project lead's call.
  Exception: `vercel.json` (functions run in `hnd1`, Tokyo, next to the Atlas cluster in AWS
  ap-northeast-1; keep them in the same region).

## Commands

| Task | Command |
| --- | --- |
| Type check | `npm run typecheck` |
| Lint + format check (what CI runs) | `./node_modules/.bin/biome check .` |
| Tests | `npx vitest run` (full suite ≈ 15–35 min) |
| Build | `npm run build` |

CI (`.github/workflows/ci.yml`) runs Biome, typecheck, build and tests on pushes and PRs to
`dev` and `main`. Biome **errors** fail CI; warnings don't.

**On Windows:**
- Run Vitest from PowerShell, not Git Bash. In Git Bash, a `c:` vs `C:` path mismatch loads
  Vitest twice and every file fails with "failed to find the current suite".
- With `core.autocrlf=true`, Biome reports every file as misformatted. To see what CI sees,
  check an LF worktree: `git -c core.autocrlf=false worktree add --detach <dir> stage`.
- Don't run the test suite and a build at the same time; tests time out.

## API route checklist

Every route under `src/app/api` follows the same shape. Use the shared helpers; don't
re-implement them.

1. **Rate limit** writes with `rateLimit(request, …)` (`lib/rate-limit`). The proxy
   (`src/proxy.ts`) also enforces same-origin on API writes, a 1 MB body cap, and a per-IP
   ceiling. Payment callbacks, UploadThing and cron are exempt by path (`lib/bot-guard`).
2. **Authenticate** with `authenticateSession` / `requirePermission` / `resolveDashboardActor`
   (`lib/auth-scope`, `lib/permissions`). These check `isActive` and `tokenVersion`, and take
   the role from the database. Scope every query to what the actor may see.
3. **Validate ids** with `isValidObjectId` before any lookup (an invalid id returns 400 or 404,
   never 500).
4. **Read bodies** with `readJsonBody(request)` (`app/api/v1/_helpers`) and parse them with
   zod. Values used in Mongo filters must be checked as strings or numbers: Mongoose passes
   objects like `{"$ne": null}` straight through.
5. **Escape user text** before building a regex (see `escapeRegex` in the search route), and cap filter lengths (100
   characters).
6. **Errors:** never return `error.message` from an unknown error. Use
   `publicErrorMessage(error, "Generic text", [DomainErrorClass])` (`lib/public-error`), or
   return the message of your own domain error class only.
7. **Audit** sensitive changes with `recordAudit` / `recordInvoiceAudit` / `recordLeaseAudit`
   (`lib/audit-records`). These are best-effort and never throw. Who sees which entry is
   decided in `lib/audit-view`.

## Security rules already in place (keep them)

- Sessions are HS256 JWTs in the `keja-token` cookie (httpOnly, `sameSite: lax`). Verify with
  `JWT_VERIFY_OPTIONS` (`lib/jwt`). A password reset bumps `tokenVersion`, which signs the
  account out everywhere.
- Email-link tokens are stored hashed (`lib/link-tokens`), and reset links use their own field.
  Sign-up, resend and forgot-password never reveal whether an email is registered. Sign-in
  takes the same time either way.
- Uploads: raster images only (no SVG), with the file extension matching the type, and
  property photos must come from the upload host (`lib/upload-rules`). The image optimizer
  only accepts the hosts in `lib/image-hosts`.
- In-app notification links must pass `isInAppPath` (`lib/in-app-path`).
- Public marketplace responses may use `PUBLIC_EDGE_CACHE` (`lib/edge-cache`). Never use it on
  a response that depends on who is signed in.

## Domain notes

- The `admin` role is shown as **Owner**. A caretaker with `staffTitle: "agent"` is shown as
  **Agent** (`lib/role-labels`).
- Task status moves follow `lib/maintenance/status.ts` (v2) or the existing buttons (v1).
  The drag-and-drop board (`components/tasks/DndTaskBoard`) only applies those rules.
- An unassigned task on a property with no active caretaker, agent or custodian goes to the
  owner (`ownerFallbackAssignee`). Every task needs a property.
- Tasks & Maintenance v2, broker bids and FX display are behind release flags
  (`lib/feature-flags`). Production currently runs the v1 task screens.
- Emails shown to users use `BRAND.emails.info`. Contact-form messages go to
  `BRAND.emails.support` (`lib/brand`).

## UI conventions

- Build from `src/components/ui` (shadcn/Radix) and the shared shells (`DashboardShell`). Every
  page must work at 390px width with no sideways scroll.
- Dialogs and sheets scroll within the screen height, and dropdown lists never run past the
  screen edge (`components/ui/select`).
- Dashboard pages are added to `src/config/dashboardNav.ts` and guarded by
  `lib/role-routes.ts`. The server still enforces access on every API call.
