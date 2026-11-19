export interface ParticipantThread {
  kind?: string;
  participants?: string[];
  tenantId?: string;
  propertyId?: string;
  ownerId?: string;
  agentUserId?: string;
}

export interface ParticipantActor {
  userId: string;
  role: string;
  tenantIds?: string[];
  propertyScopeIds?: string[];
  assignedTenantIds?: string[];
  assignedPropertyIds?: string[];
}

/**
 * DM threads are participant-only (no implicit admin/system-admin oversight).
 * Legacy property threads keep their previous scope checks even after the
 * backfill stamps them with participants, so existing visibility is unchanged.
 */
export function isParticipant(thread: ParticipantThread, actor: ParticipantActor): boolean {
  if (
    thread.kind === "dm" ||
    (thread.kind !== "legacy-property" && (thread.participants?.length ?? 0) > 0)
  ) {
    return (thread.participants ?? []).includes(actor.userId);
  }
  return isLegacyParticipant(thread, actor);
}

function isLegacyParticipant(thread: ParticipantThread, actor: ParticipantActor): boolean {
  if (actor.role === "system-admin") return true;
  if (actor.role === "admin") {
    return (
      (actor.assignedPropertyIds ?? []).includes(thread.propertyId ?? "") ||
      (actor.assignedTenantIds ?? []).includes(thread.tenantId ?? "")
    );
  }
  if (actor.role === "tenant") return (actor.tenantIds ?? []).includes(thread.tenantId ?? "");
  if (actor.role === "custodian") {
    return (
      (actor.propertyScopeIds ?? []).includes(thread.propertyId ?? "") ||
      (actor.assignedTenantIds ?? []).includes(thread.tenantId ?? "")
    );
  }
  return thread.agentUserId === actor.userId;
}

/** A pending DM thread must never accept messages. Legacy threads are active. */
export function isThreadActive(thread: { status?: string }): boolean {
  return thread.status !== "pending";
}

/**
 * DM threads are found by participant; threads without participants (legacy or
 * pre-backfill) keep the old role-based scoping. Staff with no scope still see
 * their DMs, so an empty legacy scope never short-circuits the whole query.
 */
export function buildThreadFilter(actor: ParticipantActor): Record<string, unknown> {
  const legacyClauses: Record<string, unknown>[] = [];
  if (actor.role === "tenant") {
    legacyClauses.push({ tenantId: { $in: actor.tenantIds ?? [] } });
  } else if (actor.role === "caretaker") {
    legacyClauses.push({ agentUserId: actor.userId });
  } else if (actor.role === "custodian" || actor.role === "admin") {
    if ((actor.propertyScopeIds ?? []).length > 0) {
      legacyClauses.push({ propertyId: { $in: actor.propertyScopeIds } });
    }
    if ((actor.assignedTenantIds ?? []).length > 0) {
      legacyClauses.push({ tenantId: { $in: actor.assignedTenantIds } });
    }
    if (legacyClauses.length === 0) legacyClauses.push({ _id: { $in: [] } });
  }

  const legacy =
    legacyClauses.length === 0
      ? {}
      : legacyClauses.length === 1
        ? legacyClauses[0]
        : { $or: legacyClauses };
  return {
    $or: [{ participants: actor.userId }, { participants: { $exists: false }, ...legacy }],
  };
}
