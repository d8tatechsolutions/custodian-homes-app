/** @vitest-environment node */
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest } from "@/test/utils/api-request";
import { makeObjectId } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email", () => ({
  isEmailConfigured: vi.fn().mockReturnValue(false),
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendAccountExistsEmail: vi.fn(),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/Tenant", () => ({ Tenant: getModelStubs().tenant }));

import { POST } from "@/app/api/auth/route";
import { decryptField, isEncrypted } from "@/lib/crypto";
import {
  isEmailConfigured,
  sendAccountExistsEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email";
import { hashLinkToken } from "@/lib/link-tokens";
import { resetAuthRateLimits } from "@/lib/rate-limit-auth";

const { user, tenant: tenantStub } = getModelStubs();

const USER_ID = makeObjectId("user");

function mutableUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: USER_ID,
    email: "TENANT@Keja.co",
    role: "tenant",
    isVerified: false,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("POST /api/auth — signup merge", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  it("adopts an inactive, unverified pre-created caretaker instead of duplicating", async () => {
    const preCreated = {
      _id: USER_ID,
      email: "care@keja.co",
      role: "caretaker",
      isActive: false,
      isVerified: false,
      managedByOwnerId: makeObjectId("admin"),
      name: "Old Name",
      passwordHash: "old-hash",
      privileges: ["manage_tenants"],
      phone: "",
      nationalId: "",
      verificationToken: undefined as string | undefined,
      verificationTokenExpiry: undefined as Date | undefined,
      save: vi.fn().mockResolvedValue(undefined),
    };
    user.findOne.mockResolvedValue(preCreated);
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendVerificationEmail).mockResolvedValue(true);

    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: {
          action: "signup",
          name: "New Name",
          email: "care@keja.co",
          password: "secret123",
          role: "caretaker",
          phone: "+254712345678",
          nationalId: "12345678",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(preCreated.isActive).toBe(true);
    expect(preCreated.isVerified).toBe(false);
    expect(preCreated.name).toBe("New Name");
    expect(preCreated.role).toBe("caretaker");
    expect(preCreated.phone).toBe("+254712345678");
    expect(isEncrypted(preCreated.nationalId)).toBe(true);
    expect(decryptField(preCreated.nationalId)).toBe("12345678");
    expect(preCreated.privileges).toEqual(["manage_tenants"]);
    expect(preCreated.passwordHash).not.toBe("old-hash");
    expect(preCreated.save).toHaveBeenCalledTimes(1);
    expect(user.create).not.toHaveBeenCalled();
    const sentToken = vi.mocked(sendVerificationEmail).mock.calls.at(-1)?.[1] as string;
    expect(sendVerificationEmail).toHaveBeenLastCalledWith("care@keja.co", sentToken, "New Name");
    // Only the fingerprint of the emailed token is stored.
    expect(preCreated.verificationToken).toBe(hashLinkToken(sentToken));
    expect(preCreated.verificationToken).not.toBe(sentToken);
  });

  it("an already registered email gets the new-account answer; its owner is emailed", async () => {
    const registered = {
      _id: USER_ID,
      email: "care@keja.co",
      name: "Care Taker",
      role: "caretaker",
      isActive: true,
      isVerified: true,
      managedByOwnerId: "",
      passwordHash: "existing-hash",
      save: vi.fn().mockResolvedValue(undefined),
    };
    user.findOne.mockResolvedValue(registered);
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendAccountExistsEmail).mockResolvedValue(true);
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: {
          action: "signup",
          name: "Name",
          email: "care@keja.co",
          password: "secret123",
          role: "tenant",
          phone: "+254712345678",
          nationalId: "12345678",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).message).toMatch(/check your inbox/i);
    expect(sendAccountExistsEmail).toHaveBeenLastCalledWith("care@keja.co", "Care Taker");
    // The existing account is left exactly as it was.
    expect(registered.passwordHash).toBe("existing-hash");
    expect(registered.save).not.toHaveBeenCalled();
    expect(user.create).not.toHaveBeenCalled();
  });

  it("400 when the mobile number is not valid E.164", async () => {
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: {
          action: "signup",
          name: "New Name",
          email: "new@keja.co",
          password: "secret123",
          role: "tenant",
          phone: "0712345678",
          nationalId: "12345678",
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(user.create).not.toHaveBeenCalled();
  });

  it("creates a fresh user with phone and a normalised national id", async () => {
    user.findOne.mockResolvedValue(null);
    user.create.mockImplementation(async (doc: Record<string, unknown>) => doc);
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendVerificationEmail).mockResolvedValue(true);

    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: {
          action: "signup",
          name: "New Name",
          email: "new@keja.co",
          password: "secret123",
          role: "tenant",
          phone: "+254712345678",
          nationalId: "ab-123 456",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(user.create).toHaveBeenCalledTimes(1);
    const created = user.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.phone).toBe("+254712345678");
    expect(isEncrypted(created.nationalId as string)).toBe(true);
    expect(decryptField(created.nationalId as string)).toBe("AB123456");
  });
});

