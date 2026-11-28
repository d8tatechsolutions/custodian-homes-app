import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  AUDIT_TYPE_GROUPS,
  type AuditEntryRow,
  type AuditNoteView,
  type AuditViewer,
  type AuditViewerRole,
  auditDetailFor,
  auditVisibilityFilter,
  toAuditEntryView,
} from "@/lib/audit-view";
import { resolveRequestContext } from "@/lib/auth-scope";
import { connectToDatabase } from "@/lib/mongoose";
import { parsePagination } from "@/lib/pagination";
import { rateLimit } from "@/lib/rate-limit";
import { AuditEvent } from "@/models/AuditEvent";
import { AuditNote } from "@/models/AuditNote";
import { Invoice } from "@/models/Invoice";
import { Lease } from "@/models/Lease";
import { Property } from "@/models/Property";
import { User } from "@/models/User";

const VIEWER_ROLES = new Set<AuditViewerRole>([
  "system-admin",
  "admin",
  "custodian",
  "caretaker",
  "tenant",
  "broker",
]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Upper bound on ids loaded to scope a tenant's view. */
const MAX_SCOPE_IDS = 2000;

async function buildViewer(request: NextRequest): Promise<AuditViewer | NextResponse> {
  const ctx = await resolveRequestContext(request);
  if (!ctx.auth || !ctx.user?.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = ctx.user.role as AuditViewerRole;
  if (!VIEWER_ROLES.has(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = String(ctx.user._id);
  const viewer: AuditViewer = { role, userId, propertyIds: [], invoiceIds: [], leaseIds: [] };

  if (role === "admin" || role === "custodian" || role === "caretaker") {
    const assigned = (await ctx.assignments())
      .map((a) => String(a.propertyId ?? ""))
      .filter(Boolean);
    let owned: string[] = [];
    if (role === "admin") {
      const rows = (await Property.find({ ownerId: userId }).select("_id").lean()) as {
        _id: unknown;
      }[];
      owned = rows.map((r) => String(r._id));
    }
    viewer.propertyIds = [...new Set([...assigned, ...owned])];
  }

  if (role === "tenant") {
    const tenantIds = (await ctx.tenantRows()).map((t) => String(t._id));
    if (tenantIds.length > 0) {
      const [invoices, leases] = await Promise.all([
        Invoice.find({ tenantId: { $in: tenantIds } })
          .select("_id")
          .limit(MAX_SCOPE_IDS)
          .lean() as Promise<{ _id: unknown }[]>,
        Lease.find({ tenantId: { $in: tenantIds } })
          .select("_id")
          .limit(MAX_SCOPE_IDS)
          .lean() as Promise<{ _id: unknown }[]>,
      ]);
      viewer.invoiceIds = invoices.map((r) => String(r._id));
      viewer.leaseIds = leases.map((r) => String(r._id));
    }
  }
  return viewer;
}

/**
 * GET /api/v1/audit — the history this user may see (see lib/audit-view for
 * the need-to-know rules). Filters: `type` (a group in AUDIT_TYPE_GROUPS),
 * `from` / `to` (YYYY-MM-DD),
 * `page`, `limit` (max 50).
 */
export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, { windowMs: 60_000, limit: 60 });
  if (limited instanceof NextResponse) return limited;

  await connectToDatabase();
  const viewer = await buildViewer(request);
  if (viewer instanceof NextResponse) return viewer;

  const params = request.nextUrl.searchParams;
  const { page, limit: requested } = parsePagination({
    page: params.get("page") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  const limit = Math.min(50, requested);

  const clauses: Record<string, unknown>[] = [auditVisibilityFilter(viewer)];
  const type = params.get("type") ?? "";
  if (type) {
    const entityTypes = Object.hasOwn(AUDIT_TYPE_GROUPS, type) ? AUDIT_TYPE_GROUPS[type] : null;
    if (!entityTypes) return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
    clauses.push({ entityType: { $in: entityTypes } });
  }
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) range.$lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000);
    if (Object.values(range).some((d) => Number.isNaN(d.getTime()))) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    clauses.push({ createdAt: range });
  }
  const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };

  const [total, rows] = await Promise.all([
    AuditEvent.countDocuments(filter),
    AuditEvent.find(filter)
      .select("-ipHash -userAgentHash -requestId")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean() as Promise<AuditEntryRow[]>,
  ]);

  const detail = auditDetailFor(viewer.role);
  const actorIds = [...new Set(rows.map((r) => r.actorUserId))].filter(
    (id) => id && id !== "system",
  );
  const propertyIds = [...new Set(rows.map((r) => r.scope?.propertyId ?? ""))].filter(Boolean);
  const eventIds = rows.map((r) => String(r._id));

  const [users, properties, notes] = await Promise.all([
    detail === "self" || actorIds.length === 0
      ? Promise.resolve([] as { _id: unknown; name?: string }[])
      : (User.find({ _id: { $in: actorIds } })
          .select("name")
          .lean() as Promise<{ _id: unknown; name?: string }[]>),
    detail === "self" || propertyIds.length === 0
      ? Promise.resolve([] as { _id: unknown; title?: string }[])
      : (Property.find({ _id: { $in: propertyIds } })
          .select("title")
          .lean() as Promise<{ _id: unknown; title?: string }[]>),
    eventIds.length === 0
      ? Promise.resolve(
          [] as {
            _id: unknown;
            auditEventId: string;
            authorName?: string;
            text: string;
            createdAt?: Date;
          }[],
        )
      : (AuditNote.find({ auditEventId: { $in: eventIds } })
          .sort({ createdAt: 1 })
          .lean() as Promise<
          {
            _id: unknown;
            auditEventId: string;
            authorName?: string;
            text: string;
            createdAt?: Date;
          }[]
        >),
  ]);

  const noteMap = new Map<string, AuditNoteView[]>();
  for (const n of notes) {
    const list = noteMap.get(n.auditEventId) ?? [];
    list.push({
      id: String(n._id),
      authorName: detail === "self" ? "Platform admin" : n.authorName || "Platform admin",
      text: n.text,
      createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : "",
    });
    noteMap.set(n.auditEventId, list);
  }
  const lookups = {
    names: new Map(users.map((u) => [String(u._id), u.name ?? ""])),
    propertyTitles: new Map(properties.map((p) => [String(p._id), p.title ?? ""])),
    notes: noteMap,
  };

  return NextResponse.json(
    {
      data: rows.map((row) => toAuditEntryView(row, viewer, lookups)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      canAddNotes: viewer.role === "system-admin",
      detail,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
