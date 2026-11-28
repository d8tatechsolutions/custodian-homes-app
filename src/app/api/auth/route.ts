import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/app/api/v1/_helpers";
import { getAppUrl } from "@/lib/brand";
import { encryptField } from "@/lib/crypto";
import {
  isEmailConfigured,
  sendAccountExistsEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email";
import { getJwtSecret, JWT_ALGORITHM } from "@/lib/jwt";
import { hashLinkToken, storedLinkTokenMatch } from "@/lib/link-tokens";
import { connectToDatabase } from "@/lib/mongoose";
import { isValidE164, isValidNationalId, normalizeNationalId } from "@/lib/phone";
import { isProfileComplete } from "@/lib/profile-completion";
import { rateLimitAccount, rateLimitAuth } from "@/lib/rate-limit-auth";
import { type Role, roleRoute } from "@/lib/role-routes";
import { withUserCodeRetry } from "@/lib/user-code";
import { normalizeContactEmail, normalizeContactPhone } from "@/lib/user-identity";
import { Tenant } from "@/models/Tenant";
import { User } from "@/models/User";

/** A bcrypt hash of a throwaway value (cost 12, like stored passwords). */
const TIMING_EQUALISER_HASH = "$2b$12$MatdkTJdx.ikFS29K4Y0VutZ/AN7eyUpaneosMgkHt/eLkfEHNF5y";

const signInSchema = z
  .object({
    identifier: z.string().min(1, "Email or phone required").max(320).optional(),
    email: z.string().email("Enter a valid email").optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
  })
  .refine((data) => data.identifier || data.email, "Email or phone required");

const signUpSchema = z.object({
  name: z.string().min(2, "Tell us your name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(["tenant", "caretaker", "admin"]),
  phone: z
    .string()
    .trim()
    .refine((value) => isValidE164(value), "Enter a valid mobile number with its country code"),
  nationalId: z
    .string()
    .trim()
    .refine(
      (value) => isValidNationalId(normalizeNationalId(value)),
      "Enter a valid national ID number",
    ),
});

const signUpWithVerificationSchema = signUpSchema.extend({
  name: z.string().min(2),
});

/**
 * Per-action throttle. Credential and email-sending actions get the tightest
 * budgets; verify/reset (token-gated) are looser. Buckets are per IP *and*
 * action, so hammering one endpoint cannot exhaust another's allowance.
 */
const AUTH_RATE_LIMITS: Record<string, { windowMs: number; limit: number }> = {
  signin: { windowMs: 15 * 60_000, limit: 10 },
  signup: { windowMs: 15 * 60_000, limit: 5 },
  "resend-verification": { windowMs: 15 * 60_000, limit: 3 },
  "forgot-password": { windowMs: 15 * 60_000, limit: 3 },
  "reset-password": { windowMs: 15 * 60_000, limit: 10 },
  "verify-email": { windowMs: 15 * 60_000, limit: 10 },
};
const DEFAULT_AUTH_RATE_LIMIT = { windowMs: 15 * 60_000, limit: 20 };

/** The first problem in plain words, so the form can say what to fix. */
function invalidInput(error: z.ZodError) {
  return NextResponse.json(
    { error: error.issues[0]?.message ?? "Invalid input", issues: error.flatten() },
    { status: 400 },
  );
}

/** Sent when an account exists but its email was never confirmed. */
const NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

function isDuplicatePhone(error: unknown): boolean {
  const e = error as { code?: number; keyPattern?: Record<string, unknown> } | null;
  return e?.code === 11000 && Boolean(e.keyPattern && "phone" in e.keyPattern);
}

function duplicatePhoneResponse() {
  return NextResponse.json(
    { error: "This mobile number is already used by another account" },
    { status: 409 },
  );
}

/**
 * What sign-up says once its email is out. The same words for a new address and
 * for one that already has an account, so the form never reveals which emails
 * are registered (the inbox owner is told in the email instead).
 */
const SIGNUP_SENT_MESSAGE =
  "Check your inbox (and spam folder) for an email from us to finish setting up your account.";

/** What resend says whether or not the email has an unconfirmed account. */
const RESEND_SENT_MESSAGE =
  "If this email has an account that isn't confirmed yet, a new verification link is on its way. Check your inbox (and spam folder).";

/** A verification or reset token as it arrives from a link: plain text, never a query object. */
function isLinkToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

async function generateVerificationToken(): Promise<string> {
  return crypto.randomUUID();
}

function issueSession(
  response: NextResponse,
  user: {
    _id?: unknown;
    id?: string;
    email: string;
    role: string;
    name?: string;
    tokenVersion?: number;
  },
): NextResponse {
  const userId = user._id ? String(user._id) : (user.id ?? "");
  const token = jwt.sign(
    {
      userId,
      email: user.email,
      role: user.role,
      name: user.name,
      tokenVersion: user.tokenVersion ?? 0,
    },
    getJwtSecret(),
    { expiresIn: "7d", algorithm: JWT_ALGORITHM },
  );

  response.cookies.set("keja-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}

export async function POST(request: Request) {
  try {
    const raw = await readJsonBody(request);
    // Malformed JSON or a non-object body is treated as empty (a clear 400 below).
    const body: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const { action } = body;

    const limitConfig = AUTH_RATE_LIMITS[action as string] ?? DEFAULT_AUTH_RATE_LIMIT;
    const rateLimited = await rateLimitAuth(request, {
      ...limitConfig,
      key: typeof action === "string" ? action : "default",
    });
    if (rateLimited) return rateLimited;

    if (action === "signin") {
      const parsed = signInSchema.safeParse(body);
      if (!parsed.success) return invalidInput(parsed.error);

      await connectToDatabase();
      const rawId = (parsed.data.identifier ?? parsed.data.email ?? "").trim();
      const accountLimited = await rateLimitAccount(rawId, "signin");
      if (accountLimited) return accountLimited;
      let user = null;
      if (rawId.includes("@")) {
        // Emails are stored lowercased, so normalise before lookup.
        user = await User.findOne({ email: normalizeContactEmail(rawId) }).lean();
      } else {
        // Phones are stored in E.164, so accept local/international input.
        const phoneLookup = normalizeContactPhone(rawId);
        if (phoneLookup) {
          user = await User.findOne({ phone: phoneLookup }).lean();
        }
        // Back-compat: look up the raw value when it differs from the
        // normalised form (covers legacy rows that were not yet backfilled).
        if (!user && phoneLookup !== rawId) {
          user = await User.findOne({ phone: rawId }).lean();
        }
      }
      // biome-ignore lint/complexity: useOptionalChain
      if (!user || !user.isActive) {
        // Same bcrypt cost as a real check, so response time doesn't reveal
        // whether the account exists.
        await bcrypt.compare(parsed.data.password, TIMING_EQUALISER_HASH);
        return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      }
      // An account with no password yet (e.g. a pending invite) fails like a wrong one.
      const isValid = await bcrypt.compare(
        parsed.data.password,
        user.passwordHash || TIMING_EQUALISER_HASH,
      );
      if (!isValid) {
        return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      }
      // Checked after the password so a stranger can't learn the account is
      // unconfirmed; the owner gets their email back to request a new link.
      if (!user.isVerified) {
        return NextResponse.json(
          { error: "Please verify your email first", code: NOT_VERIFIED, email: user.email },
          { status: 403 },
        );
      }

      // Bind tenant signups to any unbound Tenant rows carrying the same
      // email (normalised to match signup storage). This heals tenancies
      // created before the verify-email bind existed or where verification
      // ran before the Tenant row was added. Phone-only accounts bind by
      // phone instead.
      if (user.role === "tenant") {
        const userId = user._id?.toString() ?? user.id ?? "";
        if (user.email) {
          await Tenant.updateMany(
            { email: user.email.trim().toLowerCase(), userId: "" },
            { $set: { userId } },
          );
        } else if (user.phone) {
          await Tenant.updateMany({ phone: user.phone, userId: "" }, { $set: { userId } });
        }
      }

      const response = NextResponse.json({
        user: {
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
        },
      });
      return issueSession(response, user);
    }

    if (action === "signup") {
      const parsed = signUpWithVerificationSchema.safeParse(body);
      if (!parsed.success) return invalidInput(parsed.error);

      await connectToDatabase();
      const email = parsed.data.email.trim().toLowerCase();
      const existing = await User.findOne({ email });
      if (existing) {
        // Adopt a pre-created, not-yet-onboarded caretaker/tenant account
        // (created via the invite flow) instead of duplicating it.
        const adoptable =
          !existing.isActive &&
          !existing.isVerified &&
          (existing.role === "caretaker" ||
            existing.role === "tenant" ||
            existing.role === "custodian" ||
            existing.role === "admin" ||
            existing.role === "broker");
        if (adoptable) {
          const passwordHash = await bcrypt.hash(parsed.data.password, 12);
          const verificationToken = await generateVerificationToken();
          const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

          existing.name = parsed.data.name;
          existing.passwordHash = passwordHash;
          existing.isActive = true;
          existing.isVerified = false;
          existing.phone = parsed.data.phone;
          existing.nationalId = encryptField(normalizeNationalId(parsed.data.nationalId));
          existing.verificationToken = hashLinkToken(verificationToken);
          existing.verificationTokenExpiry = verificationTokenExpiry;
          try {
            await existing.save();
          } catch (error) {
            if (isDuplicatePhone(error)) return duplicatePhoneResponse();
            throw error;
          }

          const appBaseUrl = getAppUrl();
          const verifyUrl = `${appBaseUrl}/auth/verify?token=${verificationToken}`;

          const emailSent = isEmailConfigured()
            ? await sendVerificationEmail(email, verificationToken, parsed.data.name)
            : false;

          if (!emailSent) {
            if (process.env.NODE_ENV === "development") {
              console.warn(
                `[DEV] Email sending failed. Verification link for ${email}: ${verifyUrl}`,
              );
            }
            return NextResponse.json(
              { error: "Failed to send verification email. Please try again later." },
              { status: 500 },
            );
          }

          return NextResponse.json({
            message: SIGNUP_SENT_MESSAGE,
          });
        }
        // Never reveal whether an email is registered: answer exactly as for a
        // new sign-up and tell the inbox owner instead. The existing account
        // (its password and details) is left as it is.
        const accountLimited = await rateLimitAccount(email, "forgot-password");
        if (accountLimited) return accountLimited;
        let noticeSent: boolean;
        if (existing.isActive && !existing.isVerified) {
          // Not confirmed yet: send a fresh verification link to the owner.
          const freshToken = await generateVerificationToken();
          existing.verificationToken = hashLinkToken(freshToken);
          existing.verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await existing.save();
          noticeSent = isEmailConfigured()
            ? await sendVerificationEmail(email, freshToken, existing.name || "there")
            : false;
        } else {
          noticeSent = isEmailConfigured()
            ? await sendAccountExistsEmail(email, existing.name || "there")
            : false;
        }
        if (!noticeSent) {
          return NextResponse.json(
            { error: "Failed to send verification email. Please try again later." },
            { status: 500 },
          );
        }
        return NextResponse.json({ message: SIGNUP_SENT_MESSAGE });
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const verificationToken = await generateVerificationToken();
      const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      let createdUser: { _id: unknown };
      try {
        createdUser = await withUserCodeRetry((userCode) =>
          User.create({
            email,
            name: parsed.data.name,
            passwordHash,
            role: parsed.data.role,
            phone: parsed.data.phone,
            nationalId: encryptField(normalizeNationalId(parsed.data.nationalId)),
            verificationToken: hashLinkToken(verificationToken),
            verificationTokenExpiry,
            userCode,
          }),
        );
      } catch (error) {
        if (isDuplicatePhone(error)) return duplicatePhoneResponse();
        throw error;
      }

      const appBaseUrl = getAppUrl();
      const verifyUrl = `${appBaseUrl}/auth/verify?token=${verificationToken}`;

      const emailSent = isEmailConfigured()
        ? await sendVerificationEmail(email, verificationToken, parsed.data.name)
        : false;

      if (!emailSent) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[DEV] Email sending failed. Verification link for ${email}: ${verifyUrl}`);
        }
        await User.deleteOne({ _id: createdUser._id });
        return NextResponse.json(
          { error: "Failed to send verification email. Please try again later." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        message: SIGNUP_SENT_MESSAGE,
      });
    }

    if (action === "verify-email") {
      const { token } = body;
      // Text only: an object such as {"$ne": null} would match someone else's pending link.
      if (!isLinkToken(token)) {
        return NextResponse.json({ error: "Verification token required" }, { status: 400 });
      }

      await connectToDatabase();
      const user = await User.findOne({
        verificationToken: storedLinkTokenMatch(token),
        verificationTokenExpiry: { $gt: new Date() },
      });
      if (!user) {
        return NextResponse.json(
          { error: "Invalid or expired verification token" },
          { status: 400 },
        );
      }

      // Activate pending invited accounts (created inactive)
      const isPendingInvite = !user.isActive;
      if (isPendingInvite) {
        user.isActive = true;
      }

      user.isVerified = true;
      user.verificationToken = undefined;
      user.verificationTokenExpiry = undefined;
      await user.save();

      // Bind tenant signups to any unbound Tenant rows carrying the same
      // verified email (lowercased to match signup normalization).
      if (user.role === "tenant") {
        const userId = user._id?.toString() ?? user.id ?? "";
        await Tenant.updateMany(
          { email: user.email.trim().toLowerCase(), userId: "" },
          { $set: { userId } },
        );
      }

      const role = user.role as Role;
      const baseDashboard = roleRoute[role] ?? "/dashboard";
      const complete = isProfileComplete(user);
      const redirectTo = complete
        ? baseDashboard
        : `${baseDashboard}/settings?next=${encodeURIComponent(baseDashboard)}`;

      const response = NextResponse.json({
        message: "Email verified successfully",
        user: { email: user.email, name: user.name, role: user.role },
        redirectTo,
      });

      return issueSession(response, user);
    }

    if (action === "resend-verification") {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: "Email required" }, { status: 400 });
      }
      const normalizedEmail = String(email).trim().toLowerCase();

      const accountLimited = await rateLimitAccount(normalizedEmail, "forgot-password");
      if (accountLimited) return accountLimited;

      await connectToDatabase();
      const user = await User.findOne({ email: normalizedEmail });
      // Same answer for an unknown, an already confirmed and an unconfirmed
      // email, so this form cannot be used to find out who has an account.
      if (!user || user.isVerified) {
        return NextResponse.json({ message: RESEND_SENT_MESSAGE });
      }

      const verificationToken = await generateVerificationToken();
      const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      user.verificationToken = hashLinkToken(verificationToken);
      user.verificationTokenExpiry = verificationTokenExpiry;
      await user.save();

      const appBaseUrl = getAppUrl();
      const verifyUrl = `${appBaseUrl}/auth/verify?token=${verificationToken}`;

      const emailSent = isEmailConfigured()
        ? await sendVerificationEmail(normalizedEmail, verificationToken, user.name || "User")
        : false;

      if (!emailSent) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[DEV] Email sending failed. Verification link for ${normalizedEmail}: ${verifyUrl}`,
          );
        }
        return NextResponse.json(
          { error: "Failed to send verification email. Please try again later." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        message: RESEND_SENT_MESSAGE,
      });
    }

    if (action === "forgot-password") {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: "Email required" }, { status: 400 });
      }
      const normalizedEmail = String(email).trim().toLowerCase();

      // Same per-email limit as resend, so one inbox cannot be flooded.
      const accountLimited = await rateLimitAccount(normalizedEmail, "forgot-password");
      if (accountLimited) return accountLimited;

      await connectToDatabase();
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        // Don't reveal if user exists
        return NextResponse.json({
          message: "If the email exists, a password reset link has been sent.",
        });
      }

      const resetToken = await generateVerificationToken();
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      // Its own field: asking for a reset no longer cancels a pending
      // verification link. Only the fingerprint is stored.
      user.resetPasswordToken = hashLinkToken(resetToken);
      user.resetPasswordTokenExpiry = resetTokenExpiry;
      await user.save();

      const resetUrl = `${getAppUrl()}/auth/reset-password?token=${resetToken}`;
      const emailSent = isEmailConfigured()
        ? await sendPasswordResetEmail(user.email, resetToken, user.name || "User")
        : false;

      if (!emailSent) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[DEV] Password reset email failed. Reset link for ${normalizedEmail}: ${resetUrl}`,
          );
        }
        return NextResponse.json(
          { error: "Failed to send password reset email. Please try again later." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        message: "If the email exists, a password reset link has been sent.",
      });
    }

    if (action === "reset-password") {
      const { token, password } = body;
      // Text only: an object such as {"$ne": null} would match someone else's pending link.
      if (!isLinkToken(token) || typeof password !== "string" || !password) {
        return NextResponse.json({ error: "Token and new password required" }, { status: 400 });
      }
      if (password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters" },
          { status: 400 },
        );
      }

      await connectToDatabase();
      const now = new Date();
      let user = await User.findOne({
        resetPasswordToken: hashLinkToken(token),
        resetPasswordTokenExpiry: { $gt: now },
      });
      // Reset links sent before resets had their own field were stored as plain
      // text in the verification field with a 1-hour expiry: honour those until
      // they expire. A 24-hour verification link cannot pass this window, except
      // in its final hour, when it was emailed to the same inbox anyway.
      const legacyLink = !user;
      if (!user) {
        user = await User.findOne({
          verificationToken: token,
          verificationTokenExpiry: { $gt: now, $lte: new Date(now.getTime() + 60 * 60 * 1000) },
        });
      }
      if (!user) {
        return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
      }

      user.passwordHash = await bcrypt.hash(password, 12);
      user.resetPasswordToken = undefined;
      user.resetPasswordTokenExpiry = undefined;
      if (legacyLink) {
        user.verificationToken = undefined;
        user.verificationTokenExpiry = undefined;
      }
      // A reset signs the account out everywhere: sessions opened before it stop working.
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await user.save();

      return NextResponse.json({ message: "Password reset successfully. You can now sign in." });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (_error) {
    console.error("Auth error:", _error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
