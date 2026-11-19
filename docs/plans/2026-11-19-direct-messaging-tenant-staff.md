# Direct Messaging: Tenant → Caretaker/Custodian/Admin (in-app)

**Status:** In progress
**Date:** 2026-11-19
**Branch:** `feat/direct-messaging-tenant-staff`
**Repo:** keja-yangu

## Goal

Extend the existing property-scoped chat so a tenant can message a caretaker, custodian, or admin directly (e.g. to inquire about renting), even when there is no existing tenancy tying them to that person. Property context becomes optional. Staff reply as today.

## Scope decisions (autonomous)

- **Initiator:** tenant only (matches existing `POST /threads` tenant gate). Non-tenant roles keep reply-only access.
- **Recipients:** active caretaker / custodian / admin (owner). Broker and system-admin recipients are out of scope (no chat permission grant; avoids cross-cutting permission change).
- **Property:** optional. If supplied, recipient must be staff of that property (owner/caretaker/custodian of it). If omitted, recipient may be any active caretaker/custodian/admin resolved by exact contact lookup.
- **Contact lookup:** tenants gain exact email/phone lookup restricted to staff roles (caretaker/custodian/admin), returning `{ id, name, role }` only (no PII). Per-user rate limit 10/min.
- **Caretaker `send_messages` privilege gate:** removed; `chat:send` is the sole gate.
- **Oversight:** system-admin/admin/custodian keep existing property/tenant-scoped thread visibility (unchanged).
- **Realtime:** keep 10s polling.
- **Schema:** no redesign needed — extend `agentRole` enum to include `custodian` (and `admin` as needed); make `propertyId` optional; keep two-sided read watermarks. (Universal DM schema deferred.)

## Implementation steps

1. Schema `ChatThread`: `agentRole` enum + `"custodian"`; `propertyId` optional; `tenantId` stays required (tenant initiator).
   `ChatMessage.senderRole` enum: add `custodian`, `admin`, `system-admin` (fix latent gap).
2. `domain-enums.ts`: `CHAT_AGENT_ROLES` + `"custodian"`; `MESSAGE_SENDER_ROLES` + missing roles.
3. `schemas/chat.ts`: `chatThreadInput` — `role: "owner"|"caretaker"|"custodian"`; `propertyId` optional.
4. `chat/contacts/route.ts`: include custodians (already in staffMap) and admins (ownerId) — already does owner+caretakers; add custodians to the list with role "custodian".
5. `chat/threads/route.ts` POST:
   - Keep tenant-only gate.
   - Validate recipient role ∈ {owner, caretaker, custodian}.
   - If propertyId given: validate tenant has that property (existing) and recipient is staff of it (owner/caretaker/custodian).
   - If no propertyId: validate recipient is an active caretaker/custodian/admin (via User lookup).
   - Validate User.role matches the role.
   - ChatThread.create with agentRole = role, propertyId (or ""), ownerId (from property or recipient's managed owner? for admin recipient use recipient id).
6. `chat/threads/[id]/messages/route.ts`: remove caretaker `send_messages` privilege gate; keep participant check; senderRole writes actor.role (enum now includes it).
7. `chat/threads/[id]/read/route.ts`: unchanged.
8. `/api/v1/users/search`: when called with `role` absent and `ownerId` absent, allow any authenticated active user with `email` or `phone`; restrict results to staff roles (caretaker/custodian/admin/system-admin) for tenant callers? Simpler: any authenticated user can look up by exact contact; return minimal `{id,name,role}` (no email/phone/nationalId) to all non-privileged callers; keep full DTO for privileged link flows. Rate limit 10/min.
   Actually simpler: add a dedicated lightweight param? Keep existing endpoint, open to tenants, return minimal fields when no role/ownerId.
9. Frontend:
   - `StaffChatPanel`: unchanged (reply-only).
   - `TenantChatPanel`: enable `canStartConversation`.
   - `ChatInbox`: picker uses `/users/search` (email/phone inputs) OR contacts. Keep contacts as fallback. Implement picker to search by email/phone and show result; select → startThread.
   - `use-chat`: `startThread(recipientId, role, propertyId?)` posts `{ recipientId, role, propertyId? }`.
   - `ChatThread` type: property optional.
10. Tests: update chat tests for new recipient roles, optional property, custodian contacts, tenant search. Keep existing passing.

## Hard constraints
- No new dependencies.
- Do NOT touch models schemas destructively (only enum additions + optional fields).
- All existing tests must still pass (update as needed, no weakening).
- Typecheck, lint, test, build green.

## Verify
- npm run typecheck, npx biome check, npm test, npm run build.

## Report
- Files changed, test counts, deviations, verification.
EOF
echo written