# Unified Recommendation — Unique User Code (`CXXXXXX`)

**Status:** Phase 1 complete. Awaiting Phase 2 rulings on the two open architectural questions (see §7).
**Sources:** `@code-analyst`, `@performance-engineer`, `@devops-engineer`, `@test-engineer` (all read-only).

---

## 1. Scope

Give every `User` document a permanent, unique, human-readable identifier of exactly 7 characters:
a literal `C` followed by 6 uppercase alphanumeric characters (`CXXXXXX`). It is used to:

- look up a user in support (staff-typed input),
- identify a payer/tenant in payments reconciliation,
- display on profile and admin surfaces.

**Explicitly in scope**
- `User` schema field + unique index.
- Generation on every user-creation path (6 API sites + 1 shared helper + seed script).
- Backfill for existing users.
- Read/serialization exposure on admin, self-profile, and staff-lookup endpoints.
- Search integration.
- Tests per §6.

**Explicitly out of scope (unless Phase 2 says otherwise)**
- Any new `GET /api/v1/admin/users/[id]` detail endpoint (none exists today — see §5.4).
- Resolving user codes onto invoice/tenant screens (those key on `Tenant._id`, not `User`; a join does not exist).
- Changing `autoIndex` globally.
- Adding a real-DB test harness (needs an explicit dependency decision).

---

## 2. Settled design constraints (union of Tier 1 recommendations)

| # | Constraint | Source | Rationale |
|---|---|---|---|
| S1 | Field name **`userCode`** | Orchestrix (naming is not a Tier 2 matter) | `code` is ambiguous on `User` — the model already carries `verificationToken` and will plausibly gain OTP/reset codes. `userCode` is unambiguous at every call site and in indexes. |
| S2 | Format `^C[0-9A-HJ-NP-Z]{6}$`, stored uppercase | perf | 34-symbol alphabet: `0-9A-Z` minus `I`,`O`. Keeps `0`/`1` (unambiguous once `O`/`I` are gone), 30.52 bits, only 0.52 bits below full base36 while removing the two highest-frequency read-back errors in support. |
| S3 | Normalize input with `trim().toUpperCase()` and validate **before** any DB call | perf | Protects the lookup endpoint from becoming a free scan trigger; single canonical casing avoids case-variant duplicates under a case-sensitive unique index. |
| S4 | Generation is **stateless random + bounded retry (cap 5)**, not a counter | perf, code-analyst | No `Counter` collection exists in this repo; `invoiceCounters` is a *per-user* map and the wrong shape for a global sequence. A singleton `$inc` doc would be a hot spot (~500–3,000 ops/s ceiling) and would leak signup order/user count through a displayed identifier. Expected retry rate: 0.0065% @100k, 0.065% @1M, **0.65% @10M**. |
| S5 | Uniqueness is enforced **only** by the DB index; the generator never assumes it | perf | At 34^6 the birthday threshold is ~46k users; without enforcement a 10M-user lifetime yields ~32k duplicate pairs. Duplicate = wrong account surfaced on a payment lookup. |
| S6 | Retry must key on `error.keyPattern.userCode`, and re-throw on `email`/`phone` 11000s | perf, devops | An unqualified `code === 11000` check turns an email collision into an infinite code-retry loop. |
| S7 | Field is **nullable at the schema level** (`required: false`); generation is enforced in application code | devops, perf | A hard `required: true` breaks old pods during rollout and breaks `scripts/wipe-and-reseed.ts`, which declares its **own** local user schema and never imports the app model. |
| S8 | The index **must be declared in `src/models/User.ts`** and **also** created explicitly by a migration script using `createIndex()` — never `syncIndexes()` | perf + devops (reconciled) | Declaring in the schema is required so a future `syncIndexes()` cannot silently drop it. Using `createIndex()` in the migration avoids `syncIndexes()` dropping the undeclared `phone_1` / `email_1` / `role_1_isActive_1` indexes on the live collection. |
| S9 | Codes are **immutable for life**, including after deactivation | code-analyst, test | `User` has no soft-delete/`deletedAt`. Reusing a code would silently re-point historical support/payment references at a different person. |
| S10 | No `AuditEvent` on normal assignment; audit only administrative reassignment (if ever added) | devops | `AuditEvent` is a security/privilege ledger with actor-scoped indexes; one event per registration doubles write volume on the hottest create path for no forensic value. |
| S11 | The code is **not a secret and not an auth factor** | perf | 30.5 bits is guessable at scale (0.65% hit rate per random guess at 10M). Lookup must require an authenticated staff actor and be rate-limited by actor id. |
| S12 | Logging via `console.warn("[user-code] …")`, no new logger dependency | devops | No logger library exists; the repo convention is bracketed `console` prefixes. |

