/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken, withParams } from "@/test/utils/api-request";
import { makeObjectId, makeTask, makeUser } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));
vi.mock("@/models/Task", () => ({ Task: getModelStubs().task }));
vi.mock("@/models/ManagementAssignment", () => ({
  ManagementAssignment: getModelStubs().managementAssignment,
}));

import { GET as getTaskById, PATCH as patchTask } from "@/app/api/v1/tasks/[id]/route";
import { GET, POST } from "@/app/api/v1/tasks/route";

const { user, property, task, managementAssignment } = getModelStubs();

const ADMIN_ID = makeObjectId("admin");
const OTHER_ADMIN_ID = makeObjectId("admin2");
const CARETAKER_ID = makeObjectId("caretaker");
const TASK_ID = makeObjectId("task");
const PROPERTY_ID = makeObjectId("prop");
const OTHER_PROPERTY_ID = makeObjectId("prop2");

function adminUser() {
  return makeUser({ _id: ADMIN_ID, role: "admin" });
}

/** Explicit fail-closed scope: portfolio permission passes, delegation is empty. */
function noAssignment() {
  managementAssignment.find.mockReturnValue(buildQuery([]));
}

function adminAssignment() {
  managementAssignment.find.mockReturnValue(
    buildQuery([
      {
        principalUserId: ADMIN_ID,
        accessRole: "admin",
        scopeType: "property",
        propertyId: PROPERTY_ID,
        permissions: ["task:read-own", "task:create", "task:manage"],
        status: "active",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: null,
      },
    ]),
  );
}

/**
 * Assignment rows for caretaker/custodian actors. `task:create` is granted
 * explicitly because the shared `ALL_ACTIONS` fixture list predates tasks.
 */
function staffAssignments(input: {
  userId: string;
  role: "caretaker" | "custodian";
  propertyIds: string[];
  permissions: string[];
}) {
  managementAssignment.find.mockReturnValue(
    buildQuery(
      input.propertyIds.map((propertyId) => ({
        principalUserId: input.userId,
        accessRole: input.role,
        scopeType: "property",
        propertyId,
        permissions: [...input.permissions],
        status: "active",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: null,
      })),
    ),
  );
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/v1/tasks", () => {
  beforeEach(() => {
    resetModelStubs();
  });

  it("401 when unauthenticated", async () => {
    const res = await GET(buildRequest("/api/v1/tasks"));
    expect(res.status).toBe(401);
  });

  it("400 for an invalid status filter", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    adminAssignment();
    task.find.mockReturnValue(buildQuery([]).sort({ createdAt: -1 }).skip(0).limit(20));
    task.countDocuments.mockResolvedValue(0);
    property.find.mockReturnValue(buildQuery([]));

    const res = await GET(
      buildRequest("/api/v1/tasks?status=bogus", { token: signToken(ADMIN_ID) }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("Invalid task status");
  });

  it("admin scopes to assigned properties and enriches the title", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    adminAssignment();
    const row = {
      _id: TASK_ID,
      title: "Fix tap",
      propertyId: PROPERTY_ID,
      ownerId: ADMIN_ID,
      status: "open",
      priority: "medium",
      createdBy: ADMIN_ID,
      createdByRole: "admin",
      dueDate: "2026-01-10T00:00:00.000Z",
    };
    task.find.mockReturnValue(buildQuery([row]).sort({ createdAt: -1 }).skip(0).limit(20));
    task.countDocuments.mockResolvedValue(1);
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, title: "Sunlit Studio" }]));

    const res = await GET(buildRequest("/api/v1/tasks", { token: signToken(ADMIN_ID) }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const data = body.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]._id).toBe(TASK_ID);
    expect(data[0].property).toBe("Sunlit Studio");
  });

  it("admin with no assignment lists only own tasks, with no delegated $or clause", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    noAssignment();
    task.find.mockReturnValue(buildQuery([]).sort({ createdAt: -1 }).skip(0).limit(10));
    task.countDocuments.mockResolvedValue(0);

    const res = await GET(buildRequest("/api/v1/tasks", { token: signToken(ADMIN_ID) }));
    expect(res.status).toBe(200);
    // Ownership alone scopes the read — there is no union branch that could
    // surface another owner's rows for an admin without an active delegation.
    expect(task.find).toHaveBeenCalledWith({ ownerId: ADMIN_ID });
    expect(task.countDocuments).toHaveBeenCalledWith({ ownerId: ADMIN_ID });
    const body = await json(res);
    expect(body.data).toEqual([]);
    expect(body.pagination).toMatchObject({ page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  it("admin with no assignment creates a task on their own property", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    noAssignment();
    property.findOne.mockReturnValue(buildQuery({ _id: PROPERTY_ID, ownerId: ADMIN_ID }));
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, title: "Sunlit Studio" }]));
    const created = makeTask({ _id: TASK_ID, propertyId: PROPERTY_ID, ownerId: ADMIN_ID });
    task.create.mockResolvedValue({ ...created, toObject: () => created });

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        token: signToken(ADMIN_ID),
        headers: { "x-forwarded-for": "203.0.113.21" },
        body: {
          title: created.title,
          propertyId: PROPERTY_ID,
          priority: "medium",
          status: "open",
          dueDate: created.dueDate,
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(task.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: ADMIN_ID, propertyId: PROPERTY_ID }),
    );
    const body = await json(res);
    expect((body.data as Record<string, unknown>).ownerId).toBe(ADMIN_ID);
  });

  it("admin with no assignment reads their own task by id", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    noAssignment();
    task.findById.mockReturnValue(
      buildQuery(makeTask({ _id: TASK_ID, ownerId: ADMIN_ID, propertyId: PROPERTY_ID })),
    );
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, title: "Sunlit Studio" }]));

    const res = await getTaskById(
      buildRequest(`/api/v1/tasks/${TASK_ID}`, { token: signToken(ADMIN_ID) }),
      withParams(TASK_ID),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.data as Record<string, unknown>).ownerId).toBe(ADMIN_ID);
    expect((body.data as Record<string, unknown>).property).toBe("Sunlit Studio");
  });

  it("admin with no assignment patches their own task", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    noAssignment();
    const own = makeTask({ _id: TASK_ID, ownerId: ADMIN_ID, propertyId: PROPERTY_ID });
    task.findById.mockReturnValue(buildQuery(own));
    const updated = { ...own, title: "Updated by owner" };
    task.findOneAndUpdate.mockReturnValue(buildQuery(updated));
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, title: "Sunlit Studio" }]));

    const res = await patchTask(
      buildRequest(`/api/v1/tasks/${TASK_ID}`, {
        method: "PATCH",
        token: signToken(ADMIN_ID),
        body: { title: "Updated by owner" },
      }),
      withParams(TASK_ID),
    );
    expect(res.status).toBe(200);
    expect(task.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: TASK_ID, ownerId: ADMIN_ID, propertyId: PROPERTY_ID },
      expect.objectContaining({ title: "Updated by owner" }),
      { new: true, runValidators: true },
    );
    const body = await json(res);
    expect((body.data as Record<string, unknown>).title).toBe("Updated by owner");
  });

  it("admin with an assignment that grants no task action still lists only own tasks", async () => {
    // The assignment is active but carries only tenant:manage, so the
    // task:read-own scope has no delegated properties to union with ownership.
    user.findById.mockReturnValue(buildQuery(adminUser()));
    managementAssignment.find.mockReturnValue(
      buildQuery([
        {
          principalUserId: ADMIN_ID,
          accessRole: "admin",
          scopeType: "property",
          propertyId: PROPERTY_ID,
          permissions: ["tenant:manage"],
          status: "active",
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: null,
        },
      ]),
    );
    task.find.mockReturnValue(buildQuery([]).sort({ createdAt: -1 }).skip(0).limit(10));
    task.countDocuments.mockResolvedValue(0);

    const res = await GET(buildRequest("/api/v1/tasks", { token: signToken(ADMIN_ID) }));
    expect(res.status).toBe(200);
    expect(task.find).toHaveBeenCalledWith({ ownerId: ADMIN_ID });
    expect(task.countDocuments).toHaveBeenCalledWith({ ownerId: ADMIN_ID });
    const body = await json(res);
    expect(body.data).toEqual([]);
  });
});

