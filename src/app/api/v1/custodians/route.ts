import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { writeAuditEvent } from "@/lib/audit";
import { authenticateSession } from "@/lib/auth-scope";
import { sendInviteEmail } from "@/lib/email";
import { getManagedOwnerId, getStaffIdsForOwner } from "@/lib/managed-owner";
import { maskEmail } from "@/lib/mask-email";
import { connectToDatabase } from "@/lib/mongoose";
import { getAdminAssignmentScope } from "@/lib/permissions";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { withUserCodeRetry } from "@/lib/user-code";
import { createPhoneOnlyAccount, resolveUserByContact } from "@/lib/user-identity";
import { Property } from "@/models/Property";
import { User } from "@/models/User";

const INVITE_EMAIL_WARNING =
  "Account created, but the invitation email could not be sent. Contact support.";

const custodianInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    name: z.string().trim().min(1).optional(),
    phone: z.string().optional(),
    // Only meaningful for system-admin invites (bind to a specific owner).
    ownerId: z.string().trim().optional(),
  })
  .refine((data) => data.email || data.phone, "Email or phone is required");

function readUserCode(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const code = (value as Record<string, unknown>).userCode;
  return typeof code === "string" ? code : "";
}

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const user = await User.findById(auth.userId).select("-passwordHash").lean();
  if (!user?.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forPropertyAssignment =
    request.nextUrl.searchParams.get("forPropertyAssignment") === "true";
  if (
    user.role !== "system-admin" &&
    user.role !== "admin" &&
    !(user.role === "custodian" && forPropertyAssignment)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ownerIdParam = request.nextUrl.searchParams.get("ownerId");
  const filter: Record<string, unknown> = {
    role: "custodian",
    ...(forPropertyAssignment ? { isActive: { $ne: false }, isVerified: { $ne: false } } : {}),
  };

  let allowedOwnerIds: string[] = [];
  if (user.role === "system-admin") {
    if (ownerIdParam) allowedOwnerIds = [ownerIdParam];
  } else if (user.role === "admin") {
    const scope = await getAdminAssignmentScope(String(user._id), "custodian:manage" as never);
    const assignedProperties = scope.assignedPropertyIds.length
      ? await Property.find({ _id: { $in: scope.assignedPropertyIds } })
          .select("ownerId")
          .lean()
      : [];
    const allowedOwners = [
      ...new Set(assignedProperties.map((property) => String(property.ownerId))),
    ];
    if (ownerIdParam) {
      if (!allowedOwners.includes(ownerIdParam)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      allowedOwnerIds = [ownerIdParam];
    } else {
      allowedOwnerIds = allowedOwners;
    }
  } else if (user.role === "custodian") {
    const managed = await getManagedOwnerId(String(user._id));
    if (ownerIdParam && ownerIdParam !== managed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    allowedOwnerIds = managed ? [managed] : [];
  } else {
    if (ownerIdParam && ownerIdParam !== String(user._id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    allowedOwnerIds = [String(user._id)];
  }

  if (allowedOwnerIds.length > 0) {
    const ids = await Promise.all(allowedOwnerIds.map((o) => getStaffIdsForOwner(o, "custodian")));
    const allowedCustodianIds = [...new Set(ids.flat())];
    if (allowedCustodianIds.length > 0) {
      filter._id = { $in: allowedCustodianIds };
    } else {
      filter._id = { $in: [] };
    }
  }

  const custodians = await User.find(filter)
    .select(forPropertyAssignment ? "name" : "name email phone privileges userCode")
    .sort({ name: 1 })
    .lean();

  const data = custodians.map((c) => ({
    id: String(c._id),
    name: c.name,
    email: forPropertyAssignment ? undefined : c.email,
    phone: forPropertyAssignment ? "" : (c.phone ?? ""),
    managedByOwnerId: forPropertyAssignment ? "" : (allowedOwnerIds[0] ?? ""),
    privileges: forPropertyAssignment ? [] : (c.privileges ?? []),
    userCode: forPropertyAssignment ? undefined : (c.userCode ?? ""),
  }));

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 20 });
  if (limit instanceof NextResponse) return limit;

  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const auth = await authenticateSession(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const actor = await User.findById(auth.userId).select("-passwordHash").lean();
  if (!actor?.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.role !== "system-admin" && actor.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await readJsonBody(request);
  const parsed = custodianInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid custodian payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const callerId = String(actor._id);
  let boundOwnerId = "";
  if (actor.role === "system-admin" || actor.role === "admin") {
    boundOwnerId = parsed.data.ownerId ?? "";
  } else {
    boundOwnerId = callerId;
  }
  if (!boundOwnerId) {
    return NextResponse.json(
      { error: "ownerId is required when inviting a custodian as system-admin" },
      { status: 400 },
    );
  }
  if (actor.role === "system-admin" || actor.role === "admin") {
    const owner = await User.findOne({ _id: boundOwnerId, role: "admin", isActive: true })
      .select("_id")
      .lean();
    if (!owner) {
      return NextResponse.json(
        { error: "ownerId must reference an active admin" },
        { status: 400 },
      );
    }
    if (actor.role === "admin") {
      const scope = await getAdminAssignmentScope(String(actor._id), "custodian:manage" as never);
      const assignedProperties = scope.assignedPropertyIds.length
        ? await Property.find({ _id: { $in: scope.assignedPropertyIds } })
            .select("ownerId")
            .lean()
        : [];
      const allowedOwners = new Set(assignedProperties.map((property) => String(property.ownerId)));
      if (!allowedOwners.has(boundOwnerId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const identity = await resolveUserByContact({
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (!identity.ok) {
    return NextResponse.json(
      { error: identity.message },
      { status: identity.kind === "identity-conflict" ? 409 : 400 },
    );
  }

  const { email, phone, user: existing } = identity;
  const displayName = parsed.data.name ?? existing?.name ?? email ?? phone;

  const audit = (action: string, entityId: string, after: Record<string, unknown>) =>
    writeAuditEvent({
      actor: { userId: String(actor._id), role: actor.role },
      action,
      entityType: "user",
      entityId,
      after,
      request: {
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    });

  if (existing) {
    if (existing.role !== "custodian") {
      return NextResponse.json(
        { error: "Contact is already registered to a non-custodian account" },
        { status: 409 },
      );
    }

    const active = existing.isActive !== false && existing.isVerified !== false;
    if (active) {
      const boundOwner = (await getManagedOwnerId(String(existing._id))) ?? "";
      if (boundOwner !== "" && boundOwner !== boundOwnerId) {
        return NextResponse.json({ error: "Custodian is bound to another owner" }, { status: 409 });
      }
      const update = {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(phone && existing.phone !== phone ? { phone } : {}),
      };
      await User.updateOne({ _id: existing._id }, { $set: update });
      await audit("custodian.linked", String(existing._id), {
        managedByOwnerId: boundOwnerId,
        name: update.name ?? existing.name,
      });
      return NextResponse.json({
        linked: true,
        data: {
          id: String(existing._id),
          name: update.name ?? existing.name,
          email: existing.email ?? email,
          phone: update.phone ?? existing.phone ?? phone,
          managedByOwnerId: boundOwnerId,
          privileges: existing.privileges ?? [],
          userCode: readUserCode(existing),
        },
      });
    }

    if (!email) {
      return NextResponse.json(
        { error: "This phone belongs to an inactive account" },
        { status: 409 },
      );
    }

    const verificationToken = crypto.randomUUID();
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await User.updateOne(
      { _id: existing._id },
      {
        $set: {
          email,
          name: displayName,
          phone,
          verificationToken,
          verificationTokenExpiry,
        },
      },
    );
    const emailSent = await sendInviteEmail(email, displayName, "custodian", verificationToken);
    if (!emailSent) {
      console.error("[invite] Invitation email could not be sent", {
        role: "custodian",
        recipient: maskEmail(email),
      });
    }
    await audit("custodian.invited", String(existing._id), {
      managedByOwnerId: boundOwnerId,
      name: displayName,
    });

    return NextResponse.json(
      {
        invited: true,
        emailSent,
        ...(emailSent ? {} : { warning: INVITE_EMAIL_WARNING }),
        data: {
          id: String(existing._id),
          name: displayName,
          email,
          phone,
          managedByOwnerId: boundOwnerId,
          privileges: existing.privileges ?? [],
          userCode: readUserCode(existing),
        },
      },
      { status: 201 },
    );
  }

  // Phone-only path: create an active, verified custodian that signs in with
  // phone + password. Credentials are returned so the admin can share them
  // out-of-band (no SMS/WhatsApp yet).
  if (!email) {
    const { user: created, password } = await createPhoneOnlyAccount({
      role: "custodian",
      name: displayName,
      phone,
    });
    await audit("custodian.created", String(created._id), {
      managedByOwnerId: boundOwnerId,
      name: created.name,
    });

    return NextResponse.json(
      {
        created: true,
        password,
        data: {
          id: String(created._id),
          name: created.name,
          email: created.email,
          phone: created.phone,
          managedByOwnerId: boundOwnerId,
          privileges: created.privileges ?? [],
          userCode: created.userCode ?? "",
        },
      },
      { status: 201 },
    );
  }

  const randomPassword = crypto.randomBytes(24).toString("base64url").slice(0, 32);
  const passwordHash = await bcrypt.hash(randomPassword, 12);
  const verificationToken = crypto.randomUUID();
  const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const created = await withUserCodeRetry((userCode) =>
    User.create({
      email,
      name: displayName,
      phone,
      passwordHash,
      role: "custodian",
      isActive: false,
      isVerified: false,
      verificationToken,
      verificationTokenExpiry,
      userCode,
    }),
  );

  const emailSent = await sendInviteEmail(email, created.name, "custodian", verificationToken);
  if (!emailSent) {
    console.error("[invite] Invitation email could not be sent", {
      role: "custodian",
      recipient: maskEmail(email),
    });
  }
  await audit("custodian.invited", String(created._id), {
    managedByOwnerId: boundOwnerId,
    name: created.name,
  });

  return NextResponse.json(
    {
      invited: true,
      emailSent,
      ...(emailSent ? {} : { warning: INVITE_EMAIL_WARNING }),
      data: {
        id: String(created._id),
        name: created.name,
        email: created.email,
        phone: created.phone ?? "",
        managedByOwnerId: boundOwnerId,
        privileges: created.privileges ?? [],
        userCode: created.userCode ?? "",
      },
    },
    { status: 201 },
  );
}