---

## 2a. Product decisions (confirmed by owner)

| ID | Decision | Consequence |
|---|---|---|
| P1 | **Users can see their own code.** | `userCode` is added to `GET /api/auth/me` (drives `AuthUser`) and rendered read-only on the profile card of all four settings pages (`admin`, `tenant`, `caretaker`, `custodian`). Also added to `GET /api/v1/users/me`. |
| P2 | **Admins can see the code.** | Added to the admin user list serializer/projection and the admin PATCH serializer, with a `User Code` column in `UserRoleManager`. |
| P3 | Model execution | Free-tier models are approved for this work until credits are topped up. |
| P4 | **Lookup by code is a hard requirement.** | `userCode` must be a searchable lookup key for support/payments, not merely a displayed label. This is a product requirement; the security ruling decides *where* the lookup lives and what controls apply — not whether it exists. |

**Open (deferred to `@security-expert`):** *which* surface serves the lookup. Options: the general staff endpoint `GET /api/v1/users/search` (any authenticated staff, `{id, name, role}`, 10/min in-memory limiter), or an admin-only path, or both with different response shapes. Orchestrix default if the ruling is silent: **both**, but `users/search` returns the minimal `{id, name, role}` shape only and requires a per-actor rate limit; the fuller record stays `system-admin`-only.

**Derived consequence of P1+P2:** `userCode` must be present in both the `admin/users` list projection (`.select("name email phone role isActive createdAt")`) and `PROFILE_FIELDS`, and in the client-side row normalizers (`use-users.tsx` `normalizeUser`, `use-auth.tsx` `AuthUser`). Missing any one of these makes the field silently invisible despite being stored and returned by the API.

---

## 3. Recorded contradictions (not resolved here)

| ID | Domain | Position A | Position B | Disposition |
|---|---|---|---|---|
| **C1** | Migration ordering | `@devops-engineer`: ship nullable field + generator → create index by script → backfill. | `@performance-engineer`: create the partial unique index first (build is instant on zero matching docs) → backfill → enforce. | **Phase 2 ruling required.** Both agree the filter excludes un-backfilled docs, so both orders are *safe*; the difference is which failure mode you prefer if the run is interrupted. |
| **C2** | Field name | devops + test: `code` | perf: `userCode` | Resolved by Orchestrix → **`userCode`** (S1). Naming is excluded from Tier 2. |
| **C3** | `syncIndexes()` | devops: `createIndex()` only, never `syncIndexes()` (drops unrelated indexes). | perf: the index must be declared in the schema or a future `syncIndexes()` deletes it. | **Not a real conflict** — both are satisfied by S8 (declare in schema *and* create via `createIndex()`). |
| **C4** | Generation placement | code-analyst: repo prefers explicit helpers (`createPhoneOnlyAccount`, `nextInvoiceNumber`); `User` has **zero** hooks today. | perf: generate in `pre("validate")` so a future 7th call site cannot silently omit it. | **Phase 2 ruling required** — it determines whether 6 call sites each get a wrapper or the model owns it. |
| **C5** | Index filter shape | perf + code-analyst: `partialFilterExpression: { userCode: { $gt: "" } }`, consistent with `User.phone`. | Orchestrix observation: MongoDB does not generally use a partial index for a bare `$eq` lookup whose predicate does not syntactically imply the filter — which would make the primary lookup a **COLLSCAN**. `sparse: true` is used for equality, but only if the field is genuinely *absent* (no `""` default). | **Phase 2 ruling required — highest-risk item in the feature.** |
| **C6** | Test depth | test-engineer: no real DB harness exists; true `E11000` and true concurrency are unprovable. | perf/devops assume a real unique index protects production. | Accepted as a **known coverage gap**; mitigation in §6.4. Adding `mongodb-memory-server` is a separate decision, not bundled. |

---

