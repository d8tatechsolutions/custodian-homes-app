import { roleLabel as displayRole } from "@/lib/role-labels";
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import { BRAND, getAppUrl } from "@/lib/brand";
import { formatKES, formatPeriod } from "./format";

/**
 * Strips CR/LF and other control characters from a value destined for an email
 * header (subject lines). Header injection requires a line break — replacing
 * control chars with a space neutralizes it without mangling normal text.
 */
export function sanitizeHeader(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately strips CR/LF/control chars that could inject email headers.
  return value.replace(/[\r\n\u0000-\u001f]/g, " ");
}

/** HTML-escapes a user-controlled value before it is interpolated into an email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function emailDomain(value: string): string {
  const match = value.match(/@([^\s>]+)/);
  return match?.[1]?.toLowerCase() ?? "";
}

const FQDN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Resolves EMAIL_HOST to the client identity Nodemailer sends in EHLO. */
function resolveSmtpHello(value: string): string | null {
  const hostname = value.trim().replace(/\.$/, "").toLowerCase();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejects CR/LF and control chars in the EHLO identity.
  if (!hostname || hostname.length > 253 || /[\r\n\u0000-\u001f]/.test(hostname)) {
    return null;
  }
  const ipCore =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (isIP(ipCore) !== 0) return null;
  return FQDN_PATTERN.test(hostname) ? hostname : null;
}

