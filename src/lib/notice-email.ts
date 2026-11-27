import { escapeHtml } from "@/lib/email";

/**
 * Body for a short notification email (wrapped in the shared branded layout
 * by `sendNotificationEmail`). Every value is HTML-escaped here; the button
 * uses the `{{APP_URL}}` placeholder, which the sender fills with the link.
 */
export interface NoticeEmailInput {
  /** First paragraph, plain text. */
  message: string;
  /** Optional label/value rows (empty values are skipped). */
  details?: [label: string, value: string][];
  /** Button text; omitted for emails with no link (e.g. service providers). */
  cta?: string;
  /** Closing line, plain text. */
  footer?: string;
}

const TEXT_PRIMARY = "#1e293b";
const TEXT_SECONDARY = "#475569";
const MUTED = "#64748b";
const BRAND = "#143E6B";
const BRAND_LIGHT = "#1e5a9b";
const BORDER = "#e2e8f0";

export function noticeEmailContent(input: NoticeEmailInput): string {
  const rows = (input.details ?? []).filter(([, value]) => value && value.trim() !== "");
  const table = rows.length
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px; border: 1px solid ${BORDER}; border-radius: 8px;">${rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding: 10px 14px; font-size: 13px; color: ${MUTED}; width: 38%; border-bottom: 1px solid ${BORDER};">${escapeHtml(label)}</td><td style="padding: 10px 14px; font-size: 14px; color: ${TEXT_PRIMARY}; border-bottom: 1px solid ${BORDER};">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const button = input.cta
    ? `<div style="text-align: center; margin: 32px 0;"><a href="{{APP_URL}}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND} 0%, ${BRAND_LIGHT} 100%); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 15px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${escapeHtml(input.cta)}</a></div>`
    : "";
  const footer = input.footer
    ? `<p style="margin: 24px 0 0; font-size: 14px; color: ${MUTED}; line-height: 1.6;">${escapeHtml(input.footer)}</p>`
    : "";
  return `
    <p style="margin: 0 0 16px; font-size: 16px; color: ${TEXT_PRIMARY}; line-height: 1.6;">Hi there,</p>
    <p style="margin: 0 0 24px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">${escapeHtml(input.message)}</p>
    ${table}${button}${footer}
  `;
}

/** Plain-text twin of `noticeEmailContent`. */
export function noticeEmailText(input: NoticeEmailInput, linkUrl?: string): string {
  const rows = (input.details ?? [])
    .filter(([, value]) => value && value.trim() !== "")
    .map(([label, value]) => `${label}: ${value}`);
  return [
    "Hi there,",
    "",
    input.message,
    ...(rows.length ? ["", ...rows] : []),
    ...(linkUrl && input.cta ? ["", `${input.cta}: ${linkUrl}`] : []),
    ...(input.footer ? ["", input.footer] : []),
  ].join("\n");
}