## 4. Risk flags

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | A plain `{ unique: true }` index **fails to build** on `users` (every missing field is `null`, `null` collides with `null`). Migration outage. | **Critical** | S7/S8 + partial-or-sparse filter (C5). |
| R2 | `autoIndex` is implicitly `true` (Mongoose default, never configured). Any `schema.index()` builds at pod startup / Vercel cold start at a moment you do not control; a failed build leaves **no uniqueness guarantee** and only logs. | **High** | Explicit migration script; verify `getIndexes()` post-deploy; residual + duplicate checks in the runbook. |
| R3 | `syncIndexes()` in a naive migration script drops `phone_1`, `email_1`, `role_1_isActive_1` on the live collection. | **Critical if done naively** | S8 — `createIndex()` only. |
| R4 | `scripts/wipe-and-reseed.ts` has a local schema and 5 `User.create` calls with no code → breaks on a non-partial unique index, or seeds codeless users. | **High** | In scope: add `userCode` to the local schema and generate deterministically for seeded users. |
| R5 | A missed creation path yields a codeless user, discoverable only by a DB query. | **High** | Hook-based generation (if C4 rules for it) + post-deploy check for users created after the deploy timestamp with no code. |
| R6 | `userCode` appended to the existing admin search `$or` makes a **4th unanchored regex over a COLLSCAN** (currently already 2× full scan per request due to `countDocuments`). | **High** | Branch: code-shaped input takes an exact-match indexed path; text input keeps the existing path. |
| R7 | No metrics stack; generation problems are invisible until duplicates appear. | Medium | Log collision retries; runbook invariant queries (§5.6). |
| R8 | `select("-passwordHash")` returns the whole document on every authenticated request (`auth-scope.ts:96`, `auth/me`). `userCode` adds ~17 B (~2%) — negligible, but the pattern is a pre-existing scaling issue. | Low (for this feature) | Out of scope; noted for a separate change. |
| R9 | Code is enumerable (30.5 bits) and must never be an auth factor. | Medium | S11; security review in Phase 2. |

---

## 5. Delivery & ops requirements

### 5.1 Schema
- `userCode?: string` on `IUser`, `required: false`, `trim`, `uppercase: true`, no `default`.
- Index declared on the schema alongside the existing three, named explicitly (e.g. `user_code_unique`) so rollback `dropIndex` is unambiguous.
- Exact filter shape is **deferred to Phase 2 (C5)**.

### 5.2 Generation module
- New `src/lib/user-code.ts`: exported `USER_CODE_ALPHABET`, `USER_CODE_LENGTH = 6`, `USER_CODE_PREFIX = "C"`, `USER_CODE_PATTERN`, `generateUserCode()`, `normalizeUserCode()`, `isUserCode()`, and a typed `UserCodeExhaustedError`.
- RNG must be **injectable** (`generateUserCode({ random?: (max: number) => number })`) so seeded determinism is testable — `crypto.randomInt` is not seedable.
- Use `crypto.randomInt` (or rejection sampling), not `randomBytes % 34` (modulo bias) and not `Math.random`.

### 5.3 Creation paths that must produce a code
1. `src/app/api/auth/route.ts:250` (public signup) — plus audit the adopt/save path at `:204-217`.
2. `src/lib/user-identity.ts:120` (`createPhoneOnlyAccount` — covers admin, tenant, caretaker, custodian phone-only creation).
3. `src/app/api/v1/admin/users/route.ts:232` (email invite).
4. `src/app/api/v1/caretakers/route.ts:330`.
5. `src/app/api/v1/custodians/route.ts:323`.
6. `src/app/api/v1/tenants/route.ts:374`.
7. `scripts/wipe-and-reseed.ts:171,180,190,200,223`.

### 5.4 Read/serialization surfaces
- `admin/users/route.ts` — `UserListDoc`, `serialize()`, `select(...)`, search branch.
- `admin/users/[id]/route.ts` — `UserDoc`, `serialize()`, `select(...)` (PATCH-only; **no GET exists**).
- `admin/users/[id]/role/route.ts` — `serialize()`.
- `auth/me/route.ts` — add to the hand-built response (drives `AuthUser`).
- `users/me/route.ts` — `PROFILE_FIELDS` + `serialize()`.
- `users/search/route.ts` — third exact-match key alongside `email`/`phone` (**privacy decision pending, Phase 2**).
- `caretakers`, `custodians`, `caretakers/[id]/privileges`, `custodians/[id]` — add to select + serializer.
- `chat/contacts` — only if participants must show a code (Phase 2 / product).
- Client contracts: `use-users.tsx` (`UserRow` + `normalizeUser`), `use-auth.tsx` (`AuthUser`), `UserRoleManager.tsx` table + client filter, profile cards on 4 settings pages.

