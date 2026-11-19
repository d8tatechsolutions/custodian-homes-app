/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken, withParams } from "@/test/utils/api-request";
import { makeObjectId, makeUser } from "@/test/utils/factories";
import {
  buildQuery,
  getModelStubs,
  mockStaffPortfolio,
  resetModelStubs,
} from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/ManagementAssignment", () => ({
  ManagementAssignment: getModelStubs().managementAssignment,
}));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));
vi.mock("@/models/Task", () => ({ Task: getModelStubs().task }));

import { DELETE } from "@/app/api/v1/tasks/[id]/route";

const { user, task, managementAssignment } = getModelStubs();

const ADMIN_ID = makeObjectId("admin");
const OTHER_OWNER_ID = makeObjectId("owner2");
const CUSTODIAN_ID = makeObjectId("custodian");
const CARETAKER_ID = makeObjectId("caretaker");
const PROPERTY_ID = makeObjectId("p1");
const OTHER_PROPERTY_ID = makeObjectId("p2");
const TASK_ID = makeObjectId("task");

function adminUser() {
  return makeUser({ _id: ADMIN_ID, role: "admin" });
}

/** Active admin delegation over the given properties, including `task:manage`. */
function adminScope(propertyIds: string[]) {
  managementAssignment.find.mockReturnValue(
    buildQuery(
      propertyIds.map((propertyId) => ({
        principalUserId: ADMIN_ID,
        accessRole: "admin",
        scopeType: "property",
        propertyId,
        permissions: ["task:manage"],
        status: "active",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: null,
      })),
    ),
  );
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: TASK_ID,
    title: "Fix tap",
    propertyId: PROPERTY_ID,
    ownerId: ADMIN_ID,
    status: "open",
    priority: "medium",
    createdBy: ADMIN_ID,
    createdByRole: "admin",
    dueDate: "2026-01-10T00:00:00.000Z",
    ...overrides,
  };
}

function deleteRequest(token: string) {
  return buildRequest(`/api/v1/tasks/${TASK_ID}`, { method: "DELETE", token });
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("DELETE /api/v1/tasks/[id]", () => {
  beforeEach(() => {
    resetModelStubs();
    task.deleteOne.mockResolvedValue({ deletedCount: 1 });
  });

  it("401 when unauthenticated", async () => {
    const res = await DELETE(
      buildRequest(`/api/v1/tasks/${TASK_ID}`, { method: "DELETE" }),
      withParams(TASK_ID),
    );
    expect(res.status).toBe(401);
    expect(task.deleteOne).not.toHaveBeenCalled();
  });

  it("404 when the task does not exist", async () => {
    user.findById.mockReturnValue(buildQuery(makeUser({ _id: CUSTODIAN_ID, role: "custodian" })));
    mockStaffPortfolio({
      userId: CUSTODIAN_ID,
      role: "custodian",
      ownerId: ADMIN_ID,
      propertyIds: [PROPERTY_ID],
      permissions: ["task:manage"],
    });
    task.findById.mockReturnValue(buildQuery(null));

    const res = await DELETE(deleteRequest(signToken(CUSTODIAN_ID)), withParams(TASK_ID));

    expect(res.status).toBe(404);
    expect(task.deleteOne).not.toHaveBeenCalled();
  });

  it("403 when a custodian deletes another owner's task", async () => {
    user.findById.mockReturnValue(buildQuery(makeUser({ _id: CUSTODIAN_ID, role: "custodian" })));
    // The custodian manages ADMIN_ID's portfolio, so `managedByOwnerId` is ADMIN_ID.
    mockStaffPortfolio({
      userId: CUSTODIAN_ID,
      role: "custodian",
      ownerId: ADMIN_ID,
      propertyIds: [PROPERTY_ID],
      permissions: ["task:manage"],
    });
    task.findById.mockReturnValue(buildQuery(taskRow({ ownerId: OTHER_OWNER_ID })));

    const res = await DELETE(deleteRequest(signToken(CUSTODIAN_ID)), withParams(TASK_ID));

    expect(res.status).toBe(403);
    expect(task.deleteOne).not.toHaveBeenCalled();
  });

  it("lets a custodian delete a task owned by their managing owner", async () => {
    user.findById.mockReturnValue(buildQuery(makeUser({ _id: CUSTODIAN_ID, role: "custodian" })));
    mockStaffPortfolio({
      userId: CUSTODIAN_ID,
      role: "custodian",
      ownerId: ADMIN_ID,
      propertyIds: [PROPERTY_ID],
      permissions: ["task:manage"],
    });
    task.findById.mockReturnValue(buildQuery(taskRow({ ownerId: ADMIN_ID })));

    const res = await DELETE(deleteRequest(signToken(CUSTODIAN_ID)), withParams(TASK_ID));

    expect(res.status).toBe(200);
    expect(task.deleteOne).toHaveBeenCalledWith({
      _id: TASK_ID,
      ownerId: ADMIN_ID,
      propertyId: PROPERTY_ID,
    });
    const body = await json(res);
    expect((body.data as Record<string, unknown>).id).toBe(TASK_ID);
  });

  it("403 when an admin deletes another owner's task with no delegated scope for it", async () => {
    // The admin holds a delegation, but only over OTHER_PROPERTY_ID, and the
    // task belongs to a different owner — neither arm of the predicate matches.
    user.findById.mockReturnValue(buildQuery(adminUser()));
    adminScope([OTHER_PROPERTY_ID]);
    task.findById.mockReturnValue(buildQuery(taskRow({ ownerId: OTHER_OWNER_ID })));

    const res = await DELETE(deleteRequest(signToken(ADMIN_ID)), withParams(TASK_ID));

    expect(res.status).toBe(403);
    expect(task.deleteOne).not.toHaveBeenCalled();
  });

  it("lets an admin delete their own task", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    adminScope([PROPERTY_ID]);
    task.findById.mockReturnValue(buildQuery(taskRow({ ownerId: ADMIN_ID })));

    const res = await DELETE(deleteRequest(signToken(ADMIN_ID)), withParams(TASK_ID));

    expect(res.status).toBe(200);
    expect(task.deleteOne).toHaveBeenCalledWith({
      _id: TASK_ID,
      ownerId: ADMIN_ID,
      propertyId: PROPERTY_ID,
    });
  });

  it("403 when a caretaker deletes a task on an unassigned property", async () => {
    user.findById.mockReturnValue(buildQuery(makeUser({ _id: CARETAKER_ID, role: "caretaker" })));
    mockStaffPortfolio({
      userId: CARETAKER_ID,
      role: "caretaker",
      ownerId: ADMIN_ID,
      propertyIds: [PROPERTY_ID],
      permissions: ["task:manage"],
    });
    task.findById.mockReturnValue(buildQuery(taskRow({ propertyId: OTHER_PROPERTY_ID })));

    const res = await DELETE(deleteRequest(signToken(CARETAKER_ID)), withParams(TASK_ID));

    expect(res.status).toBe(403);
    expect(task.deleteOne).not.toHaveBeenCalled();
  });
});