describe("POST /api/auth — verify-email", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  it("400 when the token is missing", async () => {
    const res = await POST(
      buildRequest("/api/auth", { method: "POST", body: { action: "verify-email" } }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("Verification token required");
    expect(user.findOne).not.toHaveBeenCalled();
  });

  it("400 when no user matches the token", async () => {
    user.findOne.mockResolvedValue(null);
    const res = await POST(
      buildRequest("/api/auth", { method: "POST", body: { action: "verify-email", token: "tok" } }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("Invalid or expired verification token");
    expect(tenantStub.updateMany).not.toHaveBeenCalled();
  });

  it("binds unbound tenant rows to the verified tenant user by normalized email", async () => {
    const doc = mutableUser({
      name: "Tenant Person",
      phone: "+254712345678",
      nationalId: "12345678",
    });
    user.findOne.mockResolvedValue(doc);

    const res = await POST(
      buildRequest("/api/auth", { method: "POST", body: { action: "verify-email", token: "tok" } }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.message).toBe("Email verified successfully");
    expect(body.user).toEqual({ email: "TENANT@Keja.co", name: "Tenant Person", role: "tenant" });
    expect(body.redirectTo).toBe("/dashboard/tenant");
    expect(res.cookies.get("keja-token")?.value).toBeTruthy();

    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(tenantStub.updateMany).toHaveBeenCalledWith(
      { email: "tenant@keja.co", userId: "" },
      { $set: { userId: USER_ID } },
    );
  });

  it("activates pending invite and redirects an incomplete profile to settings with ?next", async () => {
    const doc = mutableUser({
      role: "custodian",
      email: "custodian@keja.co",
      name: "custodian@keja.co",
      phone: "",
      nationalId: "",
      isActive: false,
      managedByOwnerId: "owner_123",
    }) as unknown as { isActive: boolean; isVerified: boolean };
    user.findOne.mockResolvedValue(doc);

    const res = await POST(
      buildRequest("/api/auth", { method: "POST", body: { action: "verify-email", token: "tok" } }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.redirectTo).toBe("/dashboard/custodian/settings?next=%2Fdashboard%2Fcustodian");
    expect(res.cookies.get("keja-token")?.value).toBeTruthy();
    expect(doc.isActive).toBe(true);
    expect(doc.isVerified).toBe(true);
  });

  it("does not bind tenant rows for a verified owner", async () => {
    const doc = mutableUser({ role: "admin", email: "owner@keja.co" });
    user.findOne.mockResolvedValue(doc);

    const res = await POST(
      buildRequest("/api/auth", { method: "POST", body: { action: "verify-email", token: "tok" } }),
    );
    expect(res.status).toBe(200);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(tenantStub.updateMany).not.toHaveBeenCalled();
  });

  it("does not bind tenant rows for a verified caretaker", async () => {
    const doc = mutableUser({ role: "caretaker", email: "caretaker@keja.co" });
    user.findOne.mockResolvedValue(doc);

    const res = await POST(
      buildRequest("/api/auth", { method: "POST", body: { action: "verify-email", token: "tok" } }),
    );
    expect(res.status).toBe(200);
    expect(tenantStub.updateMany).not.toHaveBeenCalled();
  });

  it("queries with an unexpired verification token window", async () => {
    const doc = mutableUser();
    user.findOne.mockResolvedValue(doc);
    await POST(
      buildRequest("/api/auth", { method: "POST", body: { action: "verify-email", token: "tok" } }),
    );
    const [filter] = user.findOne.mock.calls[0] as [Record<string, unknown>];
    // New links are stored as a fingerprint; older plain-text links still match.
    expect(filter.verificationToken).toEqual({ $in: [hashLinkToken("tok"), "tok"] });
    expect(filter.verificationTokenExpiry).toEqual({ $gt: expect.any(Date) });
  });
});

describe("POST /api/auth — signin tenant binding", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  function activeTenant() {
    return {
      _id: USER_ID,
      email: "tenant@keja.co",
      name: "Amina",
      role: "tenant",
      isActive: true,
      isVerified: true,
      passwordHash: bcrypt.hashSync("secret123", 4),
    };
  }

  it("binds unbound tenant rows to the signing-in tenant by normalized email", async () => {
    user.findOne.mockReturnValue(buildQuery(activeTenant()));

    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "signin", email: "Tenant@Keja.co", password: "secret123" },
      }),
    );
    expect(res.status).toBe(200);
    expect(tenantStub.updateMany).toHaveBeenCalledWith(
      { email: "tenant@keja.co", userId: "" },
      { $set: { userId: USER_ID } },
    );
  });

  it("does not touch tenant rows when an owner signs in", async () => {
    user.findOne.mockReturnValue(
      buildQuery({ ...activeTenant(), role: "admin", email: "owner@keja.co" }),
    );

    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "signin", email: "owner@keja.co", password: "secret123" },
      }),
    );
    expect(res.status).toBe(200);
    expect(tenantStub.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth — signin by phone", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  it("signs in a phone-only user by E.164 phone", async () => {
    const phoneUser = {
      _id: USER_ID,
      email: undefined,
      phone: "+254712345678",
      name: "Jane",
      role: "caretaker",
      isActive: true,
      isVerified: true,
      passwordHash: await bcrypt.hash("secret123", 12),
    };
    user.findOne.mockReturnValue(buildQuery(phoneUser));

    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "signin", identifier: "+254712345678", password: "secret123" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    const signedInUser = body.user as { role: string; phone: string };
    expect(signedInUser.role).toBe("caretaker");
    expect(signedInUser.phone).toBe("+254712345678");
    expect(user.findOne).toHaveBeenCalledWith({ phone: "+254712345678" });
  });

  it("normalises a local Kenyan phone before sign-in", async () => {
    const phoneUser = {
      _id: USER_ID,
      email: undefined,
      phone: "+254712345678",
      name: "Jane",
      role: "tenant",
      isActive: true,
      isVerified: true,
      passwordHash: await bcrypt.hash("secret123", 12),
    };
    user.findOne.mockReturnValue(buildQuery(phoneUser));

    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "signin", identifier: "0712 345 678", password: "secret123" },
      }),
    );
    expect(res.status).toBe(200);
    expect(user.findOne).toHaveBeenCalledWith({ phone: "+254712345678" });
  });

  it("still signs in with email for backward compatibility", async () => {
    const emailUser = {
      _id: USER_ID,
      email: "tenant@keja.co",
      name: "Amina",
      role: "tenant",
      isActive: true,
      isVerified: true,
      passwordHash: await bcrypt.hash("secret123", 12),
    };
    user.findOne.mockReturnValue(buildQuery(emailUser));

    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "signin", email: "TENANT@Keja.co", password: "secret123" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("401 when phone lookup finds no active verified user", async () => {
    user.findOne.mockReturnValue(buildQuery(null));

    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "signin", identifier: "+254712345678", password: "secret123" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth — rate limiting", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  it("429s once an IP exceeds the per-action sign-in budget", async () => {
    user.findOne.mockReturnValue(buildQuery(null));
    const headers = { "x-forwarded-for": "203.0.113.7" };
    const signin = () =>
      POST(
        buildRequest("/api/auth", {
          method: "POST",
          headers,
          body: { action: "signin", email: "a@b.co", password: "secret123" },
        }),
      );

    // 10 attempts are allowed (each 401 — no such user), the 11th is throttled.
    for (let i = 0; i < 10; i++) {
      expect((await signin()).status).toBe(401);
    }

    const limited = await signin();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("throttles each action independently", async () => {
    user.findOne.mockReturnValue(buildQuery(null));
    const headers = { "x-forwarded-for": "198.51.100.4" };
    // Exhaust signup (limit 5) with invalid payloads (400, no DB write).
    for (let i = 0; i < 5; i++) {
      await POST(
        buildRequest("/api/auth", { method: "POST", headers, body: { action: "signup" } }),
      );
    }
    const signupLimited = await POST(
      buildRequest("/api/auth", { method: "POST", headers, body: { action: "signup" } }),
    );
    expect(signupLimited.status).toBe(429);

    // A different action from the same IP is unaffected.
    const signin = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        headers,
        body: { action: "signin", email: "a@b.co", password: "secret123" },
      }),
    );
    expect(signin.status).toBe(401);
  });
});