### 5.5 Backfill
- `scripts/backfill-user-codes.ts`, copying `scripts/backfill-task-permissions.ts` (newest convention):
  `dotenv.config({ path: ".env.local" })` → URI check → raw `mongoose.connect` (same options as `src/lib/mongoose.ts`) → local schema with `{ collection: "users" }` → dry-run default / `--apply` / `--help`, unknown args hard error → `BATCH_SIZE = 100` cursor → `bulkWrite(ordered: false)` beyond ~100k docs → per-op `E11000` on `userCode` re-rolled in a second pass → preflight + residual `countDocuments` verification → `await mongoose.disconnect()` on every path.
- Filter must match **missing and empty and null**: `$or: [{ userCode: { $exists: false } }, { userCode: "" }, { userCode: null }]`.
- Idempotent: second run matches 0 and prints a no-op.
- Idempotent + write-guarded: `updateOne({ _id, userCode: { $exists: false } }, { $set: { userCode } })` so a concurrent writer cannot be clobbered.
- Registered as `"backfill:user-codes": "tsx scripts/backfill-user-codes.ts"`.
- Runbook `docs/runbooks/backfill-user-codes.md` modelled on `backfill-task-permissions.md`: dump preflight, dry-run reading guide, apply, verification queries, rollback restricted to logged ids, host-only note.

### 5.6 Verification invariants (runbook)
```js
db.users.countDocuments({ userCode: { $exists: false } })            // must be 0
db.users.countDocuments({ userCode: "" })                            // must be 0
db.users.countDocuments({ userCode: { $not: /^C[0-9A-HJ-NP-Z]{6}$/ } }) // must be 0
db.users.aggregate([{ $group: { _id: "$userCode", n: { $sum: 1 } } },
                    { $match: { n: { $gt: 1 } } }])                  // must be empty
db.users.getIndexes()                                                // index present + unique
```

### 5.7 CI gates
`./node_modules/.bin/biome check .` → `npm run typecheck` → `npm run build` → `npm run test:coverage`, plus the separate `npm run test` job. `scripts/` **are** typechecked (`tsconfig.include`); tests under `scripts/` are **never** executed (`vitest.include` is `src/**`). No DB is available in CI.

---

## 6. Test strategy

### 6.1 New files
- `src/lib/user-code.test.ts` — generator + retry (G1–G10, U1–U7).
- `src/lib/user-code-backfill.test.ts` — pure planner (B1–B7), mirroring `block-backfill.test.ts`.
- `src/app/api/auth/me/route.test.ts` — none exists today (A9–A12).

### 6.2 Extended files
- `src/models/User.test.ts` — path + index assertions (M1–M6).
- `src/app/api/v1/admin/users/route.test.ts` — search branch + projection (A1–A8).
- `src/app/api/v1/admin/users/[id]/route.test.ts` — serializer + immutability (A13–A14, I1–I2).
- `src/app/api/v1/users/me/route.test.ts` — only if self-profile exposes the code.
- `src/test/utils/factories.ts` — add **optional** `userCode` to `TestUser`/`makeUser` (required would break 409 call sites).

### 6.3 Must-not-break
- `src/app/api/v1/users/search/route.test.ts:95-97` — **exact** `toEqual` on the minimal lookup payload; breaks the moment `userCode` is added there.
- `src/app/api/v1/users/me/route.test.ts:146` — exact `$set`; safe only if profile PATCH never writes `userCode`.
- `src/components/account/AccountDetailsForm.test.tsx:7` — full `AuthUser` literal; requires the field be optional.
- Zero snapshots exist, so no snapshot churn.

### 6.4 Accepted coverage gap
The suite has **no real database**. True `E11000` rejection and true concurrent-create behaviour cannot be asserted. Coverage instead comes from:
1. asserting the **declared index definition** via `User.schema.indexes()` (this is the constraint that actually protects production),
2. simulating the driver error: `Object.assign(new Error("E11000"), { code: 11000, keyPattern: { userCode: 1 } })` and asserting the retry/cap/re-throw behaviour,
3. a **pure planner** for the backfill (plan → writes), which is exactly how `block-backfill.ts` is tested.

