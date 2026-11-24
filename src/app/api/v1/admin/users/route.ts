import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { escapeRegex, requireRoleManagementActor } from "@/app/api/v1/admin/users/_guard";
import { writeAuditEvent } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/email";
import { connectToDatabase } from "@/lib/mongoose";
import { buildPaginationResult, parsePagination } from "@/lib/pagination";
import type { Role } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { ASSIGNABLE_ROLES, isUserRole } from "@/lib/role-management";
import { isUserCode, userCodeLookupFilter, withUserCodeRetry } from "@/lib/user-code";
import { createPhoneOnlyAccount, resolveUserByContact } from "@/lib/user-identity";
import { User } from "@/models/User";

export const dynamic = "force-dynamic";

const INVITE_EMAIL_WARNING =
  "Account created, but the invitation email could not be sent. Contact support.";

interface UserListDoc {
  _id: unknown;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  isActive?: boolean;
  userCode?: string;
  createdAt?: Date;
}

function serialize(user: UserListDoc) {
  return {
    id: String(user._id),
    name: user.name ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    role: user.role ?? "",
    isActive: user.isActive !== false,
    userCode: user.userCode ?? "",
    createdAt: user.createdAt ?? null,
  };
}

/** Paginated, filterable list of platform users. System-admin only. */
export async function GET(request: NextRequest) {
  const actor = await requireRoleManagementActor(request);
  if (actor instanceof NextResponse) return actor;

  const rateLimited = await rateLimit(request, {
    windowMs: 60_000,
    limit: 60,
    key: `admin-users-list:${actor.userId}`,
  });
  if (rateLimited instanceof NextResponse) return rateLimited;

  const { page, limit } = parsePagination({
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });

  const params = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = {};

  const role = params.get("role")?.trim();
  if (role && isUserRole(role)) filter.role = role;

  const active = params.get("active")?.trim();
  if (active === "true" || active === "false") filter.isActive = active === "true";

  const search = (params.get("search") ?? params.get("q") ?? "").trim().slice(0, 100);
  // A code-shaped term is an exact, indexed `$eq` — it never joins the text
  // `$or`, and `userCode` is never given a regex/prefix predicate. Anything
  // else (including a legitimate multi-word name such as "Chandra Mwangi")
  // keeps the existing name/email/phone scan; a non-code term is not an error.
  const isCodeSearch = Boolean(search) && isUserCode(search);
  if (isCodeSearch) {
    // `userCodeLookupFilter` returns the full top-level filter shape, so unwrap
    // the field condition before assigning it onto the query filter.
    filter.userCode = userCodeLookupFilter(search).userCode;
  } else if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  }

  const itemsQuery = User.find(filter)
    .select("name email phone role isActive userCode createdAt")
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  if (isCodeSearch) {
    // At most one document can match, so `countDocuments` would only repeat the
    // same index lookup.
    const items = (await itemsQuery) as unknown as UserListDoc[];
    return NextResponse.json(
      buildPaginationResult(items.map(serialize), items.length, page, limit),
    );
  }

  const [items, total] = await Promise.all([itemsQuery, User.countDocuments(filter)]);

  return NextResponse.json(
    buildPaginationResult(
      (items as unknown as UserListDoc[]).map(serialize),
      total as number,
      page,
      limit,
    ),
  );
}

const userInviteSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES as unknown as [string, ...string[]]),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().optional(),
  privileges: z.array(z.string()).optional(),
  ownerId: z.string().trim().optional(),
});

