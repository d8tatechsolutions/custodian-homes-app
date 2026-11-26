/**
 * Masks an address for server logs: "jane.doe@example.com" -> "j***@e***.com".
 * Enough to tell recipients apart while debugging, without storing who they are.
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${host ? `${host[0]}***` : "***"}${tld}`;
}

const EMAIL_IN_TEXT = /[^\s<>"'@,;:]+@[^\s<>"'@,;:]+\.[a-z]{2,}/gi;

/** Masks every address inside free text, such as an SMTP error reply. */
export function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_IN_TEXT, (match) => maskEmail(match));
}
