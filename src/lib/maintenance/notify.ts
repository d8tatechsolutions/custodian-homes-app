import { getAppUrl } from "@/lib/brand";
import { isEmailConfigured, sendNotificationEmail } from "@/lib/email";
import { formatKES } from "@/lib/format";
import { recordTaskActivity } from "@/lib/maintenance/activity";
import { addDays, nairobiToday } from "@/lib/maintenance/dates";
import { ACTIVE_TASK_STATUSES } from "@/lib/maintenance/enums";
import { noticeEmailContent, noticeEmailText } from "@/lib/notice-email";
import { notifyUser } from "@/lib/notifications";
import { Complaint } from "@/models/Complaint";
import { ManagementAssignment } from "@/models/ManagementAssignment";
import type { NotificationType } from "@/models/Notification";
import { Task } from "@/models/Task";
import { TaskActivity } from "@/models/TaskActivity";
import { Tenant } from "@/models/Tenant";
import { User } from "@/models/User";
import { Vendor } from "@/models/Vendor";

/**
 * Tasks & Maintenance notifications (Phase 5). In-app rows go through the
 * shared `notifyUser` (deduped per event, respects each person's email
 * setting). Every function is best-effort and never throws: a notice must
 * not break the action that triggered it.
 *
 * What each audience sees is deliberately narrow:
 * - staff: task title, property, location, due date (and the quote amount for
 *   approvers);
 * - tenants: their own complaint subject and progress only — never costs,
 *   staff or service-provider details;
 * - service providers (no account): the job, where, when and who to call.
 */

export interface NoticeTask {
  _id: unknown;
  ownerId: string;
  title: string;
  propertyId: string;
  propertyName?: string;
  location?: { label?: string } | null;
  dueDate?: string;
  scheduledFor?: string;
  priority?: string;
  status?: string;
  notes?: string;
  assignedTo?: string;
  assignee?: { kind?: string; userId?: string; vendorId?: string; name?: string } | null;
  createdBy?: string;
  complaintIds?: string[];
  cost?: { quote?: { amount?: number; by?: string } | null } | null;
}

export interface NoticeActor {
  userId: string;
  role: string;
  name?: string;
}

interface Person {
  id: string;
  role: string;
  name: string;
  email: string;
  phone: string;
  isActive: boolean;
}

const STAFF_DASHBOARDS = new Set(["admin", "custodian", "caretaker"]);

function taskId(task: NoticeTask): string {
  return String(task._id);
}

/** Server-composed deep link for a staff member's task page. */
export function staffTaskPath(role: string, id: string): string {
  if (STAFF_DASHBOARDS.has(role)) return `/dashboard/${role}/tasks/${id}`;
  if (role === "system-admin") return "/dashboard/system-admin";
  return "/dashboard";
}

async function loadPeople(ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  try {
    const users = (await User.find({ _id: { $in: unique } })
      .select("role name email phone isActive")
      .lean()) as {
      _id: unknown;
      role?: string;
      name?: string;
      email?: string;
      phone?: string;
      isActive?: boolean;
    }[];
    return new Map(
      users.map((u) => [
        String(u._id),
        {
          id: String(u._id),
          role: String(u.role ?? ""),
          name: u.name ?? "",
          email: u.email ?? "",
          phone: u.phone ?? "",
          isActive: u.isActive !== false,
        },
      ]),
    );
  } catch {
    console.warn("[task-notify] recipient lookup failed");
    return new Map();
  }
}

function placeOf(task: NoticeTask): string {
  return [task.propertyName, task.location?.label].filter(Boolean).join(" · ");
}

interface StaffNotice {
  type: NotificationType;
  /** Unique per event so a re-run never notifies twice. */
  eventId: string;
  title: string;
  body: string;
  details?: [string, string][];
  cta?: string;
  email: boolean;
}