function createTransporter() {
  const host = process.env.EMAIL_HOST;
  if (!isEmailConfigured() || !host) {
    console.warn(
      "[email] SMTP is not configured. Email delivery is disabled for this environment.",
    );
    return null;
  }

  const port = Number(process.env.EMAIL_PORT ?? "587");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      "[email] EMAIL_PORT must be an integer between 1 and 65535; email delivery is disabled.",
    );
    return null;
  }

  const name = resolveSmtpHello(host);
  if (!name) {
    console.error(
      "[email] EMAIL_HOST must be a DNS hostname (IP literals and single-label hosts are rejected); email delivery is disabled.",
    );
    return null;
  }

  const secure = process.env.EMAIL_SECURE === "true" || port === 465;
  const user = unquote(process.env.EMAIL_USER ?? "");
  const pass = unquote(process.env.EMAIL_PASS ?? "");

  if (process.env.EMAIL_SECURE === "true" && port !== 465) {
    console.warn(
      "[email] EMAIL_SECURE=true with a port other than 465; implicit TLS on this port may fail. Prefer port 465 or leave EMAIL_SECURE unset.",
    );
  }

  const from = process.env.EMAIL_FROM;
  if (from) {
    const fromDomain = emailDomain(unquote(from));
    const userDomain = emailDomain(user);
    if (fromDomain && userDomain && fromDomain !== userDomain) {
      console.warn(
        "[email] EMAIL_FROM domain differs from EMAIL_USER domain; check sender alignment with your provider.",
      );
    }
  }

  return nodemailer.createTransport({
    name,
    host,
    port,
    secure,
    requireTLS: port !== 465,
    auth: {
      user,
      pass,
    },
    pool: false,
    maxConnections: 1,
    maxMessages: 1,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
}

function getTransporter() {
  return createTransporter();
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

function logEmailSendFailure(options: EmailOptions, error: unknown): void {
  const details: Record<string, string> = {
    recipient: options.to,
    subject: options.subject,
  };
  if (error && typeof error === "object") {
    const smtpError = error as { code?: unknown; response?: unknown; command?: unknown };
    if (typeof smtpError.code === "string") details.code = smtpError.code;
    if (typeof smtpError.response === "string") details.response = smtpError.response;
    if (typeof smtpError.command === "string") details.command = smtpError.command;
  }
  console.error("[email] Send failed", details);
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn("[email] Skipping send for %s because SMTP is not configured.", options.to);
    return false;
  }

  try {
    const transporter = getTransporter();
    if (!transporter) return false;

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM
        ? unquote(process.env.EMAIL_FROM)
        : `${BRAND.name} <${BRAND.emails.info}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });
    console.log("Email sent:", info.messageId);
    return true;
  } catch (error) {
    logEmailSendFailure(options, error);
    return false;
  }
}

const BRAND_COLOR = "#143E6B";
const BRAND_COLOR_LIGHT = "#1e5a9b";
const SECONDARY_COLOR = "#64748b";
const BACKGROUND_COLOR = "#f8fafc";
const CARD_BACKGROUND = "#ffffff";
const BORDER_COLOR = "#e2e8f0";
const TEXT_PRIMARY = "#1e293b";
const TEXT_SECONDARY = "#475569";

function createTextFooter(recipientEmail: string): string {
  return `\n\nThis email was sent to ${recipientEmail}. If you didn't request this, please ignore this email or contact support at ${BRAND.emails.support}.\n\n© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.`;
}

function createEmailTemplate(content: string, recipientEmail: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${BRAND.name}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${BACKGROUND_COLOR}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${BACKGROUND_COLOR};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: ${CARD_BACKGROUND}; border-radius: 12px; border: 1px solid ${BORDER_COLOR}; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); padding: 32px 24px; text-align: center;">
              <div style="display: inline-block; width: 56px; height: 56px; background-color: rgba(255, 255, 255, 0.2); border-radius: 16px; text-align: center; line-height: 56px;">
                <span style="font-size: 24px; font-weight: 700; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">CH</span>
              </div>
              <h1 style="margin: 16px 0 0; color: #ffffff; font-size: 24px; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${BRAND.name}</h1>
              <p style="margin: 8px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 14px; font-weight: 400;">Where home begins</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 32px;">
              ${content}
            </td>
          </tr>
          
          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <hr style="border: none; border-top: 1px solid ${BORDER_COLOR}; margin: 0;">
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top: 1px solid ${BORDER_COLOR}; padding-top: 24px;">
                <tr>
                  <td style="text-align: center; padding-bottom: 16px;">
                    <p style="margin: 0 0 8px; font-size: 13px; color: ${SECONDARY_COLOR}; font-weight: 500;">${BRAND.name}</p>
                    <p style="margin: 0; font-size: 12px; color: ${SECONDARY_COLOR}; line-height: 1.6;">This email was sent to <strong>{{EMAIL}}</strong>. If you didn't request this, please ignore this email or contact support at ${BRAND.emails.support}.</p>
                  </td>
                </tr>
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0; font-size: 11px; color: ${SECONDARY_COLOR}; opacity: 0.7;">&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.replace("{{EMAIL}}", () => escapeHtml(recipientEmail));
}

function createVerificationContent(name: string): string {
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">Welcome to ${BRAND.name}! We're excited to have you on board. To get started, please verify your email address by clicking the button below:</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{VERIFY_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 14px 0 rgba(20, 62, 107, 0.4); transition: all 0.2s ease;">Verify Your Email</a>
    </div>
    <p style="margin: 24px 0 0; font-size: 14px; color: ${SECONDARY_COLOR}; line-height: 1.6; text-align: center;">Or copy and paste this link into your browser:<br><span style="word-break: break-all; color: ${BRAND_COLOR}; font-size: 13px;">{{VERIFY_URL}}</span></p>
    <div style="margin-top: 32px; padding: 16px; background-color: ${BACKGROUND_COLOR}; border-radius: 8px; border: 1px solid ${BORDER_COLOR};">
      <p style="margin: 0; font-size: 13px; color: ${SECONDARY_COLOR}; line-height: 1.6;"><strong>⏱ This link expires in 24 hours.</strong> If it expires, you can request a new verification email from the app.</p>
    </div>
    <p style="margin: 24px 0 0; font-size: 14px; color: ${SECONDARY_COLOR}; line-height: 1.6;">If you didn't create an account with ${BRAND.name}, you can safely ignore this email.</p>
  `;
}

function createPasswordResetContent(name: string): string {
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">We received a request to reset your password for your ${BRAND.name} account. Click the button below to create a new password:</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{RESET_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 14px 0 rgba(20, 62, 107, 0.4);">Reset Your Password</a>
    </div>
    <p style="margin: 24px 0 0; font-size: 14px; color: ${SECONDARY_COLOR}; line-height: 1.6; text-align: center;">Or copy and paste this link into your browser:<br><span style="word-break: break-all; color: ${BRAND_COLOR}; font-size: 13px;">{{RESET_URL}}</span></p>
    <div style="margin-top: 32px; padding: 16px; background-color: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
      <p style="margin: 0; font-size: 13px; color: #991b1b; line-height: 1.6;"><strong>⚠ Security notice:</strong> This link expires in 1 hour. If you didn't request a password reset, please ignore this email and your password will remain unchanged.</p>
    </div>
  `;
}

function createWelcomeContent(name: string, role: string): string {
  // Shown with the same names users see in the app (e.g. admin -> "Owner").
  const roleLabel = escapeHtml(displayRole(role));
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">Welcome to ${BRAND.name}! Your email has been verified and your account is now active as a <strong>${roleLabel}</strong>.</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">You can now access your dashboard and start managing your properties, applications, and more.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{APP_URL}}/dashboard" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 14px 0 rgba(20, 62, 107, 0.4);">Go to Dashboard</a>
    </div>
    <p style="margin: 24px 0 0; font-size: 14px; color: ${SECONDARY_COLOR}; line-height: 1.6;">If you have any questions, our support team is here to help.</p>
  `;
}

function renderTemplate(content: string, url: string, recipientEmail: string): string {
  const safeUrl = escapeHtml(url);
  const filledContent = content.replace(/{{VERIFY_URL}}|{{RESET_URL}}|{{APP_URL}}/g, () => safeUrl);
  return createEmailTemplate(filledContent, recipientEmail);
}

export interface SendNotificationEmailOptions {
  to: string;
  subjectPrefix: string;
  content: string;
  text: string;
  linkUrl: string;
}

/**
 * Best-effort notification email. `content` must only use the `{{APP_URL}}`
 * placeholder — callers pass the absolute deep link as `linkUrl`. The subject
 * is the sanitized `subjectPrefix` from `uniqueSubject`.
 */
export async function sendNotificationEmail(
  options: SendNotificationEmailOptions,
): Promise<boolean> {
  const html = renderTemplate(options.content, options.linkUrl, options.to);
  return sendEmail({
    to: options.to,
    subject: uniqueSubject(options.subjectPrefix),
    html,
    text: `${options.text}${createTextFooter(options.to)}`,
  });
}

export interface NotificationLeadContentInput {
  invoiceNumber?: string;
  period: string;
  amountDue?: number;
  amountPaid?: number;
}

export function createInvoicePaidContent(input: NotificationLeadContentInput): string {
  const amount = formatKES(input.amountPaid ?? input.amountDue ?? 0);
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi there,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">We're confirming receipt of your payment of <strong>${amount}</strong> for <strong>${escapeHtml(formatPeriod(input.period))}</strong>.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{APP_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">View Invoice</a>
    </div>
    <p style="margin: 24px 0 0; font-size: 14px; color: ${SECONDARY_COLOR}; line-height: 1.6;">Invoice <strong>${escapeHtml(input.invoiceNumber ?? "")}</strong> · ${amount} · ${escapeHtml(formatPeriod(input.period))}</p>
  `;
}