Adding `mongodb-memory-server` is a **separate, explicit decision** — not part of this change.

---

## 7. Phase 2 — escalation (required before Phase 3)

Two distinct triggers fire; they will be invoked **sequentially, one at a time**, per protocol.

### 7.1 `@database-architect` — BLOCKING
Triggers: schema change on a live collection, new unique index strategy, migration with irreversible consequences.
Ruling required on:
1. **C5 — index filter shape.** `partialFilterExpression: { userCode: { $gt: "" } }` (repo-consistent with `phone`) vs `sparse: true` (used for equality). Does the primary `findOne({ userCode })` use the index in each case? If partial, does an `$eq` lookup require an explicit predicate rewrite to hit the index?
2. **C1 — migration ordering** and the exact runbook sequence.
3. **C4 — hook vs explicit call sites**, given `User` currently has zero hooks and `wipe-and-reseed.ts` uses a local schema.
4. Whether `default: ""` or no default, and the resulting backfill filter.
5. Whether the named index and `createIndex()`-only migration are correct, and whether `autoIndex` needs any change for *this* index.

### 7.2 `@security-expert` — after 7.1
Triggers: data classification + a lookup surface that resolves an identifier to PII.
Ruling required on:
1. May `userCode` appear in `GET /api/v1/users/search` (currently `{id, name, role}`)? This changes the privacy surface and breaks an exact-equality test.
2. Rate-limiting and authorization requirements for code-based lookup (per-actor, not per-IP).
3. Whether code assignment/reassignment needs an `AuditEvent`, and what `action` string.
4. ~~Whether exposing the code to the user themselves is acceptable.~~ **Resolved by owner (P1): yes, users see their own code.** Security review should confirm this carries no risk beyond the user already knowing their own identity.
5. Confirmation that the code must never be an authentication factor or appear in a public/unauthenticated route.

---

## 9. Phase 2 rulings (authoritative)

`@database-architect` verified every claim against a live `mongod` **8.0.26** + Mongoose **9.9.5** on 20,000-document collections (half without the field). These rulings supersede any conflicting Phase 1 text above.

### 9.0 Corrections to Phase 1 (do not inherit the wrong versions)

| Phase 1 claim | Reality (measured) |
|---|---|
| C5: bare `$eq` on a `{$gt:""}` partial index will COLLSCAN | **False on 8.0** — plans `EXPRESS_IXSCAN`, `keysExamined: 1`. |
| S8: existing migrations use `createIndex()` | **False** — both use `syncIndexes()` (`migrate-unit-preference-indexes.ts:90`, `migrate-soft-delete-indexes.ts:157`). |
| §5.5: `backfill-task-permissions.ts` writes per-doc | **False** — it is per-batch `updateMany` (`:224-227`). |

### 9.1 Index spec — final

```js
{ userCode: 1 },
{ unique: true, name: "user_code_unique",
  partialFilterExpression: { userCode: { $gt: "" } } }
```

- **No `default` on the field.** With `sparse`, `default: ""` is a guaranteed outage (proven: 2nd `""` → E11000). With partial it creates two definitions of "unassigned" and pollutes every `new User()`.
- **Lookups use one exported helper**: `userCodeLookupFilter(code) → { userCode: { $eq: code, $gt: "" } }`.
  **Verified on 7.0.48 and 8.0.26**: a bare `$eq` already plans at 1 key (`FETCH → IXSCAN` on 7.0, `EXPRESS_IXSCAN` on 8.0), so the explicit `$gt: ""` is **not** a performance requirement and **not** a correctness requirement on those versions. Keep it for three reasons only: (i) 6.0 is unverified and it costs nothing; (ii) single idiom — `phone` at `User.ts:99` already needs it for its partial index, and two divergent lookup filters in one codebase is worse than one uniformly explicit filter; (iii) proven zero cost (identical bounds, identical result set).
  **Do not describe this as mandatory for performance.** The risk it mitigates is small.
- Both versions correctly **refuse** the index for `{ userCode: "" }` and `{ userCode: { $exists: false } }` — which is the property that makes the partial filter safe.
- **Never `hint()`.**
- `{ userCode: { $type: "string" } }` as a partial filter is **unusable** — bare `$eq` plans a COLLSCAN.
- Mongoose applies `trim`/`uppercase` setters to **query filters**; the raw driver does not. App-level normalisation (S3) stays mandatory.
- Trade accepted: missing field is a *silent gap* (caught by hook + runbook invariants) rather than a *loud outage*. Correct for a new field on a live collection during a rolling deploy.