/** Sends one notice to each active staff recipient, with a link for their role. */
async function sendToStaff(task: NoticeTask, recipientIds: string[], notice: StaffNotice) {
  const people = await loadPeople(recipientIds);
  let sent = 0;
  for (const person of people.values()) {
    if (!person.isActive || !STAFF_DASHBOARDS.has(person.role)) continue;
    const link = staffTaskPath(person.role, taskId(task));
    const linkUrl = `${getAppUrl()}${link}`;
    const content = { message: notice.body, details: notice.details, cta: notice.cta };
    const ok = await notifyUser(person.id, {
      type: notice.type,
      title: notice.title,
      body: notice.body,
      link,
      data: { eventId: notice.eventId, taskId: taskId(task) },
      channels: notice.email ? ["in-app", "email"] : ["in-app"],
      email: notice.email
        ? {
            subjectPrefix: notice.title,
            content: noticeEmailContent(content),
            text: noticeEmailText(content, linkUrl),
            linkUrl,
          }
        : undefined,
    });
    if (ok) sent += 1;
  }
  return sent;
}

function taskDetails(task: NoticeTask): [string, string][] {
  return [
    ["Task", task.title],
    ["Where", placeOf(task)],
    ["Due", task.dueDate ?? ""],
    ["Priority", task.priority ?? ""],
  ];
}

/** A staff member was given a task (not sent when people assign themselves). */
export async function notifyTaskAssigned(task: NoticeTask, actor: NoticeActor): Promise<void> {
  try {
    const assigneeId = task.assignee?.kind === "staff" ? (task.assignee.userId ?? "") : "";
    if (!assigneeId || assigneeId === actor.userId) return;
    await sendToStaff(task, [assigneeId], {
      type: "task:assigned",
      eventId: `task:${taskId(task)}:assigned:${assigneeId}:${Date.now()}`,
      title: `New task: ${task.title}`,
      body: `${actor.name || "Someone"} assigned you "${task.title}"${placeOf(task) ? ` at ${placeOf(task)}` : ""}${task.dueDate ? `, due ${task.dueDate}` : ""}.`,
      details: taskDetails(task),
      cta: "Open task",
      email: true,
    });
  } catch (error) {
    console.warn("[task-notify] assigned failed", error instanceof Error ? error.message : "");
  }
}

/** A quote needs the approver's decision. */
export async function notifyCostAwaitingApproval(
  task: NoticeTask,
  approverUserId: string,
  amount: number,
): Promise<void> {
  try {
    if (!approverUserId) return;
    await sendToStaff(task, [approverUserId], {
      type: "task:cost-approval",
      eventId: `task:${taskId(task)}:quote:${amount}:${Date.now()}`,
      title: `Approval needed: ${task.title}`,
      body: `A quote of ${formatKES(amount)} for "${task.title}" is waiting for your approval.`,
      details: [...taskDetails(task), ["Quote", formatKES(amount)]],
      cta: "Review the quote",
      email: true,
    });
  } catch (error) {
    console.warn("[task-notify] approval failed", error instanceof Error ? error.message : "");
  }
}

/** Tells whoever entered the quote (and the task creator) the decision. */
export async function notifyCostDecided(
  task: NoticeTask,
  actor: NoticeActor,
  approved: boolean,
  note: string,
): Promise<void> {
  try {
    const recipients = [task.cost?.quote?.by ?? "", task.createdBy ?? ""].filter(
      (id) => id && id !== actor.userId,
    );
    if (recipients.length === 0) return;
    const amount = task.cost?.quote?.amount ?? 0;
    await sendToStaff(task, recipients, {
      type: "task:cost-decided",
      eventId: `task:${taskId(task)}:decided:${approved ? "approved" : "rejected"}:${Date.now()}`,
      title: approved ? `Cost approved: ${task.title}` : `Cost rejected: ${task.title}`,
      body: approved
        ? `The ${formatKES(amount)} quote for "${task.title}" was approved. Work can start.`
        : `The ${formatKES(amount)} quote for "${task.title}" was rejected${note ? `: ${note}` : ""}. Get a new quote.`,
      details: taskDetails(task),
      cta: "Open task",
      email: true,
    });
  } catch (error) {
    console.warn("[task-notify] decided failed", error instanceof Error ? error.message : "");
  }
}

/**
 * Emails a service provider their job once work can start (client decision):
 * on assignment when no approval is pending, or when the quote is approved.
 * Sent at most once per provider per reason; recorded in the task history.
 */
