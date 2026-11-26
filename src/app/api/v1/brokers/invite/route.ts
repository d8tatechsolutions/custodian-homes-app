import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { writeAuditEvent } from "@/lib/audit";
import { getAppUrl } from "@/lib/brand";
import { authorizeBroker, createCommissionAgreement } from "@/lib/brokers";
import { encryptField } from "@/lib/crypto";
import { isBrokerBidsEnabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { authenticate, type Role } from "@/lib/permissions";
import { normalizeNationalId } from "@/lib/phone";
import { checkSameOrigin, rateLimit } from "@/lib/rate-limit";
import { bidTermsInput, toBidTerms } from "@/lib/schemas/broker-bids";
import { withUserCodeRetry } from "@/lib/user-code";
import { resolveUserByContact } from "@/lib/user-identity";
import { BrokerProfile } from "@/models/BrokerProfile";
import { Property } from "@/models/Property";
import { User } from "@/models/User";

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

const inviteInput = z.object({
  name: z.string().trim().min(2, "Enter the broker's full name").max(120),
  email: z.string().trim().email("Enter a valid email").max(200),
  phone: z.string().trim().min(6, "Enter a phone number").max(32),
  nationalId: z.string().trim().min(4, "Enter the national ID").max(32),
  agencyName: z.string().trim().max(160).optional().default(""),
  payout: z.object({
    payoutType: z.enum(["mpesa", "bank", "none"]).default("none"),
    accountName: z.string().trim().max(120).optional().default(""),
    accountNumber: z.string().trim().max(60).optional().default(""),
    bankName: z.string().trim().max(120).optional().default(""),
  }),
  /** Saved on the profile and pre-filled into the broker's requests. */
  defaultCommission: bidTermsInput.optional(),
  /** Owners only: authorise the broker on their own properties right away. */
  propertyIds: z.array(z.string().trim().max(64)).max(200).optional().default([]),
});

/**
 * Adds a broker directly (system-admin and owners — client decisions). The
 * broker account is created verified and becomes usable once the broker opens
 * the set-password link. Until transactional email for this flow ships, the
 * link is returned for the inviter to share; it expires after 24 hours and
 * can be regenerated.
 *
 * An owner may also authorise the new broker on their own properties; the
 * commission terms become a DRAFT agreement the broker accepts on first login.
 */
export async function POST(request: NextRequest) {
  if (!isBrokerBidsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limit = await rateLimit(request, { windowMs: 60_000, limit: 10 });
  if (limit instanceof NextResponse) return limit;
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  await connectToDatabase();
  const auth = authenticate(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inviter = (await User.findById(auth.userId).select("role isActive").lean()) as {
    role?: Role;
    isActive?: boolean;
  } | null;
  if (!inviter?.isActive || (inviter.role !== "admin" && inviter.role !== "system-admin")) {
    return NextResponse.json(
      { error: "Only owners and the platform can add brokers" },
      { status: 403 },
    );
  }

  const parsed = inviteInput.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the broker details", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;
  if (input.payout.payoutType === "mpesa" && !input.payout.accountNumber) {
    return NextResponse.json({ error: "Enter the M-Pesa number for payouts" }, { status: 400 });
  }
  if (
    input.payout.payoutType === "bank" &&
    (!input.payout.accountNumber || !input.payout.bankName)
  ) {
    return NextResponse.json(
      { error: "Enter the bank name and account number for payouts" },
      { status: 400 },
    );
  }
  if (input.propertyIds.length > 0) {
    if (inviter.role !== "admin") {
      return NextResponse.json(
        { error: "Only owners can authorise brokers on properties here" },
        { status: 400 },
      );
    }
    const owned = await Property.countDocuments({
      _id: { $in: input.propertyIds },
      ownerId: auth.userId,
      deletedAt: null,
    });
    if (owned !== new Set(input.propertyIds).size) {
      return NextResponse.json({ error: "Pick only your own properties" }, { status: 400 });
    }
    if (!input.defaultCommission) {
      return NextResponse.json(
        { error: "Set the commission for those properties" },
        { status: 400 },
      );
    }
  }

  const identity = await resolveUserByContact({ email: input.email, phone: input.phone });
  if (!identity.ok) return NextResponse.json({ error: identity.message }, { status: 400 });
  if (identity.user) {
    return NextResponse.json(
      { error: "An account with this email or phone already exists" },
      { status: 409 },
    );
  }

  const verificationToken = crypto.randomUUID();
  // Stored on the user too, so the invited broker's profile is complete and
  // the verify step lands them on their dashboard (brokers have no settings page).
  const encryptedNationalId = encryptField(normalizeNationalId(input.nationalId));
  const user = await withUserCodeRetry((userCode) =>
    User.create({
      email: identity.email,
      phone: identity.phone,
      name: input.name,
      passwordHash: crypto.randomBytes(32).toString("hex"),
      role: "broker",
      privileges: [],
      nationalId: encryptedNationalId,
      isActive: false,
      isVerified: false,
      verificationToken,
      verificationTokenExpiry: new Date(Date.now() + INVITE_TTL_MS),
      userCode,
    }),
  );
  const brokerId = String(user._id);
  const terms = input.defaultCommission ? toBidTerms(input.defaultCommission) : null;

  await BrokerProfile.create({
    userId: brokerId,
    agencyName: input.agencyName,
    phone: identity.phone,
    email: identity.email,
    status: "verified",
    verifiedByUserId: auth.userId,
    verifiedAt: new Date(),
    verificationNotes: `Added directly by ${inviter.role === "system-admin" ? "the platform" : "an owner"}`,
    payoutMethod: input.payout,
    nationalId: encryptedNationalId,
    addedVia: inviter.role === "system-admin" ? "system" : "admin",
    addedByUserId: auth.userId,
    defaultCommission: terms
      ? {
          basis: terms.basis,
          rateBps: terms.rateBps,
          fixedAmountMinor: terms.fixedAmountMinor,
          currency: terms.currency,
        }
      : undefined,
  });

  const actor = { userId: auth.userId, role: inviter.role };
  const authorised: string[] = [];
  for (const propertyId of [...new Set(input.propertyIds)]) {
    try {
      await authorizeBroker(actor, {
        brokerId,
        scopeType: "property",
        scopeId: propertyId,
        propertyId,
      });
      if (terms) {
        await createCommissionAgreement(actor, {
          brokerId,
          scopeType: "property",
          scopeId: propertyId,
          propertyId,
          basis: terms.basis,
          rateBps: terms.rateBps,
          fixedAmountMinor: terms.fixedAmountMinor,
          currency: terms.currency,
          autoActivate: false,
        });
      }
      authorised.push(propertyId);
    } catch (error) {
      console.error(
        "[brokers] authorisation on invite failed",
        propertyId,
        error instanceof Error ? error.message : error,
      );
    }
  }

  await writeAuditEvent({
    actor,
    action: "user.invited",
    entityType: "user",
    entityId: brokerId,
    after: {
      role: "broker",
      addedVia: inviter.role === "system-admin" ? "system" : "admin",
      authorised,
    },
    request: {
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    },
  });

  return NextResponse.json(
    {
      data: {
        id: brokerId,
        name: user.name,
        inviteUrl: `${getAppUrl()}/auth/verify?token=${verificationToken}&invited=1`,
        inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
        authorisedPropertyIds: authorised,
      },
    },
    { status: 201 },
  );
}