/** Creates a new user account via invite (system-admin only). */
export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const actor = await requireRoleManagementActor(request);
  if (actor instanceof NextResponse) return actor;

  await connectToDatabase();

  const body = await request.json().catch(() => null);
  const parsed = userInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid user payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { role, name, email, phone, privileges, ownerId } = parsed.data;

  if (!email && !phone) {
    return NextResponse.json({ error: "Email or phone is required" }, { status: 400 });
  }

  // Staff roles require an owner binding.
  if (role === "caretaker" || role === "custodian") {
    if (!ownerId) {
      return NextResponse.json({ error: "ownerId is required for staff roles" }, { status: 400 });
    }
  }

  const displayName = name?.trim() || "New User";

  const identity = await resolveUserByContact({ email, phone });
  if (!identity.ok) {
    return NextResponse.json({ error: identity.message }, { status: 400 });
  }

  const existing = identity.user;
  if (existing) {
    if (existing.role !== role) {
      return NextResponse.json(
        { error: "An account with this contact already exists with a different role" },
        { status: 409 },
      );
    }
    if (existing.isActive) {
      return NextResponse.json(
        { error: "An active account already exists with this contact" },
        { status: 409 },
      );
    }
    // Inactive same-role user: refresh verification token and resend invite.
    const verificationToken = crypto.randomUUID();
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await User.updateOne(
      { _id: existing._id },
      {
        $set: {
          name: displayName,
          verificationToken,
          verificationTokenExpiry,
          isActive: false,
          isVerified: false,
        },
      },
    );
    let emailSent: boolean | undefined;
    if (email) {
      emailSent = await sendInviteEmail(email, displayName, role, verificationToken);
      if (!emailSent) {
        console.error("[invite] Invitation email could not be sent", {
          role,
          recipient: email,
        });
      }
    }
    await writeAuditEvent({
      actor: { userId: actor.userId, role: "system-admin" },
      action: "user.invited",
      entityType: "user",
      entityId: String(existing._id),
      after: { role, email: email ?? "", phone: phone ?? "" },
      request: {
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    });
    return NextResponse.json(
      {
        invited: true,
        ...(emailSent === undefined ? {} : { emailSent }),
        ...(emailSent === false ? { warning: INVITE_EMAIL_WARNING } : {}),
        data: {
          id: String(existing._id),
          name: displayName,
          email: email ?? existing.email ?? "",
          phone: phone ?? existing.phone ?? "",
          role,
        },
      },
      { status: 201 },
    );
  }

  // Phone-only path (no email): create active + verified with temp password.
  if (phone && !email) {
    const created = await createPhoneOnlyAccount({
      role: role as Role,
      name: displayName,
      phone,
      privileges: privileges as never,
    });
    await writeAuditEvent({
      actor: { userId: actor.userId, role: "system-admin" },
      action: "user.created",
      entityType: "user",
      entityId: String(created.user._id),
      after: { role, phone: created.user.phone ?? "", name: displayName },
      request: {
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    });
    return NextResponse.json(
      {
        created: true,
        password: created.password,
        data: {
          id: String(created.user._id),
          name: created.user.name,
          email: created.user.email ?? "",
          phone: created.user.phone ?? "",
          role: created.user.role ?? role,
        },
      },
      { status: 201 },
    );
  }

  // Email path: create inactive + unverified with verification token.
  const verificationToken = crypto.randomUUID();
  const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const created = await withUserCodeRetry((userCode) =>
    User.create({
      email,
      name: displayName,
      phone: phone ?? "",
      passwordHash: crypto.randomBytes(32).toString("hex"),
      role,
      privileges: role === "caretaker" ? (privileges ?? []) : [],
      isActive: false,
      isVerified: false,
      verificationToken,
      verificationTokenExpiry,
      userCode,
    }),
  );

  let emailSent: boolean | undefined;
  if (email) {
    emailSent = await sendInviteEmail(email, created.name, role, verificationToken);
    if (!emailSent) {
      console.error("[invite] Invitation email could not be sent", { role, recipient: email });
    }
  }

  await writeAuditEvent({
    actor: { userId: actor.userId, role: "system-admin" },
    action: "user.invited",
    entityType: "user",
    entityId: String(created._id),
    after: { role, email: email ?? "", phone: phone ?? "" },
    request: {
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    },
  });

  return NextResponse.json(
    {
      invited: true,
      ...(emailSent === undefined ? {} : { emailSent }),
      ...(emailSent === false ? { warning: INVITE_EMAIL_WARNING } : {}),
      data: {
        id: String(created._id),
        name: created.name,
        email: created.email ?? "",
        phone: created.phone ?? "",
        role: created.role ?? role,
      },
    },
    { status: 201 },
  );
}