export async function notifyVendorJob(
  task: NoticeTask,
  actor: NoticeActor,
  reason: "assigned" | "approved",
): Promise<boolean> {
  try {
    const vendorId = task.assignee?.kind === "vendor" ? (task.assignee.vendorId ?? "") : "";
    if (!vendorId) return false;
    const key = `${vendorId}:${reason}`;
    const already = await TaskActivity.exists({
      taskId: taskId(task),
      kind: "notify",
      "data.vendorJob": key,
    });
    if (already) return false;

    const vendor = (await Vendor.findOne({ _id: vendorId, ownerId: task.ownerId, isActive: true })
      .select("name email")
      .lean()) as { name?: string; email?: string } | null;
    if (!vendor) return false;

    const contact = (await loadPeople([actor.userId])).get(actor.userId);
    const amount = task.cost?.quote?.amount ?? 0;
    const content = {
      message:
        reason === "approved"
          ? `Your quote for "${task.title}" has been approved. Please go ahead with the job.`
          : `You have a new job: "${task.title}".`,
      details: [
        ["Job", task.title],
        ["Where", placeOf(task)],
        ["Due", task.dueDate ?? ""],
        ["Scheduled", task.scheduledFor ?? ""],
        ["Details", task.notes ?? ""],
        ["Approved amount", reason === "approved" && amount ? formatKES(amount) : ""],
        ["Contact", [contact?.name, contact?.phone].filter(Boolean).join(", ")],
      ] as [string, string][],
      footer: "Reply to the contact above with any questions about this job.",
    };

    let emailed = false;
    if (vendor.email && isEmailConfigured()) {
      emailed = await sendNotificationEmail({
        to: vendor.email,
        subjectPrefix:
          reason === "approved" ? `Job approved: ${task.title}` : `New job: ${task.title}`,
        content: noticeEmailContent(content),
        text: noticeEmailText(content),
        linkUrl: getAppUrl(),
      });
    }
    await recordTaskActivity(
      task,
      actor,
      "notify",
      emailed
        ? `Emailed ${vendor.name || "the service provider"} the job details`
        : `${vendor.name || "The service provider"} has no email; call them with the job details`,
      { vendorJob: key, emailed },
    );
    return emailed;
  } catch (error) {
    console.warn("[task-notify] vendor failed", error instanceof Error ? error.message : "");
    return false;
  }
}

async function tenantRecipients(
  complaintIds: string[],
): Promise<{ userId: string; complaintId: string; subject: string }[]> {
  if (complaintIds.length === 0) return [];
  const complaints = (await Complaint.find({ _id: { $in: complaintIds } })
    .select("tenantId subject")
    .lean()) as { _id: unknown; tenantId?: string; subject?: string }[];
  const tenants = (await Tenant.find({
    _id: { $in: [...new Set(complaints.map((c) => c.tenantId).filter(Boolean))] },
  })
    .select("userId")
    .lean()) as { _id: unknown; userId?: string }[];
  const userByTenant = new Map(tenants.map((t) => [String(t._id), t.userId ?? ""]));
  return complaints
    .map((c) => ({
      userId: userByTenant.get(String(c.tenantId)) ?? "",
      complaintId: String(c._id),
      subject: c.subject ?? "your request",
    }))
    .filter((r) => r.userId);
}

/** Tenant progress on their own complaint: work started, or done ("is it fixed?"). */
export async function notifyTenantProgress(
  task: NoticeTask,
  stage: "started" | "done",
): Promise<void> {
  try {
    const recipients = await tenantRecipients(task.complaintIds ?? []);
    for (const r of recipients) {
      await notifyUser(r.userId, {
        type: "task:update",
        title: stage === "done" ? "Work completed — is it fixed?" : "Work has started",
        body:
          stage === "done"
            ? `The work on "${r.subject}" is done. Let us know if it's fixed.`
            : `Work on "${r.subject}" has started.`,
        link: "/dashboard/tenant/requests",
        data: { eventId: `complaint:${r.complaintId}:task:${taskId(task)}:${stage}:${Date.now()}` },
        channels: ["in-app"],
      });
    }
  } catch (error) {
    console.warn("[task-notify] tenant failed", error instanceof Error ? error.message : "");
  }
}

/** A tenant said the issue is not fixed: tell the assignee, creator and owner. */
export async function notifyTaskNotFixed(task: NoticeTask, note: string): Promise<void> {
  try {
    const recipients = [
      task.assignee?.kind === "staff" ? (task.assignee.userId ?? "") : "",
      task.createdBy ?? "",
      task.ownerId,
    ];
    await sendToStaff(task, recipients, {
      type: "task:update",
      eventId: `task:${taskId(task)}:not-fixed:${Date.now()}`,
      title: `Not fixed: ${task.title}`,
      body: `The tenant says "${task.title}" is not fixed${note ? `: ${note}` : ""}. The task was reopened.`,
      details: taskDetails(task),
      cta: "Open task",
      email: true,
    });
  } catch (error) {
    console.warn("[task-notify] not-fixed failed", error instanceof Error ? error.message : "");
  }
}

