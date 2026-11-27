import { isDuplicateKeyError } from "@/app/api/v1/_helpers";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { addDays, nairobiToday } from "@/lib/maintenance/dates";
import { type NoticeTask, notifyTaskAssigned, notifyVendorJob } from "@/lib/maintenance/notify";
import {
  describeRecurrence,
  dueOccurrences,
  nextRunDate,
  occurrenceDate,
  type RecurrenceEnd,
  type RecurrenceRule,
} from "@/lib/maintenance/recurrence";
import { Task } from "@/models/Task";
import { TaskSchedule } from "@/models/TaskSchedule";

export interface ScheduleDoc {
  _id: unknown;
  ownerId: string;
  propertyId: string;
  title: string;
  category?: string;
  priority: "low" | "medium" | "high";
  notes?: string;
  location?: {
    kind: string;
    blockId?: string;
    floorId?: string;
    unitId?: string;
    commonAreaId?: string;
    label?: string;
  };
  assignee?: { kind: string; userId?: string; vendorId?: string; name?: string };
  rule: RecurrenceRule;
  startDate: string;
  dueAfterDays?: number;
  end: { kind: RecurrenceEnd["kind"]; count?: number | null; until?: string };
  occurrencesCreated: number;
  nextRunDate?: string;
  isActive: boolean;
  createdBy: string;
  createdByRole: string;
}

function endOf(s: ScheduleDoc): RecurrenceEnd {
  return { kind: s.end?.kind ?? "never", count: s.end?.count ?? null, until: s.end?.until ?? "" };
}

/**
 * Creates every due, not-yet-created occurrence of one schedule (idempotent:
 * the unique scheduleId+occurrenceDate index turns a repeat into a no-op),
 * then advances the schedule. Returns how many tasks were created.
 */
export async function generateScheduleOccurrences(
  schedule: ScheduleDoc,
  now = new Date(),
): Promise<number> {
  if (!schedule.isActive) return 0;
  const today = nairobiToday(now);
  const end = endOf(schedule);
  const due = dueOccurrences(
    schedule.startDate,
    schedule.rule,
    end,
    schedule.occurrencesCreated,
    today,
  );
  if (due.length === 0) return 0;

  const scheduleId = String(schedule._id);
  const hasAssignee = schedule.assignee?.kind === "staff" || schedule.assignee?.kind === "vendor";
  let created = 0;
  for (const { day } of due) {
    try {
      const task = await Task.create({
        ownerId: schedule.ownerId,
        propertyId: schedule.propertyId,
        title: schedule.title,
        category: schedule.category ?? "",
        priority: schedule.priority,
        notes: schedule.notes ?? "",
        status: "open",
        dueDate: addDays(day, schedule.dueAfterDays ?? 0),
        scheduledFor: day,
        location: schedule.location?.kind ? schedule.location : undefined,
        assignee: hasAssignee ? schedule.assignee : null,
        assignedTo: schedule.assignee?.kind === "staff" ? (schedule.assignee.userId ?? "") : "",
        assignedToName: hasAssignee ? (schedule.assignee?.name ?? "") : "",
        createdBy: schedule.createdBy,
        createdByRole: schedule.createdByRole,
        createdByName: "Recurring schedule",
        scheduleId,
        occurrenceDate: day,
      });
      created += 1;
      await recordTaskActivity(
        task,
        { userId: "system", role: "system", name: "Recurring schedule" },
        "created",
        `Created by the recurring schedule for ${day}`,
        { scheduleId, occurrenceDate: day },
      );
      const copy = task.toObject() as NoticeTask;
      const system = { userId: "system", role: "system", name: "A recurring schedule" };
      if (copy.assignee?.kind === "staff") await notifyTaskAssigned(copy, system);
      if (copy.assignee?.kind === "vendor") await notifyVendorJob(copy, system, "assigned");
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  const createdCount = due[due.length - 1].n + 1;
  const next = nextRunDate(schedule.startDate, schedule.rule, end, createdCount);
  await TaskSchedule.updateOne(
    { _id: schedule._id, occurrencesCreated: schedule.occurrencesCreated },
    { $set: { occurrencesCreated: createdCount, nextRunDate: next, isActive: next !== "" } },
  );
  return created;
}

/** Daily-job step: every active schedule with an occurrence due by today. */
export async function runDueSchedules(
  now = new Date(),
): Promise<{ schedules: number; created: number }> {
  const today = nairobiToday(now);
  const due = (await TaskSchedule.find({ isActive: true, nextRunDate: { $gt: "", $lte: today } })
    .limit(500)
    .lean()) as ScheduleDoc[];
  let created = 0;
  for (const schedule of due) {
    try {
      created += await generateScheduleOccurrences(schedule, now);
    } catch (error) {
      console.error(
        "[maintenance] schedule failed",
        String(schedule._id),
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { schedules: due.length, created };
}

/**
 * When a paused schedule is resumed, occurrences that fell inside the pause
 * are skipped rather than created all at once: jump to the first occurrence
 * on or after today.
 */
export function resumeIndex(
  schedule: ScheduleDoc,
  now = new Date(),
): { index: number; next: string } {
  const today = nairobiToday(now);
  const end = endOf(schedule);
  let n = schedule.occurrencesCreated;
  for (let guard = 0; guard < 10_000; guard += 1, n += 1) {
    const day = occurrenceDate(schedule.startDate, schedule.rule, n);
    if (day >= today) break;
  }
  return { index: n, next: nextRunDate(schedule.startDate, schedule.rule, end, n) };
}

/** Schedule as returned to the UI, with a plain-English summary. */
export function serializeSchedule(s: ScheduleDoc, titles: Map<string, string>) {
  return {
    ...s,
    _id: String(s._id),
    property: titles.get(s.propertyId) ?? "",
    summary: describeRecurrence(s.rule, {
      kind: s.end?.kind ?? "never",
      count: s.end?.count ?? null,
      until: s.end?.until ?? "",
    }),
  };
}
