# Direct Messaging: User → Caretaker (in-app)

**Status:** Proposed — awaiting confirmation
**Date:** 2026-11-19
**Branch:** `feat/universal-messaging`
**Repo:** keja-yangu

## 0. Goal (narrowed scope)

The earlier "universal messaging (any user ↔ any user)" requirement is narrowed to:

1. **Keep** the existing property-scoped chat (tenant ↔ owner/caretaker about their property).
2. **Add** a direct in-app channel where an authenticated user can message a **caretaker** directly — e.g. a prospective renter inquiring about renting — even without an existing tenancy/property relationship.

Recipient is always a caretaker. Initiator is any authenticated, active user. Property is optional context.

This reuses the `ChatThread`/`ChatMessage` infrastructure via the architect's DM model (participants + per-user reads + canonical pair key), but scopes authorization to caretaker recipients only.

## 1. Tier 1 findings (synthesized)

### code-analyst
- Chat is tenant↔agent/property-scoped; `ChatThread` has `tenantId, propertyId, ownerId, agentUserId, agentRole`; unique `{tenantId, propertyId, agentUserId}`.
- `POST /chat/threads` is tenant-only; `GET /chat/contacts` is tenant-only (owner+caretakers per property).
- `/api/v1/users/search` does exact email/phone lookup via `resolveUserByContact`; forbidden to tenants; returns `{id,name,email,role,isActive,hasVerifiedEmail}` (no phone/nationalId).
- `MESSAGE_SENDER_ROLES` lacks `admin`/`system-admin`/`broker` (latent enum bug).
- `isParticipant` duplicated in two routes; system-admin bypasses everything.
- No `ChatThread` route for single-thread GET/PATCH.
- `ChatInbox` picker gated by `canStartConversation` (tenant only); staff reply-only.

### performance-engineer
- Thread list has a **blocking in-memory sort** (no `{tenantId,lastMessageAt}` / `{propertyId,lastMessageAt}` index) — highest-value fix.
- Unread scan is unbounded (all other-side messages in page × oldest watermark) — needs server-side aggregation or per-thread counters.
- Polling amplifies: ~13–17 Mongo queries per 10s per user with an open thread; `maxPoolSize:10` saturates at ~dozens of concurrent users.
- Contacts/user search must be paginated + prefix-indexed for a universal picker; current exact-match `findOne` is fine for "have contact" (email/phone).
- No N+1 in enrichment (already batched) — good.

### devops-engineer
- No infra-heavy blockers. Feature flag (default-off env var) recommended; expand/contract migration; real deploy pipeline + e2e + observability are greenfield but not blocking.
- 6 items escalated to SolutionArchitect (polling vs realtime, retention, dynamic flags, shared rate limiter, queue/worker, index migration).

### test-engineer
- "have contact" undefined → must be resolved before tests encode policy. Resolved here as exact email/phone lookup via `/users/search`.
- Schema change breaks all existing chat tests; they must be revised, not just extended.
- Edge cases: self-message, duplicate threads, unknown/inactive recipient, authorization, pagination, unread watermarks, role variations.

## 2. Solution-architect brief (adapted to narrowed scope)

### New ChatThread shape (expand/contract, additive)
Keep legacy fields (`tenantId`, `propertyId`, `ownerId`, `agentUserId`, `agentRole`, `tenantLastReadAt`, `agentLastReadAt`) optional. Add:
- `participants: string[]` — exactly two User ids (sorted) for DMs.
- `pairKey: string` — sorted `participants.join(":")` (find all threads between two users).
- `dmKey: string` — `"dm:" + pairKey`, set only on new DMs; **unique sparse index** for dedupe.
- `reads: [{ userId, lastReadAt }]` — per-user watermark.
- `kind: "dm" | "legacy-property"` (default `"dm"`; backfilled legacy rows get `"legacy-property"`).

Indexes to add: `{ participants: 1 }`, `{ pairKey: 1 }`, `{ dmKey: 1 }` unique+sparse, `{ "reads.userId": 1 }`. Retain existing indexes until contract phase.

