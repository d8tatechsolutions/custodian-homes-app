# Runbook — backfill user codes (`CXXXXXX`)

One-time data reconciliation for the permanent, unique user identifier
(`.opencode/plans/user-code.md`; Phase 2 rulings in §9, security ruling §10).

Every `User` document needs a permanent `userCode` of the exact form `CXXXXXX`
(`^C[0-9A-HJ-NP-Z]{6}$`). Users created after the rollout already receive one from
the generation module / creation-path retry wrapper
(`src/lib/user-code.ts` → `withUserCodeRetry`, backstop `pre("validate")` hook in
`src/models/User.ts`); users created before the rollout hold `userCode` missing,
empty or `null`. The partial unique index `user_code_unique`
(`{ userCode: 1 }`, `unique`, `partialFilterExpression: { userCode: { $gt: "" } }`)
deliberately excludes those rows, so the backfill assigns a code to every user
that still lacks one.

| Item | Value |
|---|---|
| Backfill script | `scripts/backfill-user-codes.ts` (`npm run backfill:user-codes`) |
| Index migration | `scripts/migrate-user-code-index.ts` (`npm run migrate:user-code-index`) |
| Mode | **dry-run by default**; `--apply` to write |
| Env | `MONGODB_URI` from `.env.local` (via `dotenv`) |
| Write shape | per-document `$set: { userCode }` via chunked `bulkWrite(ordered: false)`; `userCode`-keyed collisions re-rolled, any other duplicate aborts |
| Selection | `userCode` missing / empty / `null` |
| Idempotent | second run matches 0 and exits 0 |

> **Run on the host, never inside the app container** — the compose image ships
> no `tsx`, so the npm scripts cannot execute there. See §7.

---

## 1. Preflight — back up the collection

Take a dump of `users` before anything else. Keep it until verification (§5) is
recorded.

```bash
mongodump --uri "$MONGODB_URI" --collection users \
  --out ./backups/users-$(date -u +%Y%m%dT%H%M%SZ)
```

URI form (when the URI already names the database):

```bash
mongodump --host <host> --port <port> \
  --username <backup-user> --authenticationDatabase admin \
  --db <db> --collection users \
  --out ./backups/users-$(date -u +%Y%m%dT%H%M%SZ)
```

Never paste the connection string into logs or tickets. Confirm the dump
contains documents (`bsondump` or `mongorestore --dryRun` on a scratch host).

Record the preflight counts:

```js
db.users.countDocuments({ userCode: { $exists: false } });
db.users.countDocuments({ userCode: "" });
db.users.countDocuments({ userCode: null });
```

## 2. Migration sequence (plan §9.2 — index BEFORE deploy)

The numbered sequence, in order:

1. **Preflight** — `mongodump` `users`; record counts + `getIndexes()` (expect
   exactly `_id_`, `role_1_isActive_1`, `phone_1`, `email_1`); verify the dump
   restores.

2. **Create the index** — `npm run migrate:user-code-index -- --dry-run` then
   `npm run migrate:user-code-index -- --apply`. Gate: exactly **one** index
   with key pattern `{ userCode: 1 }`, `unique: true`, partial; total index
   count 5. Rollback: `db.users.dropIndex("user_code_unique")`.

3. **Deploy code** — schema + generation module + retry wrapper + creation-path
   call sites + backfill script + seed change. `required` stays `false` (plan
   S7). Gate: `getIndexes()` **unchanged** after deploy (the schema-level
   declaration is a proven no-op against the script-created index).

4. **Drain old pods** — old pods write codeless users during the deploy. Gate:
   codeless count stable across two reads 5 min apart; no doc with
   `createdAt` after deploy completion.

5. **Backfill** — dry-run then `--apply`. Gate: "would modify" == preflight
   count; residual 0 after apply.

6. **Verify invariants** (§5), then ship read surfaces in a separate deploy.

## 3. Dry-run

```bash
npm run backfill:user-codes
```

No writes happen. Read the output top to bottom:

- `Target: <host>/<db>` — **confirm this is the intended environment** before
  going further. Credentials are never printed.
- `[user-code] users missing userCode (preflight): N` — the authoritative write
  set. Missing, empty and `null` values are the three states that sit outside the
  partial unique index.
- One `[user-code] would set row=<id> code=<code>` line per affected row, batched
  (chunks of 500, cursor batch 100) with `batch N: matched X, would modify X`
  summaries and a final total.
- `Dry run complete (no changes written).`

Sanity checks: the total equals the preflight count; codes within a run are
mutually distinct; nothing is written.

## 4. Apply

```bash
npm run backfill:user-codes -- --apply
```

- Each chunk logs `batch N: matched X, modified Y` from the actual
  `bulkWrite` result, plus a final total line.
- The write is re-guarded at write time (`{ _id, $or: [...] }`), so a document
  coded by a concurrent writer between the cursor read and the write is a no-op,
  never an overwrite.
