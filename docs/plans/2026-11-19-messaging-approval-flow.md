# Messaging Approval Flow — Any User ↔ Any User (with cross-property approval)

**Status:** In progress
**Date:** 2026-11-19
**Branch:** `feat/messaging-approval-flow`
**Repo:** keja-yangu

## Goal

Any authenticated active user can message any other user. If the two users share a property (in-property), a thread opens immediately with no approval. If they do not share a property (cross-property), the recipient must approve the request before either party can send messages.

## Design decisions (autonomous)

1. **Approval state lives in a new `ChatRequest` collection** (mirroring MoveRequest/Application pattern), not on ChatThread. Thread is created only on approval (or immediately for in-property). Status: `pending | approved | declined | cancelled`.
2. **Universal initiator**: any active user with `chat:send`. Grant `chat:read-own`/`chat:send`/`chat:manage` to broker (new `broker` AccessRole with just chat actions) so "all valid roles" holds.
3. **Shared property = in-property** if requester and recipient both belong to the same property (via Tenant rows, ManagementAssignment, or admin ownership). Otherwise cross-property → approval required.
4. **Canonical pair key** (`sortedA:B`) for DM identity and dedupe. Unique sparse index on `dmKey` for approved threads. Pending requests dedupe via partial unique index `{requesterId, recipientId, status: "pending"}`.
5. **Per-user read watermarks** on threads (`reads: [{userId, lastReadAt}]`) instead of binary tenant/agent watermarks. Generalize `countUnreadByThread`.
6. **In-property threads** keep `propertyId`/`tenantId`/`agentRole` for display; cross-property DMs have empty propertyId and kind "dm".
7. **Notifications**: new types `chat:request` and `chat:request-decided`, with `dedupeKey` including status to avoid collapse. Role-aware links.
8. **Oversight**: system-admin/admin lose implicit thread visibility for DMs (participant-only). Deferred `chat:manage` oversight view.
9. **Caretaker `send_messages` gate removed** (chat:send is sole gate).
10. **Realtime deferred** (keep 10s polling).
11. **Terminal states**: pending → approved | declined | cancelled (requester cancels). No expired state for MVP.

## Implementation phases

### Phase 1 — Schema + state machine + API (this pass)
- `ChatRequest` model + indexes.
- `ChatThread` migration to participants/reads/dmKey/kind (additive, expand/contract).
- Pure state machine + eligibility helper in `src/lib/chat/approval.ts`.
- New routes: `POST /chat/requests`, `GET /chat/requests` (pending inbox), `POST /chat/requests/[id]/approve`, `POST /chat/requests/[id]/decline`, `POST /chat/requests/[id]/cancel`.
- Modify `POST /chat/threads` to handle in-property (immediate) vs cross-property (create request, return pending).
- Modify threads list/messages/read to use participant-based auth + per-user reads.
- Update `MESSAGE_SENDER_ROLES` (already done), `CHAT_AGENT_ROLES` (add all roles? keep agent roles).
- Grant chat actions to broker (new AccessRole "broker" with chat actions).
- Backfill script for existing threads.
- Notification types + helpers.

### Phase 2 — Frontend + tests (next)
- ChatInbox: pending requests tab, approve/decline UI, universal picker, status badges.
- use-chat hooks for requests.
- Tests + gates.

## Out of scope
- Group chats, attachments, edit/delete, name/prefix search, realtime, retention/TTL beyond notification 90d, privileged oversight view.

## Risks
- Migration must not lose data (thread _ids stable, messages untouched).
- Authorization breadth: broker permission change, system-admin bypass removal.
- `isParticipant` unification before new branches.
- Dedupe race safety via unique sparse indexes.
- Polling amplification (mitigate with conditional polling later).
EOF
echo written