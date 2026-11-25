import { addDays, addMonths } from "@/lib/maintenance/dates";
import type { RecurrenceEndKind, RecurrenceFrequency } from "@/lib/maintenance/enums";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
}

export interface RecurrenceEnd {
  kind: RecurrenceEndKind;
  count?: number | null;
  until?: string;
}

/**
 * Date of the n-th occurrence (0-based), always computed from the start date
 * so monthly schedules anchored on the 31st never drift to the 28th.
 */
export function occurrenceDate(startDate: string, rule: RecurrenceRule, n: number): string {
  const step = Math.max(1, Math.floor(rule.interval || 1)) * n;
  const anchorDay = Number(startDate.slice(8, 10));
  switch (rule.frequency) {
    case "daily":
      return addDays(startDate, step);
    case "weekly":
      return addDays(startDate, step * 7);
    case "monthly":
      return addMonths(startDate, step, anchorDay);
    case "yearly":
      return addMonths(startDate, step * 12, anchorDay);
  }
}

/** Whether the schedule may still create occurrence `n` dated `day`. */
export function withinEnd(end: RecurrenceEnd, n: number, day: string): boolean {
  if (end.kind === "count") return n < (end.count ?? 0);
  if (end.kind === "until") return Boolean(end.until) && day <= (end.until as string);
  return true;
}

/** Next occurrence to create after `created` occurrences, or "" if the schedule has ended. */
export function nextRunDate(
  startDate: string,
  rule: RecurrenceRule,
  end: RecurrenceEnd,
  created: number,
): string {
  const day = occurrenceDate(startDate, rule, created);
  return withinEnd(end, created, day) ? day : "";
}

/**
 * Occurrences due by `today` that have not been created yet, oldest first,
 * capped so a long-paused schedule cannot flood the board in one run.
 */
export function dueOccurrences(
  startDate: string,
  rule: RecurrenceRule,
  end: RecurrenceEnd,
  created: number,
  today: string,
  cap = 31,
): { n: number; day: string }[] {
  const out: { n: number; day: string }[] = [];
  for (let n = created; out.length < cap; n += 1) {
    const day = occurrenceDate(startDate, rule, n);
    if (day > today || !withinEnd(end, n, day)) break;
    out.push({ n, day });
  }
  return out;
}

const UNIT: Record<RecurrenceFrequency, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};

/** Plain-English rule, e.g. "Every 3 months · 5 times" or "Every week · until 2027-01-31". */
export function describeRecurrence(rule: RecurrenceRule, end: RecurrenceEnd): string {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  const [one, many] = UNIT[rule.frequency];
  const base =
    interval === 1
      ? rule.frequency === "daily"
        ? "Every day"
        : `Every ${one}`
      : `Every ${interval} ${many}`;
  if (end.kind === "count" && end.count) return `${base} · ${end.count} times`;
  if (end.kind === "until" && end.until) return `${base} · until ${end.until}`;
  return base;
}