### 9.2 Migration order — index BEFORE deploy

`autoIndex` is implicitly true and **fire-and-forget** (`model.js:5232` → `Model.init().catch(() => {})`), so deploying the model change *is itself* an index-build event. The index must therefore exist before the code that issues codes ships.

1. **Preflight** — `mongodump` `users`; record counts + `getIndexes()` (expect exactly `_id_`, `role_1_isActive_1`, `phone_1`, `email_1`); verify the dump restores.
2. **Create the index** — `npm run migrate:user-code-index -- --dry-run` then `--apply`. Gate: exactly **one** index with key pattern `{userCode:1}`, `unique:true`, `isPartial:true`; total index count 5. Rollback: `dropIndex("user_code_unique")` (nothing depends on it yet).
3. **Deploy code** — schema + hook + retry wrapper + 6 call sites + backfill script + seed change. `required` stays false. Gate: `getIndexes()` **unchanged** (autoIndex `createIndex` is a proven no-op).
4. **Drain old pods** — old pods write codeless users. Gate: codeless count stable across two reads 5 min apart; no doc with `createdAt` after deploy completion.
5. **Backfill** — dry-run then `--apply`. Gate: "would modify" == preflight count; residual 0.
6. **Verify invariants** (§5.6), then ship read surfaces in a separate deploy.

### 9.3 Generation placement — BOTH, with hard division

| Concern | Owner |
|---|---|
| Produce a valid code | `src/lib/user-code.ts` — pure, `node:crypto` only, **no `@/` imports** (so `wipe-and-reseed.ts` can import it) |
| Bounded retry (cap 5) + collision logging | `withUserCodeRetry(attempt)` — model-free higher-order function in the same module |
| Backstop on an unremembered creation path | `pre("validate")` hook |
| The 6 in-app sites | `withUserCodeRetry((code) => User.create({ ...data, userCode: code }))` |
| `wipe-and-reseed.ts` | hard-coded valid literals (hook is invisible there) |