describe("POST /api/auth — new users who have not confirmed their email", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  const signup = (overrides: Record<string, unknown> = {}) =>
    POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: {
          action: "signup",
          name: "New Name",
          email: "new@keja.co",
          password: "secret123",
          role: "tenant",
          phone: "+254712345678",
          nationalId: "12345678",
          ...overrides,
        },
      }),
    );

  async function unverifiedUser() {
    return {
      _id: USER_ID,
      email: "new@keja.co",
      phone: "+254712345678",
      role: "tenant",
      isActive: true,
      isVerified: false,
      passwordHash: await bcrypt.hash("secret123", 12),
    };
  }

  it("sign-in with the right password says so and returns the email for a new link", async () => {
    user.findOne.mockReturnValue(buildQuery(await unverifiedUser()));
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "signin", identifier: "+254712345678", password: "secret123" },
      }),
    );
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: "EMAIL_NOT_VERIFIED", email: "new@keja.co" });
  });

  it("sign-in with a wrong password reveals nothing about the account", async () => {
    user.findOne.mockReturnValue(buildQuery(await unverifiedUser()));
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "signin", identifier: "+254712345678", password: "wrong-pass" },
      }),
    );
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.code).toBeUndefined();
    expect(body.email).toBeUndefined();
  });

  it("signing up again emails them a fresh verification link, with the new-account answer", async () => {
    const account = { ...(await unverifiedUser()), save: vi.fn().mockResolvedValue(undefined) };
    const originalHash = account.passwordHash;
    user.findOne.mockResolvedValue(account);
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendVerificationEmail).mockResolvedValue(true);
    const res = await signup();
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.message).toMatch(/check your inbox/i);
    expect(body.code).toBeUndefined();
    const sentToken = vi.mocked(sendVerificationEmail).mock.calls.at(-1)?.[1] as string;
    expect((account as Record<string, unknown>).verificationToken).toBe(hashLinkToken(sentToken));
    expect(account.passwordHash).toBe(originalHash);
    expect(user.create).not.toHaveBeenCalled();
  });

  it("a confirmed email gets the same answer as a brand-new one", async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendVerificationEmail).mockResolvedValue(true);
    vi.mocked(sendAccountExistsEmail).mockResolvedValue(true);

    user.findOne.mockResolvedValue(null);
    user.create.mockResolvedValue({ _id: USER_ID });
    const fresh = await signup();

    user.findOne.mockResolvedValue({ ...(await unverifiedUser()), isVerified: true });
    const existing = await signup();

    expect(existing.status).toBe(fresh.status);
    expect(await json(existing)).toEqual(await json(fresh));
  });

  it("a mobile number already in use gets a clear 409, not a server error", async () => {
    user.findOne.mockResolvedValue(null);
    user.create.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), {
        code: 11000,
        keyPattern: { phone: 1 },
      }),
    );
    const res = await signup();
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("This mobile number is already used by another account");
  });

  it("says which field is wrong", async () => {
    const res = await signup({ nationalId: "12/34" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("Enter a valid national ID number");
  });
});

