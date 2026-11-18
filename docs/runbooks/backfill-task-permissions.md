# Runbook — backfill caretaker task permissions

One-time data reconciliation for Fix 1 of
`docs/plans/2026-11-18-tasks-invoices-table-navigation.md` (§1.6, WP5).

The caretaker privilege map now derives `manage_tasks` →
`["task:read-own", "task:create", "task:manage"]`
(`src/lib/authorization-policy.ts:425`), but only **future** privilege syncs
re-derive stored rows. Existing active caretaker `ManagementAssignment` rows
still hold `["task:manage"]` and 403 on `GET/POST /api/v1/tasks`. This backfill
adds the two missing tokens to those rows — nothing else.

| Item | Value |
|---|---|
| Script | `scripts/backfill-task-permissions.ts` (`npm run backfill:tasks`) |
| Mode | **dry-run by default**; `--apply` to write |
| Env | `MONGODB_URI` from `.env.local` (via `dotenv`) |
| Write shape | `$addToSet` `task:read-own` + `task:create` only — never `$set` on `permissions` |
| Selection | active `accessRole: "caretaker"` assignments whose principal (`users.privileges`) holds `manage_tasks` |
| Idempotent | rows already holding both tokens are filtered out; a second run matches **0** |

> **Run on the host, never inside the app container** — the compose image
> ships no `tsx`. See §6.

---

## 1. Preflight — back up the collection

Take a dump of `managementassignments` before anything else. Keep it until
verification (§4) is recorded.

```bash
mongodump --host <host> --port <port> \
  --username <backup-user> --authenticationDatabase admin \
  --db <db> --collection managementassignments \
  --out ./backups/managementassignments-$(date -u +%Y%m%dT%H%M%SZ)
```

URI form (when the URI already names the database):

```bash
mongodump --uri "$MONGODB_URI" --collection managementassignments \
  --out ./backups/managementassignments-$(date -u +%Y%m%dT%H%M%SZ)
```

Never paste the connection string into logs or tickets. Confirm the dump
contains documents (`bsondump` or `mongorestore --dryRun` on a scratch host).

## 2. Dry-run

```bash
npm run backfill:tasks
```

No writes happen. Read the output top to bottom:

- `Target: <host>/<db>` — **confirm this is the intended environment** before
  going further. Credentials are never printed.
- `Caretaker principals holding "manage_tasks": N` — the authoritative grant
  comes from `users.privileges`, not from assignment permissions.
- `Skipped (…principal does not hold the privilege): N` — active caretaker
  assignments left untouched because their principal lacks `manage_tasks`.
  This count must not change after apply.
- `Assignments missing at least one token (preflight): N` — the write set.
- One `would update assignment=<id> principal=<id> property=<id> add=[…]`
  line per affected row, batched (100 per batch) with
  `batch N: matched X, would modify X` summaries and a final total.
  **Save this output** — the assignment ids are your rollback list (§5).
- `Dry run complete (no changes written).`

Sanity checks: every `add=[…]` list contains only `task:read-own` and/or
`task:create`; no row appears twice; the total equals the preflight count.

## 3. Apply

```bash
npm run backfill:tasks -- --apply
```

- Each batch logs `batch N: matched X, modified Y` from the actual
  `updateMany` result, plus a final `Total: matched …, modified …, skipped …`.
- The update is re-guarded at write time (same selection filter plus the
  batch's `_id`s), so a concurrent privilege sync cannot cause a stale write.
- Only `permissions` (and `updatedAt`) change. No upserts, no new rows, no
  fields that participate in the partial unique index
  (`src/models/ManagementAssignment.ts:41-51`) are touched.
- The script exits non-zero on connection errors, non-array `permissions`
  validation failures, or a non-zero residual count after apply. **Do not
  proceed to verification if the exit code is non-zero** — investigate first.
- Expected final line: `Backfill complete. Residual missing-token count: 0.`

## 4. Verification

In `mongosh` against the target database — the count of active caretaker
assignments for `manage_tasks` principals missing `task:read-own` or
`task:create` must be **0**:

```js
const principalIds = db.users
  .find({ role: "caretaker", privileges: "manage_tasks" }, { _id: 1 })
  .toArray()
  .map((u) => u._id.toString()); // principalUserId is stored as a string

db.managementassignments.countDocuments({
  accessRole: "caretaker",
  status: "active",
  principalUserId: { $in: principalIds },
  permissions: { $not: { $all: ["task:read-own", "task:create"] } },
});
// expected: 0
```

Idempotency check — re-run the dry-run; it must report preflight `0` and
`Already reconciled — nothing to do.`:

```bash
npm run backfill:tasks
```

Smoke test with a real caretaker token holding `manage_tasks`:
`GET /api/v1/tasks` → 200 and `POST /api/v1/tasks` → 201 (previously 403).
Record the verification output alongside the backup location.

## 5. Rollback

Rollback restores the pre-backfill state (caretaker GET/POST 403s return —
fail-closed, not a leak). Prefer it only if the backfill itself misbehaved.

`$pull` the two tokens **from the affected assignment ids only** — the ids
printed in the dry-run/apply output (§2). A blanket `$pull` across all
caretaker rows would also strip tokens legitimately granted by post-fix
privilege syncs.

```js
db.managementassignments.updateMany(
  {
    _id: {
      $in: [
        // ObjectId("<assignment id from the apply log>"), …
      ],
    },
  },
  { $pull: { permissions: { $in: ["task:read-own", "task:create"] } } },
);
```

Then re-run the §4 query — the count returns to the preflight number.

If the goal is to remove a caretaker's task access entirely, **revoke rather
than delete**: remove `manage_tasks` via
`PUT /api/v1/caretakers/[id]/privileges` (which re-syncs assignments), or set
the assignment's `status` to `revoked`. Never delete assignment rows — they
are the authorization audit trail, and deletion interacts badly with the
partial unique index on active rows.

Full restore from the §1 dump is the last resort:
`mongorestore --db <db> --collection managementassignments --drop <dump-dir>`.

## 6. Execution constraint — host only

**Run on the host, never inside the app container.** The compose image ships
no `tsx`, so `npm run backfill:tasks` cannot execute there. Requirements:

- Node.js + the repo's `node_modules` (`tsx`, `dotenv`, `mongoose` are already
  declared — no new dependencies).
- `.env.local` with `MONGODB_URI` pointing at the target cluster. To operate
  on a non-local database, point the variable at that cluster deliberately
  and temporarily; the script prints `Target: <host>/<db>` at startup — read
  it before passing `--apply`.
- Network reachability from the host to the cluster (the app container's
  network is not required).

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing MONGODB_URI environment variable` | `.env.local` absent or lacks the key | add it; never commit the file |
| Exit 1 with a connection error | cluster unreachable / bad credentials | fix connectivity; error output redacts URIs |
| `Validation failed: … non-array permissions` | corrupt row | inspect the row manually; the script refuses to write it |
| `Verification failed: N assignment(s) still missing tokens` | concurrent writer or partial failure | re-run dry-run, inspect the listed rows, re-apply |
| `Unknown argument(s)` | typo in flags | only `--apply`, `--dry-run`, `--help` are accepted |