describe("POST /api/v1/tasks", () => {
  beforeEach(() => {
    resetModelStubs();
  });

  it("401 when unauthenticated", async () => {
    const res = await POST(buildRequest("/api/v1/tasks", { method: "POST", body: {} }));
    expect(res.status).toBe(401);
  });

  it("400 on invalid payload", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    adminAssignment();

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        body: { title: "" },
        token: signToken(ADMIN_ID),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a task and returns 201", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    adminAssignment();
    const created = {
      _id: TASK_ID,
      title: "Fix tap",
      propertyId: PROPERTY_ID,
      ownerId: ADMIN_ID,
      status: "open",
      priority: "medium",
      createdBy: ADMIN_ID,
      createdByRole: "admin",
      createdByName: "Admin User",
      dueDate: "2026-01-10T00:00:00.000Z",
      toObject: () => ({
        _id: TASK_ID,
        title: "Fix tap",
        propertyId: PROPERTY_ID,
        ownerId: ADMIN_ID,
        status: "open",
        priority: "medium",
        createdBy: ADMIN_ID,
        createdByRole: "admin",
        createdByName: "Admin User",
        dueDate: "2026-01-10T00:00:00.000Z",
      }),
    };
    task.create.mockResolvedValue(created);
    // POST resolves the target property through `findOne({ _id, deletedAt }).select().lean()`
    // before the create-scope check; ADMIN_ID satisfies the admin predicate (owner-or-scope).
    property.findOne.mockReturnValue(buildQuery({ _id: PROPERTY_ID, ownerId: ADMIN_ID }));
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, title: "Sunlit Studio" }]));

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        body: {
          title: "Fix tap",
          propertyId: PROPERTY_ID,
          priority: "medium",
          status: "open",
          dueDate: "2026-01-10",
        },
        token: signToken(ADMIN_ID),
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect((body.data as Record<string, unknown>).title).toBe("Fix tap");
  });

  it("403 when an admin creates a task on a property they neither own nor hold scope on", async () => {
    // The admin's only delegation covers PROPERTY_ID; the write targets
    // OTHER_PROPERTY_ID, which is owned by someone else.
    user.findById.mockReturnValue(buildQuery(adminUser()));
    adminAssignment();
    property.findOne.mockReturnValue(
      buildQuery({ _id: OTHER_PROPERTY_ID, ownerId: OTHER_ADMIN_ID }),
    );

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        body: {
          title: "Fix tap",
          propertyId: OTHER_PROPERTY_ID,
          priority: "medium",
          status: "open",
          dueDate: "2026-01-10",
        },
        token: signToken(ADMIN_ID),
      }),
    );

    expect(res.status).toBe(403);
    // The property load ran, so the denial is the create-scope predicate and
    // not the portfolio permission gate.
    expect(property.findOne).toHaveBeenCalled();
    expect(task.create).not.toHaveBeenCalled();
  });

  it("403 when a caretaker creates a task on a property outside their assignments", async () => {
    user.findById.mockReturnValue(buildQuery(makeUser({ _id: CARETAKER_ID, role: "caretaker" })));
    staffAssignments({
      userId: CARETAKER_ID,
      role: "caretaker",
      propertyIds: [PROPERTY_ID],
      permissions: ["task:create"],
    });
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_ID, ownerId: ADMIN_ID }]));
    property.findOne.mockReturnValue(buildQuery({ _id: OTHER_PROPERTY_ID, ownerId: ADMIN_ID }));

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        body: {
          title: "Fix tap",
          propertyId: OTHER_PROPERTY_ID,
          priority: "medium",
          status: "open",
          dueDate: "2026-01-10",
        },
        token: signToken(CARETAKER_ID),
      }),
    );

    expect(res.status).toBe(403);
    expect(task.create).not.toHaveBeenCalled();
  });

  it("400 when the target property is missing or soft-deleted", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    adminAssignment();
    // `findOne` matches `{ _id, deletedAt: null }`, so a soft-deleted row yields null here too.
    property.findOne.mockReturnValue(buildQuery(null));

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        body: {
          title: "Fix tap",
          propertyId: OTHER_PROPERTY_ID,
          priority: "medium",
          status: "open",
          dueDate: "2026-01-10",
        },
        token: signToken(ADMIN_ID),
      }),
    );

    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("Property not found");
    expect(task.create).not.toHaveBeenCalled();
  });

  it("400 when a caretaker omits the property and has more than one in scope", async () => {
    user.findById.mockReturnValue(buildQuery(makeUser({ _id: CARETAKER_ID, role: "caretaker" })));
    staffAssignments({
      userId: CARETAKER_ID,
      role: "caretaker",
      propertyIds: [PROPERTY_ID, OTHER_PROPERTY_ID],
      permissions: ["task:create"],
    });
    property.find.mockReturnValue(
      buildQuery([
        { _id: PROPERTY_ID, ownerId: ADMIN_ID },
        { _id: OTHER_PROPERTY_ID, ownerId: ADMIN_ID },
      ]),
    );

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        body: {
          title: "Fix tap",
          priority: "medium",
          status: "open",
          dueDate: "2026-01-10",
        },
        token: signToken(CARETAKER_ID),
      }),
    );

    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("A property must be specified");
    expect(property.findOne).not.toHaveBeenCalled();
    expect(task.create).not.toHaveBeenCalled();
  });

  it("admin with no assignment and no propertyId creates a task owned by themselves", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    noAssignment();
    const created = makeTask({ _id: TASK_ID, ownerId: ADMIN_ID, propertyId: "" });
    task.create.mockResolvedValue({ ...created, toObject: () => created });

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        token: signToken(ADMIN_ID),
        headers: { "x-forwarded-for": "203.0.113.22" },
        body: {
          title: created.title,
          priority: "medium",
          status: "open",
          dueDate: created.dueDate,
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(property.findOne).not.toHaveBeenCalled();
    expect(task.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: ADMIN_ID, propertyId: "" }),
    );
    const body = await json(res);
    expect((body.data as Record<string, unknown>).ownerId).toBe(ADMIN_ID);
  });

  it("403 when an admin with no assignment creates on a property owned by another admin", async () => {
    user.findById.mockReturnValue(buildQuery(adminUser()));
    noAssignment();
    property.findOne.mockReturnValue(
      buildQuery({ _id: OTHER_PROPERTY_ID, ownerId: OTHER_ADMIN_ID }),
    );

    const res = await POST(
      buildRequest("/api/v1/tasks", {
        method: "POST",
        token: signToken(ADMIN_ID),
        headers: { "x-forwarded-for": "203.0.113.23" },
        body: {
          title: "Fix tap",
          propertyId: OTHER_PROPERTY_ID,
          priority: "medium",
          status: "open",
          dueDate: "2026-01-10",
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(property.findOne).toHaveBeenCalledWith({ _id: OTHER_PROPERTY_ID, deletedAt: null });
    expect(task.create).not.toHaveBeenCalled();
  });
});
