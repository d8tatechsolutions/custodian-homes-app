/**
 * Calendar helpers on Nairobi days (UTC+3, no daylight saving), expressed as
 * YYYY-MM-DD strings so they compare lexically and never shift with the
 * server's timezone.
 */

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDayString(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function nairobiToday(now = new Date()): string {
  return new Date(now.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Adds whole months keeping the anchor day-of-month, clamped to the month's
 * length (Jan 31 + 1 month = Feb 28/29, + 2 months = Mar 31).
 */
export function addMonths(day: string, months: number, anchorDay?: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();
  const dom = Math.min(anchorDay ?? d, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, dom)).toISOString().slice(0, 10);
}
