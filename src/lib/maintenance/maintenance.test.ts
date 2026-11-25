/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardActor } from "@/app/api/v1/_helpers";
import { buildQuery } from "@/test/utils/model-mocks";

const stubs = vi.hoisted(() => ({
  ownership: { find: null as unknown as ReturnType<typeof vi.fn> },
  assignment: {
    findOne: null as unknown as ReturnType<typeof vi.fn>,
    find: null as unknown as ReturnType<typeof vi.fn>,
  },
  unit: { findById: null as unknown as ReturnType<typeof vi.fn> },
  user: { findById: null as unknown as ReturnType<typeof vi.fn> },
}));
vi.mock("@/models/PropertyOwnership", () => {
  stubs.ownership.find = vi.fn();
  return { PropertyOwnership: stubs.ownership };
});
vi.mock("@/models/ManagementAssignment", () => {
  stubs.assignment.findOne = vi.fn();
  stubs.assignment.find = vi.fn();
  return { ManagementAssignment: stubs.assignment };
});
vi.mock("@/models/Unit", () => {
  stubs.unit.findById = vi.fn();
  return { Unit: stubs.unit };
});
vi.mock("@/models/User", () => {
  stubs.user.findById = vi.fn();
  return { User: stubs.user };
});
vi.mock("@/models/Task", () => ({ Task: { create: vi.fn() } }));
vi.mock("@/models/TaskActivity", () => ({ TaskActivity: { create: vi.fn() } }));
vi.mock("@/models/Complaint", () => ({ Complaint: { updateOne: vi.fn() } }));

import { actorCanAccessTask, canAssignToOthers, taskScopeFilter } from "@/lib/maintenance/access";
import { quoteNeedsApproval, resolveCostApprover } from "@/lib/maintenance/approver";
import { complaintTaskDueDate, pickCaretakerForComplaint } from "@/lib/maintenance/complaint-task";
import { addDays, addMonths, isDayString, nairobiToday } from "@/lib/maintenance/dates";
import { resolveTaskLocation } from "@/lib/maintenance/location";
import {
  describeRecurrence,
  dueOccurrences,
  nextRunDate,
  occurrenceDate,
} from "@/lib/maintenance/recurrence";
import { allowedNextStatuses, canTransition, isTaskOverdue } from "@/lib/maintenance/status";

function actor(overrides: Partial<DashboardActor>): DashboardActor {
  return {
    role: "admin",
    userId: "u-admin",
    managedByOwnerId: "",
    assignedPropertyIds: [],
    tenantIds: [],
    tenantPropertyIds: [],
    tenantOwnerIds: [],
    propertyScopeIds: [],
    assignedBlockIds: [],
    assignedUnitIds: [],
    assignedTenantIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dates", () => {
  it("computes the Nairobi calendar day", () => {
    expect(nairobiToday(new Date("2026-11-24T20:59:59Z"))).toBe("2026-11-24");
    expect(nairobiToday(new Date("2026-11-24T21:00:00Z"))).toBe("2026-11-25");
  });
  it("adds days and clamps months to month length", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 2, 31)).toBe("2026-03-31");
  });
  it("validates day strings", () => {
    expect(isDayString("2026-02-28")).toBe(true);
    expect(isDayString("2026-02-30")).toBe(false);
    expect(isDayString("26-2-1")).toBe(false);
  });
});

describe("status rules", () => {
  it("never lets a task waiting for approval be finished by hand", () => {
    expect(canTransition("waiting-approval", "done")).toBe(false);
    expect(allowedNextStatuses("waiting-approval")).toEqual(["cancelled"]);
  });
  it("allows reopening done and cancelled tasks", () => {
    expect(canTransition("done", "open")).toBe(true);
    expect(canTransition("cancelled", "open")).toBe(true);
    expect(canTransition("done", "in-progress")).toBe(false);
  });
  it("derives overdue only for active tasks past their due day", () => {
    expect(isTaskOverdue({ status: "open", dueDate: "2026-11-24" }, "2026-11-25")).toBe(true);
    expect(isTaskOverdue({ status: "open", dueDate: "2026-11-25" }, "2026-11-25")).toBe(false);
    expect(isTaskOverdue({ status: "done", dueDate: "2026-01-01" }, "2026-11-25")).toBe(false);
    expect(isTaskOverdue({ status: "cancelled", dueDate: "2026-01-01" }, "2026-11-25")).toBe(false);
  });
});

