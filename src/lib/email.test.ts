import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND, getAppUrl } from "@/lib/brand";

interface CapturedMail {
  from?: string;
  to?: string;
  subject?: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

const { sendMailMock, createTransportMock, errorSpy, logSpy, warnSpy } = vi.hoisted(() => ({
  sendMailMock: vi.fn<(mail: CapturedMail) => Promise<{ messageId: string }>>(),
  createTransportMock: vi.fn<(options: Record<string, unknown>) => unknown>(),
  errorSpy: vi.fn(),
  logSpy: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import {
  createAnnouncementContent,
  createComplaintStatusContent,
  createInvoicePaidContent,
  createInvoicePaidStaffContent,
  createOverdueContent,
  escapeHtml,
  isEmailConfigured,
  sanitizeHeader,
  sendContactMessage,
  sendEmail,
  sendInviteEmail,
  sendNotificationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  uniqueSubject,
} from "./email";

function sentMail(): CapturedMail {
  const mail = sendMailMock.mock.calls[0]?.[0];
  if (!mail) throw new Error("sendMail was not called");
  return mail;
}

function transportConfig(): Record<string, unknown> {
  const config = createTransportMock.mock.calls[0]?.[0];
  if (!config) throw new Error("createTransport was not called");
  return config;
}

describe("Email verification", () => {
  it("should generate a verification token", async () => {
    const token = crypto.randomUUID();
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(0);
  });

  it("should have 24-hour token expiry", () => {
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const now = new Date();
    expect(expiry.getTime() - now.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -2);
  });

  it("should report when SMTP email is not configured", () => {
    const previous = {
      EMAIL_HOST: process.env.EMAIL_HOST,
      EMAIL_USER: process.env.EMAIL_USER,
      EMAIL_PASS: process.env.EMAIL_PASS,
    };

    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;

    try {
      expect(isEmailConfigured()).toBe(false);
    } finally {
      Object.assign(process.env, previous);
    }
  });
});

describe("Email header and HTML injection protection", () => {
  it("sanitizeHeader removes CR/LF and control characters before a header is built", () => {
    expect(sanitizeHeader("Leak\r\nX-Injected: yes")).toBe("Leak  X-Injected: yes");
    expect(sanitizeHeader("a\u0000b\u001fc")).toBe("a b c");
    expect(sanitizeHeader("clean subject")).toBe("clean subject");
  });

  it("escapeHtml escapes <, >, &, \" and '", () => {
    expect(escapeHtml(`<script>alert("x" & 'y')</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;",
    );
    expect(escapeHtml("no html")).toBe("no html");
  });

  it("uniqueSubject returns a stable sanitized subject with no timestamp or control chars", () => {
    const source = `Complaint "Leak\r\nX-Injected: yes" resolved - ${BRAND.name}`;
    const expected = `Complaint "Leak  X-Injected: yes" resolved - ${BRAND.name}`;
    expect(uniqueSubject(source)).toBe(expected);
    expect(uniqueSubject(source)).toBe(uniqueSubject(source));
    expect(expected).not.toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\]/);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserts no control chars survive sanitization.
    expect(uniqueSubject(source)).not.toMatch(/[\u0000-\u001f]/);
  });

  it("createComplaintStatusContent escapes a script-laden subject in the HTML body", () => {
    const html = createComplaintStatusContent({
      subject: '<script>alert("hi")</script>',
      status: "resolved",
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("resolved");
  });
});

describe("payment email amounts", () => {
  it("reports the amount actually recorded as received", () => {
    const html = createInvoicePaidContent({
      invoiceNumber: "INV-1",
      period: "2026-09",
      amountDue: 25000,
      amountPaid: 5000,
    });

    expect(html).toContain("Ksh 5,000");
    expect(html).not.toContain("Ksh 25,000");
  });

  it("does not claim a partially-paid invoice was paid in full", () => {
    const html = createInvoicePaidStaffContent({
      invoiceNumber: "INV-1",
      period: "2026-09",
      amountDue: 25000,
      amountPaid: 5000,
    });

    expect(html).toContain("A payment of");
    expect(html).not.toContain("paid in full");
  });
});

describe("Email templates and transport", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      EMAIL_HOST: process.env.EMAIL_HOST,
      EMAIL_PORT: process.env.EMAIL_PORT,
      EMAIL_USER: process.env.EMAIL_USER,
      EMAIL_PASS: process.env.EMAIL_PASS,
      EMAIL_FROM: process.env.EMAIL_FROM,
      EMAIL_SECURE: process.env.EMAIL_SECURE,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    };
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_PORT = "587";
    process.env.EMAIL_USER = "secret-user@example.com";
    process.env.EMAIL_PASS = "supersecretpassword";
    delete process.env.EMAIL_SECURE;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";

    sendMailMock.mockReset();
    createTransportMock.mockReset();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    errorSpy.mockClear();
    logSpy.mockClear();
    warnSpy.mockClear();
    vi.spyOn(console, "error").mockImplementation(errorSpy);
    vi.spyOn(console, "log").mockImplementation(logSpy);
    vi.spyOn(console, "warn").mockImplementation(warnSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns true and logs the message id when the transport accepts the message", async () => {
    sendMailMock.mockResolvedValue({ messageId: "<msg-123@example.com>" });

    const result = await sendEmail({
      to: "invitee@example.com",
      subject: "Invite",
      html: "<p>Hi</p>",
    });

    expect(result).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("Email sent:", "<msg-123@example.com>");
  });

  it("returns false and emits a safe structured log on an SMTP error", async () => {
    sendMailMock.mockRejectedValue({
      code: "EAUTH",
      response: "535 Authentication failed",
      command: "AUTH",
    });

    const result = await sendEmail({
      to: "invitee@example.com",
      subject: "Invite",
      html: "<p>Hi</p>",
    });

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("[email] Send failed", {
      recipient: "i***@e***.com",
      subject: "Invite",
      code: "EAUTH",
      response: "535 Authentication failed",
      command: "AUTH",
    });
    expect(logSpy).not.toHaveBeenCalled();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("secret-user@example.com");
    expect(logged).not.toContain("invitee@example.com");
    expect(logged).not.toContain("supersecretpassword");
    expect(logged).not.toContain("supersecretpassword".slice(0, 3));
  });

  it("returns false for a generic Error without throwing", async () => {
    sendMailMock.mockRejectedValue(new Error("transport exploded"));

    await expect(sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" })).resolves.toBe(
      false,
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("returns false for a non-Error throw without throwing", async () => {
    sendMailMock.mockRejectedValue("plain string failure");

    await expect(sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" })).resolves.toBe(
      false,
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("renders the actual recipient in the footer and escapes $-sequences and HTML", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });
    const recipient = "weird$&$$<script>@example.com";

    await sendVerificationEmail(recipient, "tok", "Ada");

    const html = sentMail().html ?? "";
    expect(html).toContain("This email was sent to <strong>");
    expect(html).not.toContain("{{EMAIL}}");
    expect(html).not.toContain("<strong></strong>");
    expect(html).toContain(escapeHtml(recipient));
    expect(html).not.toContain("<script>");
  });

  it("treats $-substitution sequences in name, token and link as literal text", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });
    const nasty = "$&$`$'$1$$";

    await sendVerificationEmail("u@example.com", nasty, `Ada ${nasty}`);

    const html = sentMail().html ?? "";
    expect(html).not.toContain("{{VERIFY_URL}}");
    expect(html).not.toContain("{{APP_URL}}");
    expect(html).not.toContain("{{EMAIL}}");
    expect(html).toContain(escapeHtml(nasty));
    expect(html).toContain(escapeHtml(`Ada ${nasty}`));
  });

  const emailCases: Array<{ label: string; send: () => Promise<boolean> }> = [
    {
      label: "verification",
      send: () => sendVerificationEmail("user@example.com", "tok-1", "Ada"),
    },
    {
      label: "password reset",
      send: () => sendPasswordResetEmail("user@example.com", "tok-2", "Ada"),
    },
    {
      label: "invite with token",
      send: () => sendInviteEmail("user@example.com", "Ada", "tenant", "tok-3"),
    },
    {
      label: "invite without token",
      send: () => sendInviteEmail("user@example.com", "Ada", "tenant"),
    },
    {
      label: "welcome",
      send: () => sendWelcomeEmail("user@example.com", "Ada", "tenant"),
    },
    {
      label: "notification",
      send: () =>
        sendNotificationEmail({
          to: "user@example.com",
          subjectPrefix: "Update",
          content: '<a href="{{APP_URL}}">Open</a>',
          text: "Open the app",
          linkUrl: `${getAppUrl()}/dashboard/invoices`,
        }),
    },
    {
      label: "contact",
      send: () =>
        sendContactMessage({
          name: "Ada",
          email: "ada@example.com",
          subject: "Question",
          message: "Hello there",
        }),
    },
  ];

  it.each(emailCases)(
    "produces a complete, placeholder-free email for $label",
    async ({ send }) => {
      sendMailMock.mockResolvedValue({ messageId: "id" });

      await send();

      const mail = sentMail();
      expect(mail.to).toBeTruthy();
      expect(mail.html).toBeTruthy();
      expect(mail.text).toBeTruthy();
      expect(mail.html).not.toMatch(/\{\{[^}]*\}\}/);
    },
  );

  it("renders the welcome dashboard link exactly once", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendWelcomeEmail("user@example.com", "Ada", "tenant");

    const html = sentMail().html ?? "";
    expect((html.match(/\/dashboard/g) ?? []).length).toBe(1);
    expect(html).toContain(`href="${getAppUrl()}/dashboard"`);
  });

  it("escapes href URLs and raw formatPeriod fallback values without hidden content", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });
    const rawPeriod = '<img src=x onerror="boom">';

    const paid = createInvoicePaidContent({
      invoiceNumber: "INV-9",
      period: rawPeriod,
      amountDue: 1000,
    });
    expect(paid).not.toContain("<img");
    expect(paid).toContain(escapeHtml(rawPeriod));
    expect(createInvoicePaidStaffContent({ period: rawPeriod })).toContain(escapeHtml(rawPeriod));
    expect(createOverdueContent({ period: rawPeriod })).toContain(escapeHtml(rawPeriod));
    expect(createAnnouncementContent({ title: rawPeriod, body: "ok" })).not.toContain("<img");

    await sendNotificationEmail({
      to: "user@example.com",
      subjectPrefix: "Update",
      content: '<a href="{{APP_URL}}">Open</a>',
      text: "Open",
      linkUrl: `${getAppUrl()}/x?a=1&b="<script>"`,
    });

    const body = sentMail().html ?? "";
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("mso-hide");
    expect(body).not.toContain("color: transparent");
    expect(body).toContain("&amp;");
    expect(body).toContain("&quot;");
  });

  it("escapes contact fields in HTML and sanitizes the subject header", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });
    const nasty = '<script>alert("x")</script>\r\nX-Injected: yes';

    await sendContactMessage({
      name: nasty,
      email: nasty,
      subject: nasty,
      message: nasty,
    });

    const mail = sentMail();
    const html = mail.html ?? "";
    expect(html).not.toContain("<script>");
    expect(html).toContain(escapeHtml(nasty));
    expect(mail.subject).toContain("[Contact]");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.replyTo).toBe(nasty);
    expect(mail.to).toBe(BRAND.emails.support);
  });

  it("uses implicit TLS on port 465 without a rejectUnauthorized override", async () => {
    process.env.EMAIL_PORT = "465";
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" });

    const config = transportConfig();
    expect(config.host).toBe("smtp.example.com");
    expect(config.name).toBe("smtp.example.com");
    expect(config.port).toBe(465);
    expect(config.secure).toBe(true);
    expect(config.requireTLS).toBe(false);
    expect(config.tls).toBeUndefined();
  });

  it("enforces STARTTLS on port 587", async () => {
    process.env.EMAIL_PORT = "587";
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" });

    const config = transportConfig();
    expect(config.name).toBe("smtp.example.com");
    expect(config.port).toBe(587);
    expect(config.secure).toBe(false);
    expect(config.requireTLS).toBe(true);
  });

  it("returns false without creating a transport when SMTP env is incomplete", async () => {
    delete process.env.EMAIL_HOST;

    const result = await sendEmail({
      to: "invitee@example.com",
      subject: "Invite",
      html: "<p>Hi</p>",
    });

    expect(result).toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    const warnings = JSON.stringify(warnSpy.mock.calls);
    expect(warnings).toContain("not configured");
    expect(warnings).not.toContain("secret-user@example.com");
    expect(warnings).not.toContain("supersecretpassword");
  });

  it("rejects an invalid EMAIL_PORT before creating a transport", async () => {
    process.env.EMAIL_PORT = "not-a-port";

    const result = await sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" });

    expect(result).toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    const errors = JSON.stringify(errorSpy.mock.calls);
    expect(errors).toContain("EMAIL_PORT");
    expect(errors).not.toContain("supersecretpassword");
  });

  it("sets the EHLO identity from EMAIL_HOST and never sets a hello option", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" });

    const config = transportConfig();
    expect(config.name).toBe("smtp.example.com");
    expect(config).not.toHaveProperty("hello");
  });

  it("derives the EHLO identity from the documented Gmail host", async () => {
    process.env.EMAIL_HOST = "smtp.gmail.com";
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" });

    const config = transportConfig();
    expect(config.name).toBe("smtp.gmail.com");
  });

  it("normalizes trailing dot, case and surrounding whitespace in EMAIL_HOST", async () => {
    process.env.EMAIL_HOST = "  SMTP.Example.COM.  ";
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" });

    const config = transportConfig();
    expect(config.name).toBe("smtp.example.com");
  });

  it.each([
    ["IP literal", "169.254.21.97"],
    ["bracketed IP literal", "[169.254.21.97]"],
    ["bracketed IPv6 literal", "[::1]"],
    ["single-label host", "localhost"],
    ["CR/LF in host", "smtp.exa\r\nmple.com"],
    ["control char in host", "smtp.exa\u001fmple.com"],
    ["non-ASCII host", "smtρ.example.com"],
    ["underscore in host", "smtp_example.com"],
    ["overlong label", `${"a".repeat(64)}.example.com`],
  ])("rejects an invalid EMAIL_HOST (%s) before creating a transport", async (_label, host) => {
    process.env.EMAIL_HOST = host;

    const result = await sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" });

    expect(result).toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    const errors = JSON.stringify(errorSpy.mock.calls);
    expect(errors).toContain("EMAIL_HOST");
    expect(errors).not.toContain(host);
    expect(errors).not.toContain("supersecretpassword");
  });

  it("renders no hidden or invisible spans for any sender", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });

    for (const { send } of emailCases) {
      sendMailMock.mockClear();
      await send();
      const html = sentMail().html ?? "";
      expect(html).not.toMatch(
        /<span\b[^>]*style="[^"]*(?:display:\s*none|max-height:\s*0|overflow:\s*hidden|color:\s*transparent|mso-hide|font-size:\s*1px)[^"]*"[^>]*>/i,
      );
    }
  });

  it("keeps verification, reset and invite URLs and recipients consistent across both parts", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });
    const recipient = "user@example.com";
    const cases = [
      {
        send: () => sendVerificationEmail(recipient, "tok-a", "Ada"),
        url: `${getAppUrl()}/auth/verify?token=tok-a`,
      },
      {
        send: () => sendPasswordResetEmail(recipient, "tok-b", "Ada"),
        url: `${getAppUrl()}/auth/reset-password?token=tok-b`,
      },
      {
        send: () => sendInviteEmail(recipient, "Ada", "tenant", "tok-c"),
        url: `${getAppUrl()}/auth/verify?token=tok-c&invited=1`,
      },
      {
        send: () => sendInviteEmail(recipient, "Ada", "tenant"),
        url: `${getAppUrl()}/auth?invited=1&email=${encodeURIComponent(recipient)}&role=tenant`,
      },
    ];

    for (const { send, url } of cases) {
      sendMailMock.mockClear();
      await send();
      const mail = sentMail();
      const html = (mail.html ?? "").replace(/&amp;/g, "&");
      expect(mail.text).toContain(url);
      expect(html).toContain(url);
      expect(mail.text).toContain(recipient);
      expect(html).toContain(recipient);
    }
  });

  it("sends exactly one text part and one html part with no hidden arrays", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });

    for (const { send } of emailCases) {
      sendMailMock.mockClear();
      await send();
      const mail = sentMail() as CapturedMail & Record<string, unknown>;
      expect(typeof mail.text).toBe("string");
      expect(typeof mail.html).toBe("string");
      expect(Array.isArray(mail.text)).toBe(false);
      expect(Array.isArray(mail.html)).toBe(false);
      for (const key of [
        "attachments",
        "alternatives",
        "alternate",
        "parts",
        "hidden",
        "textAsStream",
        "htmlAsStream",
        "preheader",
      ]) {
        expect(mail[key]).toBeUndefined();
      }
    }
  });

  it("keeps subjects identical across repeated sends", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendVerificationEmail("user@example.com", "tok", "Ada");
    await sendVerificationEmail("user@example.com", "tok", "Ada");

    const subjects = sendMailMock.mock.calls.map((call) => call[0].subject);
    expect(subjects[1]).toBe(subjects[0]);
    expect(subjects[0]).not.toMatch(/\[\d{4}-/);
  });

  it("uses different verification URLs in both parts for different tokens", async () => {
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendVerificationEmail("user@example.com", "token-one", "Ada");
    const first = sentMail();
    sendMailMock.mockClear();
    await sendVerificationEmail("user@example.com", "token-two", "Ada");
    const second = sentMail();
    const firstUrl = `${getAppUrl()}/auth/verify?token=token-one`;
    const secondUrl = `${getAppUrl()}/auth/verify?token=token-two`;
    const firstHtml = (first.html ?? "").replace(/&amp;/g, "&");
    const secondHtml = (second.html ?? "").replace(/&amp;/g, "&");

    expect(first.text).toContain(firstUrl);
    expect(first.text).not.toContain(secondUrl);
    expect(firstHtml).toContain(firstUrl);
    expect(firstHtml).not.toContain(secondUrl);
    expect(second.text).toContain(secondUrl);
    expect(second.text).not.toContain(firstUrl);
    expect(secondHtml).toContain(secondUrl);
    expect(secondHtml).not.toContain(firstUrl);
  });
});