### Unread watermark (per-user)
- `reads[i].lastReadAt` advances on mark-read and on send (sender's own excluded by `senderUserId != actor`).
- Thread creation initializes `reads` for both to `now`.
- `countUnreadByThread` generalized to accept viewer userId + reads array; fallback to legacy fields during transition.

### Authorization (narrowed)
- Initiator: any authenticated, active user with `chat:send`.
- Recipient: any active caretaker (role `"caretaker"`) resolved by exact contact lookup. (Owner/admin/custodian/system-admin/broker recipients are **deferred** to the universal phase — only caretakers for now.)
- Self-message rejected (400).
- Inactive/soft-deleted recipient not messageable (404/403).
- `isParticipant`: `thread.participants.includes(actor.userId)` (plus legacy fallback during transition). No system-admin bypass for DMs (oversight deferred).

### API contracts
- `POST /chat/threads`: body `{ recipientUserId }` (hex24). Validate recipient is an active caretaker. Dedupe by `dmKey` (reuse existing → 200, else create → 201).
- `GET /chat/threads`: filter `{ participants: actor.userId }` for all roles.
- `GET /chat/threads/[id]/messages`: participant gate; last 100, sorted ascending.
- `POST /chat/threads/[id]/messages`: participant gate; text ≤2000; advance sender's `reads`; notify recipient (caretaker) with link `/dashboard/caretaker/communications`.
- `POST /chat/threads/[id]/read`: participant gate; advance actor's `reads`.
- `GET /users/search`: open to all authenticated active users **when no `role`/`ownerId` param** (exact email/phone only, minimal DTO, no PII, per-user rate limit 10/min). Preserve privileged link-flow behavior when params present.

### Frontend
- `StaffChatPanel` (caretaker side): stays reply-only (receives threads).
- Tenant/any user side: `ChatInbox` with `canStartConversation` enabled, picker uses `/users/search` (email/phone inputs). `use-chat` `startThread(recipientUserId)` posts `{ recipientUserId }`.
- `ChatThread` type + subtitle reworked to use `contact`/`contactRole`/`property` (property empty for DMs).

### Migration (expand → backfill → contract)
1. Expand: additive fields, relax legacy required, routes read new-or-legacy.
2. Backfill: legacy threads get `participants`, `pairKey`, `reads`, `kind="legacy-property"`, `dmKey` unset.
3. Switch: routes use participant filter; frontend cutover.
4. Contract (later): drop legacy fields/indexes.

## 3. Open decisions (need your confirmation)

| # | Decision | Recommendation | Why it's a decision |
|---|---|---|---|
| D1 | **Broker permission.** "Any user" includes brokers, but brokers currently have no `chat:read-own`/`chat:send` (and `evaluatePolicy` returns `unsupported-role`). Granting chat actions to broker is a cross-cutting permission change. | Grant `chat:read-own` and `chat:send` to broker (add to `ADMIN_ACTIONS`-equivalent broker set / `ROLE_MAXIMUM`). | Changes locked permission model. |
| D2 | **Caretaker `send_messages` privilege gate.** Currently `POST messages` requires `privileges.includes("send_messages")` in addition to `chat:send`. | Remove the extra gate; `chat:send` is the single authorization gate. | Changes locked caretaker privilege behavior. |
| D3 | **PII exposure.** Opening `/users/search` to all authenticated users (exact match only) exposes account existence by email/phone. | Proceed with exact-match only, minimal DTO, per-user rate limit, no enumeration. | Privacy policy decision. |
| D4 | **Oversight visibility.** System-admin/admin/custodian currently see threads by property/tenant scope. | Remove implicit oversight; everyone sees only their own participant threads. (Deferred `chat:manage` read-only view.) | Changes current admin capability. |
| D5 | **Property context.** Is property optional in a direct thread? | Optional (empty string for pure DMs). | Affects UI/data. |

## 4. Out of scope (deferred)
- Full universal messaging (any user ↔ any user) — only caretaker recipients now.
- Realtime (SSE/WebSocket) — keep 10s polling.
- Group chats, attachments, message edit/delete.
- Name/prefix search (enumeration risk).
- Privileged `chat:manage` oversight view.
- Retention/TTL on `ChatMessage`.

## 5. Implementation steps (when confirmed)
1. Schema expand (additive fields + indexes, relax required).
2. Backfill script (idempotent, alongside existing `backfill:*` scripts).
3. API routes (threads GET/POST, messages GET/POST, read, users/search open).
4. Frontend (ChatInbox picker, use-chat, StaffChatPanel receives threads; any user can initiate to a caretaker).
5. Tests (revise existing chat tests + new DM tests).
6. Gates: typecheck, lint, test, build.

## 6. Risks
- `MESSAGE_SENDER_ROLES` enum gap must be fixed (add all roles) before any non-tenant sends.
- `isParticipant` duplication must be unified to avoid divergence.
- Race-safe dedupe relies on unique sparse `dmKey` + duplicate-key catch.
- Migration must not lose data (messages untouched, thread `_id`s stable).
- Polling amplification remains (perf follow-up).

*No code written. Awaiting your confirmation of D1–D5 (or "proceed with recommendations").*
EOF
echo written