describe("recurrence", () => {
  const monthly = { frequency: "monthly" as const, interval: 1 };
  it("anchors monthly occurrences on the start day", () => {
    expect(occurrenceDate("2026-01-31", monthly, 1)).toBe("2026-02-28");
    expect(occurrenceDate("2026-01-31", monthly, 2)).toBe("2026-03-31");
  });
  it("supports every-N intervals and yearly", () => {
    expect(occurrenceDate("2026-01-15", { frequency: "monthly", interval: 3 }, 2)).toBe(
      "2026-07-15",
    );
    expect(occurrenceDate("2026-11-25", { frequency: "weekly", interval: 2 }, 1)).toBe(
      "2026-12-09",
    );
    expect(occurrenceDate("2028-02-29", { frequency: "yearly", interval: 1 }, 1)).toBe(
      "2029-02-28",
    );
  });
  it("stops after a count or an end date", () => {
    expect(nextRunDate("2026-01-01", monthly, { kind: "count", count: 3 }, 3)).toBe("");
    expect(nextRunDate("2026-01-01", monthly, { kind: "count", count: 3 }, 2)).toBe("2026-03-01");
    expect(nextRunDate("2026-01-01", monthly, { kind: "until", until: "2026-02-15" }, 2)).toBe("");
    expect(nextRunDate("2026-01-01", monthly, { kind: "never" }, 100)).toBe("2034-05-01");
  });
  it("lists every due occurrence not yet created, oldest first, with a cap", () => {
    const daily = { frequency: "daily" as const, interval: 1 };
    expect(dueOccurrences("2026-11-20", daily, { kind: "never" }, 3, "2026-11-25")).toEqual([
      { n: 3, day: "2026-11-23" },
      { n: 4, day: "2026-11-24" },
      { n: 5, day: "2026-11-25" },
    ]);
    expect(dueOccurrences("2026-01-01", daily, { kind: "never" }, 0, "2026-11-25", 5)).toHaveLength(
      5,
    );
    expect(dueOccurrences("2026-12-01", daily, { kind: "never" }, 0, "2026-11-25")).toEqual([]);
  });
  it("describes rules in plain words", () => {
    expect(describeRecurrence({ frequency: "daily", interval: 1 }, { kind: "never" })).toBe(
      "Every day",
    );
    expect(
      describeRecurrence({ frequency: "monthly", interval: 3 }, { kind: "count", count: 5 }),
    ).toBe("Every 3 months · 5 times");
    expect(
      describeRecurrence(
        { frequency: "weekly", interval: 1 },
        { kind: "until", until: "2027-01-31" },
      ),
    ).toBe("Every week · until 2027-01-31");
  });
});

describe("access", () => {
  const task = { ownerId: "owner-1", propertyId: "p-1" };
  it("mirrors the v1 scope rules", () => {
    expect(actorCanAccessTask(actor({ userId: "owner-1" }), task)).toBe(true);
    expect(actorCanAccessTask(actor({ userId: "other" }), task)).toBe(false);
    expect(actorCanAccessTask(actor({ userId: "other", propertyScopeIds: ["p-1"] }), task)).toBe(
      true,
    );
    expect(
      actorCanAccessTask(actor({ role: "custodian", managedByOwnerId: "owner-1" }), task),
    ).toBe(true);
    expect(
      actorCanAccessTask(actor({ role: "custodian", managedByOwnerId: "" }), {
        ...task,
        ownerId: "",
      }),
    ).toBe(false);
    expect(
      actorCanAccessTask(actor({ role: "caretaker", assignedPropertyIds: ["p-1"] }), task),
    ).toBe(true);
    expect(
      actorCanAccessTask(actor({ role: "caretaker", assignedPropertyIds: ["p-2"] }), task),
    ).toBe(false);
    expect(actorCanAccessTask(actor({ role: "tenant" }), task)).toBe(false);
    expect(actorCanAccessTask(actor({ role: "system-admin" }), task)).toBe(true);
  });
  it("builds equivalent list filters", () => {
    expect(taskScopeFilter(actor({ userId: "a" }))).toEqual({ ownerId: "a" });
    expect(taskScopeFilter(actor({ role: "caretaker", assignedPropertyIds: [] }))).toBeNull();
    expect(taskScopeFilter(actor({ role: "tenant" }))).toBeNull();
  });
  it("only stops caretakers from assigning others", () => {
    expect(canAssignToOthers(actor({ role: "caretaker" }))).toBe(false);
    expect(canAssignToOthers(actor({ role: "custodian" }))).toBe(true);
  });
});