- `ordered: false` still rejects with a `MongoBulkWriteError`; only failures whose
  duplicate key names `userCode` are re-rolled with a fresh code (cap 5 attempts
  per document). Any other duplicate — `email`/`phone` — or any other error
  **aborts the run**.
- The script exits non-zero on connection errors, malformed rows, or a non-zero
  residual count after apply. **Do not proceed to verification if the exit code
  is non-zero** — investigate first.

Expected final line: `[user-code] Backfill complete.` followed by
`[user-code] residual users missing userCode: 0`.

## 5. Verification

In `mongosh` against the target database — after the backfill the residual count
for missing / empty / malformed codes must be **0**, and no duplicate may exist:

```js
db.users.countDocuments({ userCode: { $exists: false } });            // must be 0
db.users.countDocuments({ userCode: "" });                            // must be 0
db.users.countDocuments({ userCode: { $not: /^C[0-9A-HJ-NP-Z]{6}$/ } }); // must be 0
db.users.aggregate([{ $group: { _id: "$userCode", n: { $sum: 1 } } },
                    { $match: { n: { $gt: 1 } } }]);                  // must be empty
db.users.getIndexes();                                                // index present + unique
```

- The first three queries count the states that sit outside the partial index.
- The aggregate groups by `userCode` and fails if any value repeats.
- `getIndexes()` must show exactly one `user_code_unique` index that is unique
  and partial.

Idempotency check — re-run the dry-run; it must report preflight `0` and
`Already complete — nothing to do.`:

```bash
npm run backfill:user-codes
```

## 6. Rollback

Rollback restores the pre-backfill state (users hold no code again). Prefer it
only if the backfill itself misbehaved.

- Drop the index: `db.users.dropIndex("user_code_unique")`.
- `$unset` `userCode` **restricted to the logged ids** from the dry-run/apply
  output (§3):

```js
db.users.updateMany(
  {
    _id: {
      $in: [
        // ObjectId("<user id from the backfill log>"), …
      ],
    },
  },
  { $unset: { userCode: "" } },
);
```

- Then re-run the §5 queries — the residual count returns to the preflight number.

If the goal is to remove a user's code entirely, do it deliberately: a code is
immutable for life (plan §9.6), so unset only where a real offboarding/retention
decision justifies it.

Full restore from the §1 dump is the last resort:
`mongorestore --db <db> --collection users --drop <dump-dir>`.

## 7. Execution constraint — host only

**Run on the host, never inside the app container.** The compose image ships no
`tsx`, so `npm run backfill:user-codes` / `npm run migrate:user-code-index`
cannot execute there.

- Node.js + the repo's `node_modules` (`tsx`, `dotenv`, `mongoose` are already
  declared — no new dependencies).
- `.env.local` with `MONGODB_URI` pointing at the target cluster. To operate on a
  non-local database, point the variable at that cluster deliberately and
  temporarily; the scripts print `Target: <host>/<db>` at startup — read it before
  passing `--apply`.
- Network reachability from the host to the cluster (the app container's network
  is not required).

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing MONGODB_URI environment variable (checked .env.local).` | `.env.local` absent or lacks the key | add it; never commit the file |
| Exit 1 with a connection error | cluster unreachable / bad credentials | fix connectivity; error output redacts URIs |
| `Validation failed: … malformed userCode …` | corrupt row | inspect the row manually; the script refuses to write it |
| `Verification failed: N users still missing userCode` | concurrent writer or partial failure | re-run dry-run, inspect the listed rows, re-apply |
| Collision re-roll exhausted (`UserCodeExhaustedError`) | RNG degenerate / code space exhausted | investigate; the retry cap is bounded and fail-loud |
| Index verification failed (not exactly 1 `userCode` index) | duplicate key-pattern index or spec drift | drop the stray index deliberately, then re-run the migration |
| `Unknown argument(s)` | typo in flags | only `--apply`, `--dry-run`, `--help` are accepted |

## 8. Data-protection note — DSAR exports

A `userCode` is classified **Internal — non-secret pseudonymous account
identifier**: personal data (DSAR / erasure / retention apply), not confidential.
No encryption or hashing is applied (lookup requires the exact value; plan §10.5).
**Any future data subject export (DSAR) must include `userCode`** alongside email,
phone and national ID where those are exported.

---

## Appendix — command summary

```bash
# 1. Preflight backup
mongodump --uri "$MONGODB_URI" --collection users --out ./backups/users-$(date -u +%Y%m%dT%H%M%SZ)

# 2. Index (before any code that issues codes ships)
npm run migrate:user-code-index -- --dry-run
npm run migrate:user-code-index -- --apply

# 3. Backfill
npm run backfill:user-codes
npm run backfill:user-codes -- --apply

# 4. Verify (five queries in §5)
```