describe("POST /api/auth — link tokens must be text", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  const attacks: unknown[] = [{ $ne: null }, { $gt: "" }, ["tok"], 42, true];

  it("refuses a query object as a verification token without looking anyone up", async () => {
    for (const token of attacks) {
      const res = await POST(
        buildRequest("/api/auth", { method: "POST", body: { action: "verify-email", token } }),
      );
      expect(res.status).toBe(400);
    }
    expect(user.findOne).not.toHaveBeenCalled();
  });

  it("refuses a query object as a reset token, so no password can be changed", async () => {
    for (const token of attacks) {
      const res = await POST(
        buildRequest("/api/auth", {
          method: "POST",
          body: { action: "reset-password", token, password: "attacker-pass-1" },
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(user.findOne).not.toHaveBeenCalled();
  });

  it("refuses a new password that is not text", async () => {
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: {
          action: "reset-password",
          token: "tok",
          password: ["a", "b", "c", "d", "e", "f", "g", "h"],
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(user.findOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth — reset-password", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  it("sets the new password and signs the account out everywhere", async () => {
    const account: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = mutableUser({
      tokenVersion: 3,
      passwordHash: "old-hash",
    });
    user.findOne.mockResolvedValue(account);
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "reset-password", token: "tok", password: "new-pass-123" },
      }),
    );
    expect(res.status).toBe(200);
    expect(account.tokenVersion).toBe(4);
    expect(await bcrypt.compare("new-pass-123", account.passwordHash as string)).toBe(true);
    expect(account.save).toHaveBeenCalled();
  });
});

describe("POST /api/auth — resend and reset reveal nothing and keep links apart", () => {
  beforeEach(() => {
    resetModelStubs();
    resetAuthRateLimits();
  });

  it("resend gives the same answer for an unknown, a confirmed and an unconfirmed email", async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendVerificationEmail).mockResolvedValue(true);
    const ask = () =>
      POST(
        buildRequest("/api/auth", {
          method: "POST",
          body: { action: "resend-verification", email: "who@keja.co" },
        }),
      );

    user.findOne.mockResolvedValue(null);
    const unknown = await ask();
    user.findOne.mockResolvedValue(mutableUser({ isVerified: true }));
    const confirmed = await ask();
    const pending = mutableUser({ isVerified: false });
    user.findOne.mockResolvedValue(pending);
    const unconfirmed = await ask();

    for (const res of [unknown, confirmed, unconfirmed]) expect(res.status).toBe(200);
    const bodies = await Promise.all([unknown, confirmed, unconfirmed].map(json));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    // Only the unconfirmed account actually gets a link, stored as a fingerprint.
    const sentToken = vi.mocked(sendVerificationEmail).mock.calls.at(-1)?.[1] as string;
    expect((pending as Record<string, unknown>).verificationToken).toBe(hashLinkToken(sentToken));
  });

  it("forgot-password uses the reset field and leaves a pending verification link alone", async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendPasswordResetEmail).mockResolvedValue(true);
    const account = mutableUser({
      verificationToken: "pending-verification",
      verificationTokenExpiry: new Date(Date.now() + 60_000),
    }) as Record<string, unknown>;
    user.findOne.mockResolvedValue(account);
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "forgot-password", email: "tenant@keja.co" },
      }),
    );
    expect(res.status).toBe(200);
    expect(account.verificationToken).toBe("pending-verification");
    const sentToken = vi.mocked(sendPasswordResetEmail).mock.calls.at(-1)?.[1] as string;
    expect(account.resetPasswordToken).toBe(hashLinkToken(sentToken));
    expect(account.resetPasswordTokenExpiry).toBeInstanceOf(Date);
  });

  it("reset-password looks up the hashed reset link and clears it", async () => {
    const account: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = mutableUser({
      resetPasswordToken: hashLinkToken("reset-tok"),
      verificationToken: "pending-verification",
    });
    user.findOne.mockResolvedValue(account);
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "reset-password", token: "reset-tok", password: "brand-new-pass" },
      }),
    );
    expect(res.status).toBe(200);
    const [filter] = user.findOne.mock.calls[0] as [Record<string, unknown>];
    expect(filter.resetPasswordToken).toBe(hashLinkToken("reset-tok"));
    expect(account.resetPasswordToken).toBeUndefined();
    // A pending verification link is not touched by a reset.
    expect(account.verificationToken).toBe("pending-verification");
  });

  it("a reset link sent before the change (plain, 1-hour window) still works once", async () => {
    const account: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = mutableUser({
      verificationToken: "old-reset-tok",
    });
    user.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(account);
    const res = await POST(
      buildRequest("/api/auth", {
        method: "POST",
        body: { action: "reset-password", token: "old-reset-tok", password: "brand-new-pass" },
      }),
    );
    expect(res.status).toBe(200);
    const [legacyFilter] = user.findOne.mock.calls[1] as [Record<string, unknown>];
    expect(legacyFilter.verificationToken).toBe("old-reset-tok");
    expect(legacyFilter.verificationTokenExpiry).toEqual({
      $gt: expect.any(Date),
      $lte: expect.any(Date),
    });
    expect(account.verificationToken).toBeUndefined();
  });
});