Hook contract — exactly this, no more:
- assign only when `this.isNew && this.userCode == null`;
- never override an explicitly supplied candidate (the retry loop's code must win);
- **do not** assign on non-new documents (protects the adopt path `auth/route.ts:204-217` from a new E11000 on a field the caller never touched);
- guard `this instanceof mongoose.Query` (update validators fire with `this` = Query);
- use `pre("validate")`, **not** `pre("save")` — `insertMany` runs validate hooks, not save hooks;
- **throw** if `!this.isNew && this.isModified("userCode")` → this is the immutability guard (§9.6).

Verified: the collision surfaces as `MongoServerError` with `code: 11000` and `keyPattern: { userCode: 1 }`, and `keyPattern` is absent for email duplicates — so S6's discriminator works.

### 9.4 Index creation mechanism

- Declare in `src/models/User.ts` **with the explicit `name`** — so a future `syncIndexes()` cannot drop it.
- Create via `db.collection.createIndex(<exact spec>)` in `scripts/migrate-user-code-index.ts`.
- **Never `syncIndexes()` on `users`** — proven `toDrop: ["role_1_isActive_1","phone_1","email_1"]`.
- **Never `User.createIndexes()`** — it re-issues all four and throws code 86 on any drift.
- **Named index is mandatory**: same key pattern with a different name creates a **second** index silently (doubled write cost on the hottest path, no error anywhere).
- **Leave `autoIndex` alone.** Schema-level `autoIndex:false` would also stop the other three indexes; global change is out of scope and belongs to `@principal-architect`.

### 9.5 Backfill write strategy

Cursor (batch 100) → chunked `bulkWrite(ordered: false)` (500 per chunk).

- Deviating from `backfill-task-permissions.ts`'s `updateMany` is **required**: every document needs a *different* value.
- **`ordered:false` still rejects** with `MongoBulkWriteError` carrying `writeErrors[].index` and a partial `result`. The script **must** `try/catch`, map `writeErrors[].index` back to that chunk's candidates, and re-roll only those (assert `error.code === 11000 && error.keyPattern?.userCode`; an `email`/`phone` duplicate must **abort**, not re-roll).
- Cursor filter: `{ $or: [ { userCode: { $exists: false } }, { userCode: "" }, { userCode: null } ] }`
- Write guard: `{ _id: <id>, $or: [ { userCode: { $exists: false } }, { userCode: "" }, { userCode: null } ] }` — proven to use the `_id` index (keys=1) and to be a true no-op on already-coded docs.
- The **lookup** filter wants docs *inside* the partial index; the **backfill** filter wants docs *outside* it. Two predicates, both intentional — do not unify.
- Second run: preflight 0, exit without writing.

### 9.6 Immutability

**No `immutable: true`.** Measured: `updateOne` and `doc.save()` both **silently write nothing** on an immutable path, and `$setOnInsert` bypasses it anyway — the worst failure mode for a future repair script. Enforce S9 with the loud hook guard in §9.3 instead.

### 9.7 Must verify in staging

1. `explain("executionStats")` on the production server version — must be `IXSCAN`/`EXPRESS_IXSCAN`, `keysExamined: 1`. **Verified on 7.0.48 and 8.0.26 (both use the index for a bare `$eq`); 6.0 untested.** This is now a confirmation step, not a gate that could overturn the design.
2. Exactly **one** index with key pattern `{userCode:1}` after deploy.
3. Compare `User.schema.indexes()` against `getIndexes()` (code-86 drift only logs).
4. Time the `createIndex` build; watch read latency at build start/end.
5. **Exercise the bulkWrite rejection path** with an injected RNG collision — an unexercised catch block is the most likely defect here.
6. Re-run `wipe-and-reseed.ts` against a scratch DB — five users, all valid unique codes.
7. Create a user through **each of the 6 paths** and assert `^C[0-9A-HJ-NP-Z]{6}$` (the hook masks a missed wrapper).
8. Confirm the code-shaped search branch is an exact indexed `$eq` and that `countDocuments` does not reintroduce a scan.
9. Rehearse rollback: `dropIndex` + previous image on a restored dump.

---

## 10. Phase 2b — security ruling (authoritative)

Verified against code, not assumptions. Key facts that change the design:

- **`admin` is a landlord/portfolio owner, not platform staff** (`permissions.ts:25`; `users/search/route.ts:70-89`). There is **no `support` role**. Therefore code lookup cannot be granted to `admin` — that would give every competing landlord an oracle over the entire user base.
- `users/search` returns a **different shape** when `role` or `ownerId` is supplied (`:39`, `:137-168`) — adding `code` there would let `?code=…&role=…` return email/`isActive`/`hasVerifiedEmail`. **Build blocker.**
- The existing minimal path filters on the **target's** role (`:119-122`), so `code` there would let a **tenant** enumerate staff. **Build blocker.**
- `rate-limit.ts:33` is **fail-open**: `x-forwarded-for ?? crypto.randomUUID()` means a missing header gets a fresh bucket → limit disabled. Unacceptable as the only brute-force control.
- `AuditEvent` **does** have `{action, createdAt}` and `{entityType, entityId, createdAt}` indexes — the "no entity index" claim was wrong.

### 10.1 Lookup surfaces

| Surface | Audience | Shape | Code key |
|---|---|---|---|
| **NEW** `GET /api/v1/users/lookup?code=` | `USER_CODE_LOOKUP_ROLES` allowlist — **today `["system-admin"]` only** | `{ id, name, role, isActive, userCode }` | ✅ only non-admin code entry point |
| `GET /api/v1/admin/users?search=` | `system-admin` | existing record + `userCode` | ✅ exact `$eq` branch |
| `GET /api/v1/users/search?email=\|phone=` | any active user | unchanged | ❌ **forbidden** |

- Lookup gate: re-read actor from DB, check `isActive` + `tokenVersion` (pattern `_guard.ts:27-33`), then role allowlist. Never the JWT claim alone.
- Malformed code → **400 before any DB call**. Well-formed miss → uniform empty result. No fall-through to the regex branch.
- `admin/users` GET gains a per-actor rate limit (currently **none** — pre-existing MEDIUM finding).
- Projection stays an allowlist: append `userCode` only. Never `nationalId`, `passwordHash`, `verificationToken*`.

### 10.2 Rate limiting (lookup)
Key `user-code-lookup:${actor.userId}`, resolved **before** the limiter. 10/min + 100/day. **No `?? randomUUID()` fail-open.** Miss-rate alerting (>10 misses/hour per actor, or >20% platform miss rate) is the real scraping control — legitimate callers hold the code and do not miss. In-memory store acceptable only while single-replica; record as an operational constraint.

### 10.3 Audit
- **No** `AuditEvent` on assignment, collision retry, or backfill.
- `user.code_lookup` on **hit only**, support surface only: `entityType: "user"`, `entityId` = target, `after: { userCode, surface }`.
- `user.code_reassigned` — CLI only, audit-**before**-mutate.
- Misses → `console.warn("[user-code] lookup miss", { actorUserId, code })`; never co-log `name`/`email`/`phone` on the same line.
- Test that `redactAuditValue` does **not** blank `userCode`.

### 10.4 Enumeration floor
`isUserCode()` all-or-nothing; **no regex/prefix/substring/`$text` on `userCode` anywhere** (perf's "prefix search" option is **vetoed**). One code per request, no `codes[]`. No `X-RateLimit-Remaining` on the lookup. No code in navigable URLs/`<Link>`/redirects/emails (API query param is fine). No code in any bulk export. UI renders plain text — no mask/reveal, no "keep secret" copy.

### 10.5 Classification
`Internal — non-secret pseudonymous account identifier`. Personal data (DSAR/erasure/retention apply), **not confidential**. **No encryption, no hashing** — both destroy exact lookup and violate `crypto.ts:6-9`'s stated non-deterministic invariant. No TTL. Support runbook must state: **a code is not proof of identity.**

### 10.6 Auth boundary
JWT payload unchanged (`auth/route.ts:79-89`) — test asserts exact key set. `authenticate()` never branches on `userCode`. Absent from all 14 public serializers (esp. `marketplace/listings`, service-fees).

### 10.7 Immutability — gap closed
`@database-architect`'s hook guard **does not cover `updateOne`/`updateMany`/`findOneAndUpdate`**. Required in addition:
1. **Query middleware guard** on those three ops that throws if `getUpdate()` touches `userCode`.
2. Tests that `profileUpdate` / `statusChangeInput` cannot produce a `userCode` `$set`.
3. No `$unset` path anywhere.
4. Reassignment is **CLI only** (`grant-system-admin.ts` pattern): dry-run default, `--apply`, two-person `--operator-email`, mandatory `--reason`, audit-first. No HTTP route may accept `userCode`.
5. Retired-code ban list **rejected** (reuse probability 6.5×10⁻¹⁰/draw) — recorded as accepted risk.

### 10.8 Build blockers (verbatim)
1. `code` added to `users/search`.
2. `userCode` in JWT or read by `authenticate()`.
3. Lookup's only limiter is the per-IP fail-open `rateLimit()`.
4. Any regex/prefix/substring path over `userCode`, including malformed-input fall-through.
5. Any HTTP route can write `userCode`.
6. Code in a navigable URL, redirect, email link, or bulk export.
7. Code in a public/unauthenticated serializer.
8. Code encrypted or hashed at rest.
9. Code lookup granted to `admin`/`caretaker`/`custodian`/`broker` instead of the allowlist.
10. Code presented as a secret or as proof of identity.

### 10.9 Scope narrowing — owner attention
P2 ("admins see the code") is satisfied by the **system-admin-gated** management UI. It does **not** grant landlords (role `admin`) code lookup — that is build blocker #9. If landlords must resolve tenant codes, that requires a `support` role or an explicit capability, with its own review. Proceeding with the conservative default.

---

## 11. Phase 3 routing (final)

| Work package | Agent | Notes |
|---|---|---|
| `src/lib/user-code.ts` + tests, `src/models/User.ts` schema/index, generation wiring across 6 call sites + `createPhoneOnlyHelper` | `@developer-prime` | Multi-file, cross-cutting, correctness-critical |
| Backfill planner + script + runbook + `wipe-and-reseed.ts` update | `@developer-prime` | Multi-file, irreversible operations |
| Serializer/select updates across ~10 route files + client hooks | `@developer-fast` | Repetitive, scoped per file — can run in parallel after the model lands |
| UI display (admin table column, profile card) | `@developer-prime` | Frontend |
| Test suite per §6 | `@developer-prime` | Depends on final module names from Phase 2 |
