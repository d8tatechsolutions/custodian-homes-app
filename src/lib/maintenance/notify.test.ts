/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildQuery } from "@/test/utils/model-mocks";

const m = vi.hoisted(() => {
  const model = () => ({
    find: vi.fn(),
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
  });
  return {
    user: model(),
    vendor: model(),
    task: model(),
    activity: model(),
    complaint: model(),
    tenant: model(),
    assignment: model(),
    notifyUser: vi.fn(),
    sendNotificationEmail: vi.fn(),
    recordTaskActivity: vi.fn(),
  };
});

vi.mock("@/models/User", () => ({ User: m.user }));
vi.mock("@/models/Vendor", () => ({ Vendor: m.vendor }));
vi.mock("@/models/Task", () => ({ Task: m.task }));
vi.mock("@/models/TaskActivity", () => ({ TaskActivity: m.activity }));
vi.mock("@/models/Complaint", () => ({ Complaint: m.complaint }));
vi.mock("@/models/Tenant", () => ({ Tenant: m.tenant }));
vi.mock("@/models/ManagementAssignment", () => ({ ManagementAssignment: m.assignment }));
vi.mock("@/lib/notifications", () => ({ notifyUser: m.notifyUser }));
vi.mock("@/lib/maintenance/activity", () => ({ recordTaskActivity: m.recordTaskActivity }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendNotificationEmail: m.sendNotificationEmail,
}));

const {
  notifyTaskAssigned,
  notifyVendorJob,
  notifyTenantProgress,
  notifyCostAwaitingApproval,
  runTaskReminders,
  staffTaskPath,
} = await import("@/lib/maintenance/notify");

const task = {
  _id: "t1",
  ownerId: "owner-1",
  title: "Fix the gate",
  propertyId: "p1",
  propertyName: "Palm Court",
  location: { label: "Block A" },
  dueDate: "2026-11-27",
  priority: "high",
  notes: "Hinge broken",
  assignee: { kind: "staff", userId: "care-1", name: "Amka" },
  createdBy: "owner-1",
  complaintIds: [] as string[],
  cost: { quote: { amount: 4500, by: "care-1" } },
};
const actor = { userId: "owner-1", role: "admin", name: "Grace" };

function people(rows: Record<string, unknown>[]) {
  m.user.find.mockReturnValue(buildQuery(rows));
}

beforeEach(() => {
  for (const model of [m.user, m.vendor, m.task, m.activity, m.complaint, m.tenant, m.assignment]) {
    for (const fn of Object.values(model)) fn.mockReset();
  }
  m.notifyUser.mockReset().mockResolvedValue(true);
  m.sendNotificationEmail.mockReset().mockResolvedValue(true);
  m.recordTaskActivity.mockReset();
});

describe("links", () => {
  it("points each staff role at its own task page", () => {
    expect(staffTaskPath("caretaker", "t1")).toBe("/dashboard/caretaker/tasks/t1");
    expect(staffTaskPath("custodian", "t1")).toBe("/dashboard/custodian/tasks/t1");
    expect(staffTaskPath("admin", "t1")).toBe("/dashboard/admin/tasks/t1");
    expect(staffTaskPath("tenant", "t1")).toBe("/dashboard");
  });
});

describe("notifyTaskAssigned", () => {
  it("emails and notifies the assignee with a link for their role", async () => {
    people([{ _id: "care-1", role: "caretaker", name: "Amka", isActive: true }]);
    await notifyTaskAssigned(task, actor);
    expect(m.notifyUser).toHaveBeenCalledTimes(1);
    const [userId, input] = m.notifyUser.mock.calls[0];
    expect(userId).toBe("care-1");
    expect(input).toMatchObject({
      type: "task:assigned",
      link: "/dashboard/caretaker/tasks/t1",
      channels: ["in-app", "email"],
    });
    expect(input.email.content).toContain("Palm Court · Block A");
  });

  it("stays quiet when people assign themselves", async () => {
    await notifyTaskAssigned(task, { ...actor, userId: "care-1" });
    expect(m.notifyUser).not.toHaveBeenCalled();
  });

  it("skips inactive and non-staff accounts", async () => {
    people([{ _id: "care-1", role: "tenant", isActive: true }]);
    await notifyTaskAssigned(task, actor);
    people([{ _id: "care-1", role: "caretaker", isActive: false }]);
    await notifyTaskAssigned(task, actor);
    expect(m.notifyUser).not.toHaveBeenCalled();
  });

  it("escapes task text in the email", async () => {
    people([{ _id: "care-1", role: "caretaker", isActive: true }]);
    await notifyTaskAssigned({ ...task, title: "<script>x</script>" }, actor);
    expect(m.notifyUser.mock.calls[0][1].email.content).not.toContain("<script>");
  });
});

describe("notifyCostAwaitingApproval", () => {
  it("tells the approver the amount", async () => {
    people([{ _id: "owner-1", role: "admin", isActive: true }]);
    await notifyCostAwaitingApproval(task, "owner-1", 4500);
    expect(m.notifyUser.mock.calls[0][1]).toMatchObject({
      type: "task:cost-approval",
      link: "/dashboard/admin/tasks/t1",
    });
    expect(m.notifyUser.mock.calls[0][1].body).toContain("4,500");
  });
});