export function createInvoicePaidStaffContent(input: NotificationLeadContentInput): string {
  const amount = formatKES(input.amountPaid ?? input.amountDue ?? 0);
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi there,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">A payment of <strong>${amount}</strong> was recorded for invoice <strong>${escapeHtml(input.invoiceNumber ?? "")}</strong> for <strong>${escapeHtml(formatPeriod(input.period))}</strong>.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{APP_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">View Invoice</a>
    </div>
  `;
}

export function createOverdueContent(input: NotificationLeadContentInput): string {
  const amount = formatKES(input.amountDue ?? 0);
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi there,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">Your invoice <strong>${escapeHtml(input.invoiceNumber ?? "")}</strong> for <strong>${escapeHtml(formatPeriod(input.period))}</strong> (${amount}) is now overdue.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{APP_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Pay Now</a>
    </div>
    <p style="margin: 24px 0 0; font-size: 14px; color: ${SECONDARY_COLOR}; line-height: 1.6;">Please arrange payment as soon as possible to keep your account in good standing.</p>
  `;
}

export interface LeaseExpiryContentInput {
  daysUntil: number;
  endDate?: Date;
  rentAmount?: number;
}

export function createLeaseExpiryContent(input: LeaseExpiryContentInput): string {
  const when = input.endDate
    ? new Date(input.endDate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "soon";
  const period = input.daysUntil === 1 ? "1 day" : `${input.daysUntil} days`;
  const rent = input.rentAmount != null ? ` (${formatKES(input.rentAmount)}/month)` : "";
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi there,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">Your lease ends in <strong>${period}</strong> (${when})${rent}. Let us know if you'd like to renew.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{APP_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">View Lease</a>
    </div>
  `;
}

export interface ComplaintStatusContentInput {
  subject: string;
  status: string;
}

export function createComplaintStatusContent(input: ComplaintStatusContentInput): string {
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi there,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">Your complaint "<strong>${escapeHtml(input.subject)}</strong>" is now <strong>${escapeHtml(input.status)}</strong>.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{APP_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">View Complaint</a>
    </div>
  `;
}

export interface AnnouncementContentInput {
  title: string;
  body: string;
}

export function createAnnouncementContent(input: AnnouncementContentInput): string {
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi there,</p>
    <p style="margin: 0 0 8px; font-size: 15px; color: ${TEXT_PRIMARY}; line-height: 1.6; font-weight: 600;">${escapeHtml(input.title)}</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">${escapeHtml(input.body)}</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{APP_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">View Announcement</a>
    </div>
  `;
}

export function uniqueSubject(subject: string): string {
  return sanitizeHeader(subject);
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  name: string,
): Promise<boolean> {
  const verifyUrl = `${getAppUrl()}/auth/verify?token=${token}`;
  const content = createVerificationContent(name);
  const html = renderTemplate(content, verifyUrl, email);
  const text =
    `Hi ${name},\n\nWelcome to ${BRAND.name}! We're excited to have you on board. To get started, please verify your email address: ${verifyUrl}\n\n` +
    `This link expires in 24 hours. If it expires, you can request a new verification email from the app.\n\n` +
    `If you didn't create an account with ${BRAND.name}, you can safely ignore this email.` +
    createTextFooter(email);

  return sendEmail({
    to: email,
    subject: uniqueSubject(`Verify your email - ${BRAND.name}`),
    html,
    text,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  name: string,
): Promise<boolean> {
  const resetUrl = `${getAppUrl()}/auth/reset-password?token=${token}`;
  const content = createPasswordResetContent(name);
  const html = renderTemplate(content, resetUrl, email);
  const text =
    `Hi ${name},\n\nWe received a request to reset your password for your ${BRAND.name} account. Click this link to create a new password: ${resetUrl}\n\n` +
    `Security notice: This link expires in 1 hour. If you didn't request a password reset, please ignore this email and your password will remain unchanged.` +
    createTextFooter(email);

  return sendEmail({
    to: email,
    subject: uniqueSubject(`Reset your password - ${BRAND.name}`),
    html,
    text,
  });
}

function inviteRoleCopy(role: string): string {
  return role === "caretaker"
    ? `You've been added as a caretaker at ${BRAND.name}. You can now help manage properties, tenants, and day-to-day operations once your account is active.`
    : role === "custodian"
      ? `You've been added as a custodian at ${BRAND.name}. You can now help manage properties and units on behalf of an owner once your account is active.`
      : role === "broker"
        ? `You've been added as a verified broker at ${BRAND.name}. Once your account is active you can request to list properties, share listings and track your commissions.`
        : `You've been added as a tenant at ${BRAND.name}. You can now view your lease, invoices, and announcements once your account is active.`;
}

function createInviteContent(name: string, role: string): string {
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">${inviteRoleCopy(role)}</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="{{APP_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 14px 0 rgba(20, 62, 107, 0.4);">Verify your email</a>
    </div>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">Click the link above to verify your email and activate your account. You'll then set your password and complete your profile.</p>
    <p style="margin: 24px 0 0; font-size: 14px; color: ${SECONDARY_COLOR}; line-height: 1.6;">If you weren't expecting this invitation, you can safely ignore this email.</p>
  `;
}

export async function sendInviteEmail(
  email: string,
  name: string,
  role: string,
  token?: string,
): Promise<boolean> {
  const appUrl = getAppUrl();
  // Magic-link style invite: a single-use verification token takes the invitee
  // straight to the verify page, which activates the account and signs them in.
  const verifyUrl = token
    ? `${appUrl}/auth/verify?token=${token}&invited=1`
    : `${appUrl}/auth?invited=1&email=${encodeURIComponent(email)}&role=${role}`;
  const content = createInviteContent(name, role);
  const html = renderTemplate(content, verifyUrl, email);
  const text =
    `Hi ${name},\n\n${inviteRoleCopy(role)}\n\n` +
    `Verify your email using this link and activate your account. You'll then set your password and complete your profile: ${verifyUrl}\n\n` +
    `If you weren't expecting this invitation, you can safely ignore this email.` +
    createTextFooter(email);

  return sendEmail({
    to: email,
    subject: uniqueSubject(`You've been invited to ${BRAND.name}`),
    html,
    text,
  });
}

export async function sendWelcomeEmail(
  email: string,
  name: string,
  role: string,
): Promise<boolean> {
  const appUrl = getAppUrl();
  const content = createWelcomeContent(name, role);
  const html = renderTemplate(content, appUrl, email);
  const text =
    `Hi ${name},\n\nWelcome to ${BRAND.name}! Your email has been verified and your account is now active as a ${displayRole(role)}.\n\n` +
    `You can now access your dashboard and start managing your properties, applications, and more: ${appUrl}/dashboard\n\n` +
    `If you have any questions, our support team is here to help.` +
    createTextFooter(email);

  return sendEmail({
    to: email,
    subject: uniqueSubject(`Welcome to ${BRAND.name} - Your account is active`),
    html,
    text,
  });
}

export interface ContactMessageInput {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export async function sendContactMessage(input: ContactMessageInput): Promise<boolean> {
  const safeName = escapeHtml(input.name);
  const safeEmail = escapeHtml(input.email);
  const safeSubject = escapeHtml(input.subject);
  const safeMessage = escapeHtml(input.message).replace(/\n/g, "<br />");

  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="margin: 0 0 12px;">New contact form submission</h2>
      <p><strong>Name:</strong> ${safeName}</p>
      <p><strong>Email:</strong> ${safeEmail}</p>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="white-space: pre-wrap;">${safeMessage}</p>
    </div>
  `;
  const text = `New contact form submission\n\nName: ${input.name}\nEmail: ${input.email}\nSubject: ${input.subject}\n\n${input.message}`;

  return sendEmail({
    to: BRAND.emails.support,
    replyTo: input.email,
    subject: `[Contact] ${sanitizeHeader(input.subject)}`,
    html,
    text,
  });
}
