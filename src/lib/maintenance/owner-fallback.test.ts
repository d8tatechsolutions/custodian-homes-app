/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildQuery } from "@/test/utils/model-mocks";

const m = vi.hoisted(() => ({
  assignmentFind: vi.fn(),
  userFindById: vi.fn(),
  userCount: vi.fn(),
  unitFindById: vi.fn(),
  taskCreate: vi.fn(),
  activityCreate: vi.fn(),
  complaintUpdate: vi.fn(),
  notifyTaskAssigned: vi.fn(),
}));

vi.mock("@/models/ManagementAssignment", () => ({
  ManagementAssignment: { find: m.assignmentFind, exists: vi.fn() },
}));
vi.mock("@/models/User", () => ({
  User: { findById: m.userFindById, countDocuments: m.userCount },
}));
vi.mock("@/models/Unit", () => ({ Unit: { findById: m.unitFindById } }));
vi.mock("@/models/Vendor", () => ({ Vendor: { findOne: vi.fn() } }));
vi.mock("@/models/Task", () => ({ Task: { create: m.taskCreate } }));
vi.mock("@/models/TaskActivity", () => ({ TaskActivity: { create: m.activityCreate } }));
vi.mock("@/models/Complaint", () => ({ Complaint: { updateOne: m.complaintUpdate } }));
vi.mock("@/lib/maintenance/notify", () => ({ notifyTaskAssigned: m.notifyTaskAssigned }));

const { ownerFallbackAssignee } = await import("@/lib/maintenance/assignee");
const { createTaskForComplaint } = await import("@/lib/maintenance/complaint-task");

const NOW = new Date("2026-11-28T09:00:00Z");
const OWNER = { _id: "owner-1", name: "Wanjiru", isActive: true };

function assignments(rows: unknown[]) {
  m.assignmentFind.mockReturnValue(buildQuery(rows));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.userFindById.mockReturnValue(buildQuery(OWNER));
  m.userCount.mockResolvedValue(0);
  assignments([]);
});

describe("ownerFallbackAssignee", () => {
  it("assigns the owner when nobody manages the property", async () => {
    const result = await ownerFallbackAssignee("prop-1", "owner-1", NOW);
    expect(result).toEqual({
      assignee: { kind: "staff", userId: "owner-1", vendorId: "", name: "Wanjiru" },
      assignedTo: "owner-1",
      assignedToName: "Wanjiru",
    });
    expect(m.assignmentFind).toHaveBeenCalledWith({
      propertyId: "prop-1",
      accessRole: { $in: ["caretaker", "custodian"] },
      status: "active",
    });
  });

  it("returns null when an active caretaker, agent or custodian manages it", async () => {
    assignments([{ principalUserId: "care-1", startsAt: null, endsAt: null }]);
    m.userCount.mockResolvedValue(1);
    expect(await ownerFallbackAssignee("prop-1", "owner-1", NOW)).toBeNull();
    expect(m.userCount).toHaveBeenCalledWith({
      _id: { $in: ["care-1"] },
      isActive: true,
      role: { $in: ["caretaker", "custodian"] },
    });
  });

  it("ignores assignments that have ended, not started, or belong to deactivated staff", async () => {
    assignments([
      { principalUserId: "old", endsAt: new Date("2026-11-01T00:00:00Z") },
      { principalUserId: "future", startsAt: new Date("2026-12-01T00:00:00Z") },
    ]);
    const ended = await ownerFallbackAssignee("prop-1", "owner-1", NOW);
    expect(ended?.assignedTo).toBe("owner-1");
    expect(m.userCount).not.toHaveBeenCalled();

    assignments([{ principalUserId: "deactivated" }]);
    m.userCount.mockResolvedValue(0);
    const inactive = await ownerFallbackAssignee("prop-1", "owner-1", NOW);
    expect(inactive?.assignedTo).toBe("owner-1");
  });

  it("returns null when the owner's account is not active or missing", async () => {
    m.userFindById.mockReturnValue(buildQuery({ ...OWNER, isActive: false }));
    expect(await ownerFallbackAssignee("prop-1", "owner-1", NOW)).toBeNull();
    m.userFindById.mockReturnValue(buildQuery(null));
    expect(await ownerFallbackAssignee("prop-1", "owner-1", NOW)).toBeNull();
  });

  it("returns null without a property or owner", async () => {
    expect(await ownerFallbackAssignee("", "owner-1", NOW)).toBeNull();
    expect(await ownerFallbackAssignee("prop-1", "", NOW)).toBeNull();
    expect(m.assignmentFind).not.toHaveBeenCalled();
  });
});

describe("complaint tasks with no staff on the property", () => {
  const complaint = {
    _id: "c1",
    propertyId: "prop-1",
    ownerId: "owner-1",
    subject: "Leaking tap",
    message: "Kitchen tap drips",
    category: "plumbing",
    priority: "medium" as const,
  };

  it("assigns the owner, records why, and notifies them", async () => {
    m.taskCreate.mockResolvedValue({ _id: "t1", toObject: () => ({ _id: "t1" }) });
    await createTaskForComplaint(complaint, NOW);

    const created = m.taskCreate.mock.calls[0][0];
    expect(created.assignee).toEqual({
      kind: "staff",
      userId: "owner-1",
      vendorId: "",
      name: "Wanjiru",
    });
    expect(created.assignedTo).toBe("owner-1");
    expect(m.activityCreate.mock.calls[0][0].message).toContain(
      "assigned to Wanjiru (no staff manage this property)",
    );
    expect(m.notifyTaskAssigned).toHaveBeenCalledTimes(1);
  });

  it("stays unassigned when a custodian manages the property but no caretaker covers it", async () => {
    // pickCaretakerForComplaint finds no caretaker; the custodian still manages it.
    m.assignmentFind
      .mockReturnValueOnce(buildQuery([]))
      .mockReturnValueOnce(buildQuery([{ principalUserId: "cust-1" }]));
    m.userCount.mockResolvedValue(1);
    m.taskCreate.mockResolvedValue({ _id: "t2", toObject: () => ({ _id: "t2" }) });
    await createTaskForComplaint(complaint, NOW);

    const created = m.taskCreate.mock.calls[0][0];
    expect(created.assignee).toBeNull();
    expect(created.assignedTo).toBe("");
    expect(m.notifyTaskAssigned).not.toHaveBeenCalled();
  });
});