describe("cost approver", () => {
  it("uses the property's owner admin when no ownership is recorded", async () => {
    stubs.ownership.find.mockReturnValue(buildQuery([]));
    expect(await resolveCostApprover("p-1", "owner-1")).toEqual({
      userId: "owner-1",
      source: "property-owner",
    });
  });
  it("prefers an owner who has an account (primary payee first)", async () => {
    stubs.ownership.find.mockReturnValue(
      buildQuery([
        { holderType: "user", holderUserId: "big", shareBps: 9000 },
        { holderType: "user", holderUserId: "payee", shareBps: 1000, isPrimaryPayee: true },
      ]),
    );
    expect(await resolveCostApprover("p-1", "owner-1")).toEqual({
      userId: "payee",
      source: "owner-account",
    });
  });
  it("falls back to the custodian, then the managing admin, for external owners", async () => {
    stubs.ownership.find.mockReturnValue(buildQuery([{ holderType: "external" }]));
    stubs.assignment.findOne.mockReturnValueOnce(buildQuery({ principalUserId: "cust-1" }));
    expect(await resolveCostApprover("p-1", "agent-1")).toEqual({
      userId: "cust-1",
      source: "custodian",
    });
    stubs.assignment.findOne.mockReturnValueOnce(buildQuery(null));
    expect(await resolveCostApprover("p-1", "agent-1")).toEqual({
      userId: "agent-1",
      source: "managing-admin",
    });
  });
  it("needs approval for every quote until a threshold is set, then only above it", () => {
    expect(quoteNeedsApproval(500, null)).toBe(true);
    expect(quoteNeedsApproval(5000, 5000)).toBe(false);
    expect(quoteNeedsApproval(5001, 5000)).toBe(true);
    expect(quoteNeedsApproval(0, null)).toBe(false);
  });
});

describe("complaint tasks", () => {
  it("sets the due date by priority", () => {
    const now = new Date("2026-11-25T06:00:00Z");
    expect(complaintTaskDueDate("high", now)).toBe("2026-11-26");
    expect(complaintTaskDueDate("medium", now)).toBe("2026-11-28");
    expect(complaintTaskDueDate("low", now)).toBe("2026-12-02");
  });

  it("prefers the unit's caretaker, then the block's, then the property's", async () => {
    stubs.assignment.find.mockReturnValue(
      buildQuery([
        { principalUserId: "prop", scopeType: "property", grantedAt: new Date("2026-01-01") },
        {
          principalUserId: "blk",
          scopeType: "block",
          blockId: "b-1",
          grantedAt: new Date("2026-02-01"),
        },
        { principalUserId: "other-unit", scopeType: "unit", unitId: "u-9" },
      ]),
    );
    stubs.unit.findById.mockReturnValue(buildQuery({ blockId: "b-1" }));
    stubs.user.findById.mockImplementation((id: string) =>
      buildQuery({ name: `Name ${id}`, isActive: true, role: "caretaker" }),
    );
    expect(await pickCaretakerForComplaint("p-1", "u-1")).toEqual({
      userId: "blk",
      name: "Name blk",
    });
  });

  it("skips inactive users and returns null when nobody is responsible", async () => {
    stubs.assignment.find.mockReturnValue(
      buildQuery([
        { principalUserId: "gone", scopeType: "property" },
        { principalUserId: "x", scopeType: "unit", unitId: "u-9" },
      ]),
    );
    stubs.user.findById.mockReturnValue(buildQuery({ isActive: false, role: "caretaker" }));
    expect(await pickCaretakerForComplaint("p-1", undefined)).toBeNull();
  });
});

describe("location", () => {
  const property = {
    blocks: [
      {
        _id: "b-1",
        name: "Block A",
        floors: [
          { _id: "f-3", level: 3 },
          { _id: "f-0", level: 0 },
        ],
      },
    ],
  };
  it("labels units, floors, blocks and common areas", () => {
    const unit = { _id: "u-1", propertyId: "p-1", name: "3B", blockId: "b-1", floorId: "f-3" };
    expect(
      resolveTaskLocation("p-1", { kind: "unit", unitId: "u-1" }, property, unit, []),
    ).toMatchObject({
      kind: "unit",
      label: "Block A › Floor 3 › 3B",
    });
    expect(
      resolveTaskLocation(
        "p-1",
        { kind: "floor", blockId: "b-1", floorId: "f-0" },
        property,
        null,
        [],
      ),
    ).toMatchObject({ label: "Block A › Ground" });
    expect(
      resolveTaskLocation("p-1", { kind: "block", blockId: "b-1" }, property, null, []),
    ).toMatchObject({
      label: "Block A",
    });
    expect(
      resolveTaskLocation("p-1", { kind: "common_area", commonAreaId: "c-1" }, property, null, [
        { _id: "c-1", name: "Main gate" },
      ]),
    ).toMatchObject({ label: "Common area: Main gate" });
  });
  it("rejects locations from another property", () => {
    const foreign = { _id: "u-1", propertyId: "p-2", name: "1A", blockId: "b-1", floorId: "f-3" };
    expect(
      resolveTaskLocation("p-1", { kind: "unit", unitId: "u-1" }, property, foreign, []),
    ).toEqual({
      error: "That unit is not part of this property",
    });
    expect(
      resolveTaskLocation("p-1", { kind: "block", blockId: "nope" }, property, null, []),
    ).toHaveProperty("error");
    expect(
      resolveTaskLocation("p-1", { kind: "common_area", commonAreaId: "c-1" }, property, null, [
        { _id: "c-1", name: "Old", isActive: false },
      ]),
    ).toHaveProperty("error");
  });
});