async function custodiansOf(propertyIds: string[]): Promise<Map<string, string[]>> {
  if (propertyIds.length === 0) return new Map();
  const rows = (await ManagementAssignment.find({
    propertyId: { $in: propertyIds },
    accessRole: "custodian",
    status: "active",
  })
    .select("propertyId principalUserId")
    .lean()) as { propertyId?: string; principalUserId?: string }[];
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const key = String(row.propertyId ?? "");
    map.set(key, [...(map.get(key) ?? []), String(row.principalUserId ?? "")]);
  }
  return map;
}

/** Keeps one run well inside the daily job's time limit (oldest due first). */
const REMINDER_BATCH = 300;

/** Due dates are "YYYY-MM-DD"; older tasks may carry a time part. */
function dueDay(task: NoticeTask): string {
  return (task.dueDate ?? "").slice(0, 10);
}

/**
 * Daily-job step: "due tomorrow" and "due today" reminders to the assignee,
 * and a daily "overdue" alert to the assignee, the owner and the property's
 * custodians. Keyed per task per day, so a second run the same day sends
 * nothing new.
 */
export async function runTaskReminders(now = new Date(), budgetMs = 40_000) {
  const startedAt = Date.now();
  const today = nairobiToday(now);
  const tomorrow = addDays(today, 1);
  const tasks = (await Task.find({
    status: { $in: [...ACTIVE_TASK_STATUSES] },
    // String range: anything on or before tomorrow, with or without a time part.
    dueDate: { $lt: addDays(today, 2), $gt: "" },
  })
    .sort({ dueDate: 1 })
    .select(
      "ownerId title propertyId propertyName location dueDate priority status assignee assignedTo createdBy",
    )
    .limit(REMINDER_BATCH)
    .lean()) as NoticeTask[];

  const overdueTasks = tasks.filter((t) => dueDay(t) < today);
  const custodians = await custodiansOf([...new Set(overdueTasks.map((t) => t.propertyId))]);
  const counts = { dueTomorrow: 0, dueToday: 0, overdue: 0, scanned: tasks.length, deferred: 0 };

  for (const [index, task] of tasks.entries()) {
    // Emails go out one by one; stop before the job's time limit. Overdue
    // alerts repeat daily, so anything deferred is picked up tomorrow.
    if (Date.now() - startedAt > budgetMs) {
      counts.deferred = tasks.length - index;
      break;
    }
    const due = dueDay(task);
    const assigneeId = task.assignee?.kind === "staff" ? (task.assignee.userId ?? "") : "";
    if (due === tomorrow || due === today) {
      if (!assigneeId) continue;
      const tomorrowCase = due === tomorrow;
      counts[tomorrowCase ? "dueTomorrow" : "dueToday"] += await sendToStaff(task, [assigneeId], {
        type: "task:reminder",
        eventId: `task:${taskId(task)}:${tomorrowCase ? "due-tomorrow" : "due-today"}:${due}`,
        title: tomorrowCase ? `Due tomorrow: ${task.title}` : `Due today: ${task.title}`,
        body: `"${task.title}"${placeOf(task) ? ` at ${placeOf(task)}` : ""} is due ${tomorrowCase ? "tomorrow" : "today"}.`,
        details: taskDetails(task),
        cta: "Open task",
        email: true,
      });
      continue;
    }
    const recipients = [assigneeId, task.ownerId, ...(custodians.get(task.propertyId) ?? [])];
    counts.overdue += await sendToStaff(task, recipients, {
      type: "task:reminder",
      eventId: `task:${taskId(task)}:overdue:${today}`,
      title: `Overdue: ${task.title}`,
      body: `"${task.title}"${placeOf(task) ? ` at ${placeOf(task)}` : ""} was due ${due} and is still ${task.status === "open" ? "open" : "not done"}.`,
      details: [...taskDetails(task), ["Assigned to", task.assignee?.name ?? "Nobody yet"]],
      cta: "Open task",
      email: true,
    });
  }
  return counts;
}