describe("notifyVendorJob", () => {
  const vendorTask = { ...task, assignee: { kind: "vendor", vendorId: "v1", name: "FixIt" } };

  it("emails the provider once, scoped to the owner's own list, and records it", async () => {
    m.activity.exists.mockResolvedValue(null);
    m.vendor.findOne.mockReturnValue(buildQuery({ name: "FixIt", email: "jobs@fixit.test" }));
    people([{ _id: "owner-1", role: "admin", name: "Grace", phone: "+254700000001" }]);
    const sent = await notifyVendorJob(vendorTask, actor, "assigned");
    expect(sent).toBe(true);
    expect(m.vendor.findOne).toHaveBeenCalledWith({
      _id: "v1",
      ownerId: "owner-1",
      isActive: true,
    });
    const email = m.sendNotificationEmail.mock.calls[0][0];
    expect(email.to).toBe("jobs@fixit.test");
    expect(email.content).toContain("Grace, +254700000001");
    expect(email.content).not.toContain("4,500");
    expect(m.recordTaskActivity).toHaveBeenCalledWith(
      vendorTask,
      actor,
      "notify",
      expect.stringContaining("Emailed FixIt"),
      { vendorJob: "v1:assigned", emailed: true },
    );
  });

  it("includes the approved amount only for approvals", async () => {
    m.activity.exists.mockResolvedValue(null);
    m.vendor.findOne.mockReturnValue(buildQuery({ name: "FixIt", email: "jobs@fixit.test" }));
    people([]);
    await notifyVendorJob(vendorTask, actor, "approved");
    expect(m.sendNotificationEmail.mock.calls[0][0].content).toContain("4,500");
  });

  it("does not send twice for the same reason", async () => {
    m.activity.exists.mockResolvedValue({ _id: "a" });
    expect(await notifyVendorJob(vendorTask, actor, "assigned")).toBe(false);
    expect(m.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it("records a call-them note when the provider has no email", async () => {
    m.activity.exists.mockResolvedValue(null);
    m.vendor.findOne.mockReturnValue(buildQuery({ name: "FixIt", email: "" }));
    people([]);
    expect(await notifyVendorJob(vendorTask, actor, "assigned")).toBe(false);
    expect(m.recordTaskActivity.mock.calls[0][3]).toContain("has no email");
  });
});

describe("notifyTenantProgress", () => {
  it("sends the tenant an in-app update about their own complaint only", async () => {
    m.complaint.find.mockReturnValue(
      buildQuery([{ _id: "c1", tenantId: "ten-1", subject: "Leaking tap" }]),
    );
    m.tenant.find.mockReturnValue(buildQuery([{ _id: "ten-1", userId: "tenant-user" }]));
    await notifyTenantProgress({ ...task, complaintIds: ["c1"] }, "done");
    const [userId, input] = m.notifyUser.mock.calls[0];
    expect(userId).toBe("tenant-user");
    expect(input).toMatchObject({
      type: "task:update",
      link: "/dashboard/tenant/requests",
      channels: ["in-app"],
    });
    expect(input.body).toContain("Leaking tap");
    expect(JSON.stringify(input)).not.toMatch(/4,?500|Amka|Grace/);
  });
});

describe("runTaskReminders", () => {
  const NOW = new Date("2026-11-26T03:00:00Z"); // 06:00 in Nairobi on the 26th

  it("sends due-tomorrow, due-today and overdue notices to the right people", async () => {
    m.task.find.mockReturnValue(
      buildQuery([
        { ...task, _id: "a", dueDate: "2026-11-27" },
        { ...task, _id: "b", dueDate: "2026-11-26T00:00:00.000Z" },
        { ...task, _id: "c", dueDate: "2026-11-20", status: "open" },
      ]),
    );
    m.assignment.find.mockReturnValue(
      buildQuery([{ propertyId: "p1", principalUserId: "cust-1" }]),
    );
    m.user.find.mockImplementation((query: { _id: { $in: string[] } }) =>
      buildQuery(
        query._id.$in.map((id) => ({
          _id: id,
          role: id === "owner-1" ? "admin" : id === "cust-1" ? "custodian" : "caretaker",
          isActive: true,
        })),
      ),
    );
    const counts = await runTaskReminders(NOW);
    expect(counts).toMatchObject({ dueTomorrow: 1, dueToday: 1, overdue: 3, deferred: 0 });
    const titles = m.notifyUser.mock.calls.map((c) => c[1].title);
    expect(titles).toContain("Due tomorrow: Fix the gate");
    expect(titles).toContain("Due today: Fix the gate");
    const overdueTo = m.notifyUser.mock.calls
      .filter((c) => c[1].title.startsWith("Overdue"))
      .map((c) => c[0])
      .sort();
    expect(overdueTo).toEqual(["care-1", "cust-1", "owner-1"]);
    const overdue = m.notifyUser.mock.calls.find((c) => c[1].title.startsWith("Overdue"));
    expect(overdue?.[1].data.eventId).toBe("task:c:overdue:2026-11-26");
  });

  it("stops before the time budget and reports what is left", async () => {
    m.task.find.mockReturnValue(
      buildQuery([
        { ...task, _id: "a" },
        { ...task, _id: "b" },
      ]),
    );
    m.assignment.find.mockReturnValue(buildQuery([]));
    const counts = await runTaskReminders(NOW, -1);
    expect(counts.deferred).toBe(2);
    expect(m.notifyUser).not.toHaveBeenCalled();
  });
});
