/**
 * @vitest-environment node
 *
 * Task permission matrix (plan §1.8 row 10).
 *
 * End-to-end-in-process checks of the task authorization contract: the real
 * JWT is verified by `requirePermission` inside each route handler, while only
 * the persistence layer is stubbed. In particular, an admin's own tasks and
 * their delegated property scope are a UNION — an admin without a delegated
 * task assignment is not globally privileged.
 */
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

// Route imports come after the mocks so the real guards resolve through the
// stubbed models (Vitest hoists vi.mock above all imports).
import { GET as getTaskById } from "@/app/api/v1/tasks/[id]/route";
import { GET as listTasks } from "@/app/api/v1/tasks/route";
import { caretakerPrivilegeActions } from "@/lib/authorization-policy";

const { user, property, task, managementAssignment } = getModelStubs();

const ADMIN_A_ID = makeObjectId("admin-a");
const ADMIN_B_ID = makeObjectId("admin-b");
const CARETAKER_ID = makeObjectId("caretaker");
const PROPERTY_P = makeObjectId("prop-p");
const TASK_ID = makeObjectId("task");

function signInAdminA() {
  user.findById.mockReturnValue(buildQuery(makeUser({ _id: ADMIN_A_ID, role: "admin" })));
  return signToken(ADMIN_A_ID);
}

function signInCaretakerWithManageTasks() {
  user.findById.mockReturnValue(
    buildQuery(makeUser({ _id: CARETAKER_ID, role: "caretaker", privileges: ["manage_tasks"] })),
  );
  return signToken(CARETAKER_ID);
}

function noAssignment() {
  managementAssignment.find.mockReturnValue(buildQuery([]));
}

function adminTaskDelegation(propertyId: string) {
  managementAssignment.find.mockReturnValue(
    buildQuery([
      {
        principalUserId: ADMIN_A_ID,
        accessRole: "admin",
        scopeType: "property",
        propertyId,
        permissions: ["task:read-own", "task:create", "task:manage"],
        status: "active",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: null,
      },
    ]),
  );
}

function propertyRow() {
  property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_P, title: "Sunlit Studio" }]));
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetModelStubs();
});

describe("task permission matrix", () => {
  it("admin A with no assignment gets 403 reading admin B's task by id", async () => {
    const token = signInAdminA();
    noAssignment();
    task.findById.mockReturnValue(
      buildQuery(makeTask({ _id: TASK_ID, ownerId: ADMIN_B_ID, propertyId: PROPERTY_P })),
    );

    const res = await getTaskById(
      buildRequest(`/api/v1/tasks/${TASK_ID}`, { token }),
      withParams(TASK_ID),
    );
    expect(res.status).toBe(403);
  });

  it("admin A with a delegated assignment over P reads admin B's task on P", async () => {
    const token = signInAdminA();
    adminTaskDelegation(PROPERTY_P);
    task.findById.mockReturnValue(
      buildQuery(makeTask({ _id: TASK_ID, ownerId: ADMIN_B_ID, propertyId: PROPERTY_P })),
    );
    propertyRow();

    const res = await getTaskById(
      buildRequest(`/api/v1/tasks/${TASK_ID}`, { token }),
      withParams(TASK_ID),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.data as Record<string, unknown>).ownerId).toBe(ADMIN_B_ID);
    expect((body.data as Record<string, unknown>).property).toBe("Sunlit Studio");
  });

  it("admin A with no assignment lists only their own rows", async () => {
    const token = signInAdminA();
    noAssignment();
    task.find.mockReturnValue(buildQuery([]).sort({ createdAt: -1 }).skip(0).limit(10));
    task.countDocuments.mockResolvedValue(0);

    const res = await listTasks(buildRequest("/api/v1/tasks", { token }));
    expect(res.status).toBe(200);
    expect(task.find).toHaveBeenCalledWith({ ownerId: ADMIN_A_ID });
    expect(task.countDocuments).toHaveBeenCalledWith({ ownerId: ADMIN_A_ID });
  });

  it("caretaker with manage_tasks derives the task read/create/manage actions and passes the gates", async () => {
    const derived = caretakerPrivilegeActions(["manage_tasks"]);
    expect(derived.actions.filter((action) => action.startsWith("task:"))).toEqual([
      "task:read-own",
      "task:create",
      "task:manage",
    ]);
    expect(derived.unrepresentable).toEqual([]);

    const token = signInCaretakerWithManageTasks();
    managementAssignment.find.mockReturnValue(
      buildQuery([
        {
          principalUserId: CARETAKER_ID,
          accessRole: "caretaker",
          scopeType: "property",
          propertyId: PROPERTY_P,
          permissions: derived.actions,
          status: "active",
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: null,
        },
      ]),
    );
    // The caretaker's managed owner is derived from the same assignment.
    property.find.mockReturnValue(buildQuery([{ _id: PROPERTY_P, ownerId: ADMIN_B_ID }]));
    task.find.mockReturnValue(buildQuery([]).sort({ createdAt: -1 }).skip(0).limit(10));
    task.countDocuments.mockResolvedValue(0);

    const res = await listTasks(buildRequest("/api/v1/tasks", { token }));
    expect(res.status).toBe(200);
    expect(task.find).toHaveBeenCalledWith({
      $and: [{ ownerId: ADMIN_B_ID }, { propertyId: { $in: [PROPERTY_P] } }],
    });
  });

  it("unauthenticated task list requests get 401", async () => {
    const res = await listTasks(buildRequest("/api/v1/tasks"));
    expect(res.status).toBe(401);
    expect(task.find).not.toHaveBeenCalled();
  });

  it("unauthenticated task-by-id requests get 401", async () => {
    const res = await getTaskById(buildRequest(`/api/v1/tasks/${TASK_ID}`), withParams(TASK_ID));
    expect(res.status).toBe(401);
    expect(task.findById).not.toHaveBeenCalled();
  });
});
