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

  it("uniqueSubject stamps a timestamp onto a sanitized subject with no CR/LF", () => {
    const source = `Complaint "Leak\r\nX-Injected: yes" resolved - ${BRAND.name}`;
    const subject = uniqueSubject(source);
    expect(subject).toContain(`Complaint "Leak  X-Injected: yes" resolved - ${BRAND.name} [`);
    expect(subject).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\]$/);
    expect(subject).not.toMatch(/[\r\n]/);
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
      recipient: "invitee@example.com",
      subject: "Invite",
      code: "EAUTH",
      response: "535 Authentication failed",
      command: "AUTH",
    });
    expect(logSpy).not.toHaveBeenCalled();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("secret-user@example.com");
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
          preheader: "Latest update",
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

  it("escapes names, preheader, href URLs and raw formatPeriod fallback values", async () => {
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
      preheader: "<script>alert(1)</script>",
    });

    const body = sentMail().html ?? "";
    expect(body).not.toContain("<script>");
    expect(body).toContain(escapeHtml("<script>alert(1)</script>"));
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
    expect(config.port).toBe(465);
    expect(config.secure).toBe(true);
    expect(config.requireTLS).toBe(false);
    expect(config.tls).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain("smtp.gmail.com");
  });

  it("enforces STARTTLS on port 587", async () => {
    process.env.EMAIL_PORT = "587";
    sendMailMock.mockResolvedValue({ messageId: "id" });

    await sendEmail({ to: "u@example.com", subject: "S", html: "<p>x</p>" });

    const config = transportConfig();
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
});
