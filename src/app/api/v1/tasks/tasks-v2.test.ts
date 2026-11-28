/** @vitest-environment node */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, signToken, withParams } from "@/test/utils/api-request";
import { makeObjectId, makeUser } from "@/test/utils/factories";
import {
  buildQuery,
  createModelStub,
  getModelStubs,
  mockStaffPortfolio,
  resetModelStubs,
} from "@/test/utils/model-mocks";

const extra = vi.hoisted(() => ({
  taskActivity: {} as Record<string, ReturnType<typeof vi.fn>>,
  propertyOperations: {} as Record<string, ReturnType<typeof vi.fn>>,
  propertyOwnership: {} as Record<string, ReturnType<typeof vi.fn>>,
  vendor: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/ManagementAssignment", () => ({
  ManagementAssignment: getModelStubs().managementAssignment,
}));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));
vi.mock("@/models/Task", () => ({ Task: getModelStubs().task }));
vi.mock("@/models/Complaint", () => ({ Complaint: getModelStubs().complaint }));
vi.mock("@/models/Tenant", () => ({ Tenant: getModelStubs().tenant }));
vi.mock("@/models/Lease", () => ({ Lease: getModelStubs().lease }));
vi.mock("@/models/Invoice", () => ({ Invoice: getModelStubs().invoice }));
vi.mock("@/models/Unit", () => ({ Unit: getModelStubs().unit }));
vi.mock("@/models/TaskActivity", async () => {
  const { createModelStub: make } = await import("@/test/utils/model-mocks");
  Object.assign(extra.taskActivity, make());
  return { TaskActivity: extra.taskActivity };
});
vi.mock("@/models/PropertyOperations", async () => {
  const { createModelStub: make } = await import("@/test/utils/model-mocks");
  Object.assign(extra.propertyOperations, make());
  return { PropertyOperations: extra.propertyOperations };
});
vi.mock("@/models/PropertyOwnership", async () => {
  const { createModelStub: make } = await import("@/test/utils/model-mocks");
  Object.assign(extra.propertyOwnership, make());
  return { PropertyOwnership: extra.propertyOwnership };
});
vi.mock("@/models/Vendor", async () => {
  const { createModelStub: make } = await import("@/test/utils/model-mocks");
  Object.assign(extra.vendor, make());
  return { Vendor: extra.vendor };
});
vi.mock("@/lib/billing-accounts", () => ({
  billingFieldsFromAccount: () => null,
  resolveBillingAccountForOwner: vi.fn().mockResolvedValue(null),
}));

import { POST as APPROVAL } from "@/app/api/v1/tasks/[id]/approval/route";
import { POST as ASSIGN } from "@/app/api/v1/tasks/[id]/assign/route";
import { POST as BILL } from "@/app/api/v1/tasks/[id]/bill-tenant/route";
import { POST as PHOTOS } from "@/app/api/v1/tasks/[id]/photos/route";
import { POST as QUOTE } from "@/app/api/v1/tasks/[id]/quote/route";
import { POST as STATUS } from "@/app/api/v1/tasks/[id]/status/route";
import { POST as CREATE } from "@/app/api/v1/tasks/route";
import { PATCH as VENDOR_PATCH } from "@/app/api/v1/vendors/[id]/route";

const { user, task, complaint, property, tenant, invoice, managementAssignment } = getModelStubs();
const _unused = createModelStub;

const ADMIN = makeObjectId("admin");
const CARETAKER = makeObjectId("caretaker");
const OTHER = makeObjectId("other");
const PROPERTY = makeObjectId("p1");
const TASK = makeObjectId("task");
const COMPLAINT = makeObjectId("complaint");
const TENANT = makeObjectId("tenant");
const VENDOR = makeObjectId("vendor");

const ORIGINAL = process.env.TASKS_V2_ENABLED;
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.TASKS_V2_ENABLED;
  else process.env.TASKS_V2_ENABLED = ORIGINAL;
});

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: TASK,
    title: "Fix gate",
    propertyId: PROPERTY,
    ownerId: ADMIN,
    status: "open",
    priority: "medium",
    createdBy: ADMIN,
    createdByRole: "admin",
    dueDate: "2026-12-01",
    complaintIds: [],
    photosBefore: [],
    photosAfter: [],
    ...overrides,
  };
}

function asAdmin() {
  user.findById.mockReturnValue(buildQuery(makeUser({ _id: ADMIN, role: "admin", name: "Owner" })));
}

function asCaretaker() {
  user.findById.mockReturnValue(
    buildQuery(
      makeUser({
        _id: CARETAKER,
        role: "caretaker",
        name: "Care",
        privileges: ["manage_tasks"],
      } as never),
    ),
  );
  mockStaffPortfolio({
    userId: CARETAKER,
    role: "caretaker",
    ownerId: ADMIN,
    propertyIds: [PROPERTY],
    permissions: ["task:read-own", "task:create", "task:manage"],
  });
}

function post(path: string, token: string, body: unknown) {
  return buildRequest(path, { method: "POST", token, body });
}

/** The task as stored, then as re-read after the update. */
function stubTask(before: Record<string, unknown>, after: Record<string, unknown> = before) {
  task.findById.mockReturnValueOnce(buildQuery(before)).mockReturnValue(buildQuery(after));
}

beforeEach(() => {
  resetModelStubs();
  for (const stub of Object.values(extra)) {
    for (const fn of Object.values(stub)) fn.mockReset?.();
  }
  extra.taskActivity.create.mockResolvedValue({});
  process.env.TASKS_V2_ENABLED = "true";
  property.find.mockReturnValue(buildQuery([{ _id: PROPERTY, title: "Sunrise" }]));
  task.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
  task.findOneAndUpdate.mockReturnValue(buildQuery(taskRow()));
  complaint.updateMany.mockResolvedValue({});
  void _unused;
});

describe("release flag", () => {
  it("hides every v2 action while TASKS_V2_ENABLED is off", async () => {
    process.env.TASKS_V2_ENABLED = "false";
    asAdmin();
    const res = await STATUS(
      post(`/api/v1/tasks/${TASK}/status`, signToken(ADMIN), { status: "done" }),
      withParams(TASK),
    );
    expect(res.status).toBe(404);
    expect(task.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  it("rejects moves that skip the rules", async () => {
    asAdmin();
    stubTask(taskRow({ status: "done" }));
    const res = await STATUS(
      post(`/api/v1/tasks/${TASK}/status`, signToken(ADMIN), { status: "in-progress" }),
      withParams(TASK),
    );
    expect(res.status).toBe(409);
  });

  it("never lets a task waiting for approval be marked done by hand", async () => {
    asAdmin();
    stubTask(taskRow({ status: "waiting-approval", cost: { approval: { status: "pending" } } }));
    const res = await STATUS(
      post(`/api/v1/tasks/${TASK}/status`, signToken(ADMIN), { status: "done" }),
      withParams(TASK),
    );
    expect(res.status).toBe(409);
    expect(task.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("finishes a task and resolves linked complaints only when asked", async () => {
    asAdmin();
    stubTask(taskRow({ complaintIds: [COMPLAINT] }), taskRow({ status: "done" }));
    task.findOneAndUpdate.mockReturnValue(buildQuery(taskRow({ status: "done" })));
    const res = await STATUS(
      post(`/api/v1/tasks/${TASK}/status`, signToken(ADMIN), {
        status: "done",
        resolveComplaints: true,
      }),
      withParams(TASK),
    );
    expect(res.status).toBe(200);
    expect(task.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: TASK, status: "open" },
      { $set: expect.objectContaining({ status: "done" }) },
      { new: true },
    );
    expect(complaint.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [COMPLAINT] }, status: { $ne: "resolved" } },
      { $set: expect.objectContaining({ status: "resolved" }) },
    );
  });

  it("leaves complaints alone when the user chose not to resolve them", async () => {
    asAdmin();
    stubTask(taskRow({ complaintIds: [COMPLAINT] }));
    await STATUS(
      post(`/api/v1/tasks/${TASK}/status`, signToken(ADMIN), {
        status: "done",
        resolveComplaints: false,
      }),
      withParams(TASK),
    );
    expect(complaint.updateMany).not.toHaveBeenCalled();
  });

  it("only lets an admin reopen a cancelled task", async () => {
    asCaretaker();
    stubTask(taskRow({ status: "cancelled" }));
    const res = await STATUS(
      post(`/api/v1/tasks/${TASK}/status`, signToken(CARETAKER), { status: "open" }),
      withParams(TASK),
    );
    expect(res.status).toBe(403);
  });
});

describe("quote and approval", () => {
  it("sends every quote for approval while no threshold is set", async () => {
    asAdmin();
    stubTask(taskRow());
    extra.propertyOperations.findOne.mockReturnValue(buildQuery(null));
    property.findById.mockReturnValue(buildQuery({ ownerId: ADMIN }));
    extra.propertyOwnership.find.mockReturnValue(buildQuery([]));
    const res = await QUOTE(
      post(`/api/v1/tasks/${TASK}/quote`, signToken(ADMIN), { amount: 1500 }),
      withParams(TASK),
    );
    expect(res.status).toBe(200);
    const [, update] = task.updateOne.mock.calls[0];
    expect(update.$set.status).toBe("waiting-approval");
    expect(update.$set.cost.approval).toMatchObject({
      status: "pending",
      approverUserId: ADMIN,
      resumeStatus: "open",
    });
  });

  it("lets work proceed when the quote is within the threshold", async () => {
    asAdmin();
    stubTask(taskRow());
    extra.propertyOperations.findOne.mockReturnValue(buildQuery({ approvalThreshold: 5000 }));
    property.findById.mockReturnValue(buildQuery({ ownerId: ADMIN }));
    await QUOTE(
      post(`/api/v1/tasks/${TASK}/quote`, signToken(ADMIN), { amount: 5000 }),
      withParams(TASK),
    );
    const [, update] = task.updateOne.mock.calls[0];
    expect(update.$set.status).toBeUndefined();
    expect(update.$set.cost.approval.status).toBe("not_required");
  });

  it("only the recorded approver can decide, and the task returns to its previous status", async () => {
    const waiting = taskRow({
      status: "waiting-approval",
      cost: {
        quote: { amount: 9000, by: CARETAKER },
        approval: { status: "pending", approverUserId: ADMIN, resumeStatus: "in-progress" },
      },
    });
    asCaretaker();
    stubTask(waiting);
    const denied = await APPROVAL(
      post(`/api/v1/tasks/${TASK}/approval`, signToken(CARETAKER), { decision: "approve" }),
      withParams(TASK),
    );
    expect(denied.status).toBe(403);

    resetModelStubs();
    property.find.mockReturnValue(buildQuery([]));
    extra.taskActivity.create.mockResolvedValue({});
    task.updateOne.mockResolvedValue({ modifiedCount: 1 });
    asAdmin();
    stubTask(waiting);
    const ok = await APPROVAL(
      post(`/api/v1/tasks/${TASK}/approval`, signToken(ADMIN), { decision: "approve" }),
      withParams(TASK),
    );
    expect(ok.status).toBe(200);
    expect(task.updateOne).toHaveBeenCalledWith(
      { _id: TASK, status: "waiting-approval", "cost.approval.status": "pending" },
      {
        $set: expect.objectContaining({
          status: "in-progress",
          "cost.approval.status": "approved",
        }),
      },
    );
  });

  it("requires a reason to reject", async () => {
    asAdmin();
    stubTask(
      taskRow({
        status: "waiting-approval",
        cost: { approval: { status: "pending", approverUserId: ADMIN } },
      }),
    );
    const res = await APPROVAL(
      post(`/api/v1/tasks/${TASK}/approval`, signToken(ADMIN), { decision: "reject" }),
      withParams(TASK),
    );
    expect(res.status).toBe(400);
  });
});

describe("photos", () => {
  const media = { url: "https://abc.ufs.sh/f/key1", key: "key1", name: "a.jpg" };

  it("only the assignee (or a supervisor) adds after photos", async () => {
    asCaretaker();
    stubTask(taskRow({ assignee: { kind: "staff", userId: OTHER } }));
    const res = await PHOTOS(
      post(`/api/v1/tasks/${TASK}/photos`, signToken(CARETAKER), {
        action: "add",
        side: "after",
        media,
      }),
      withParams(TASK),
    );
    expect(res.status).toBe(403);
  });

  it("enforces three photos per side atomically", async () => {
    asAdmin();
    stubTask(taskRow());
    task.updateOne.mockResolvedValue({ modifiedCount: 0 });
    const res = await PHOTOS(
      post(`/api/v1/tasks/${TASK}/photos`, signToken(ADMIN), {
        action: "add",
        side: "before",
        media,
      }),
      withParams(TASK),
    );
    expect(res.status).toBe(409);
    expect(task.updateOne.mock.calls[0][0]).toEqual({
      _id: TASK,
      "photosBefore.2": { $exists: false },
    });
  });

  it("refuses files that were not uploaded through the app", async () => {
    asAdmin();
    stubTask(taskRow());
    const res = await PHOTOS(
      post(`/api/v1/tasks/${TASK}/photos`, signToken(ADMIN), {
        action: "add",
        side: "before",
        media: { url: "https://evil.example.com/x.jpg" },
      }),
      withParams(TASK),
    );
    expect(res.status).toBe(400);
  });
});

describe("assignment", () => {
  it("stops caretakers from assigning someone else", async () => {
    asCaretaker();
    stubTask(taskRow());
    const res = await ASSIGN(
      post(`/api/v1/tasks/${TASK}/assign`, signToken(CARETAKER), {
        assignee: { kind: "staff", userId: OTHER },
      }),
      withParams(TASK),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Caretakers can only assign tasks to themselves",
    });
  });

  it("only accepts vendors that serve the property", async () => {
    asAdmin();
    stubTask(taskRow());
    extra.vendor.findOne.mockReturnValue(
      buildQuery({ _id: VENDOR, name: "Fundi", propertyIds: ["elsewhere"] }),
    );
    const res = await ASSIGN(
      post(`/api/v1/tasks/${TASK}/assign`, signToken(ADMIN), {
        assignee: { kind: "vendor", vendorId: VENDOR },
      }),
      withParams(TASK),
    );
    expect(res.status).toBe(400);
  });
});

describe("create (v2)", () => {
  it("always assigns a caretaker's own task to themselves", async () => {
    asCaretaker();
    property.findOne.mockReturnValue(buildQuery({ _id: PROPERTY, ownerId: ADMIN }));
    managementAssignment.exists.mockResolvedValue({ _id: "a" });
    task.create.mockImplementation(async (doc: Record<string, unknown>) => ({
      ...doc,
      _id: TASK,
      toObject() {
        return { ...doc, _id: TASK };
      },
    }));
    const res = await CREATE(
      post("/api/v1/tasks", signToken(CARETAKER), {
        title: "Leak",
        propertyId: PROPERTY,
        dueDate: "2026-12-01",
        assignee: { kind: "staff", userId: OTHER },
      }),
    );
    expect(res.status).toBe(201);
    expect(task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedTo: CARETAKER,
        assignee: expect.objectContaining({ userId: CARETAKER }),
      }),
    );
  });
});

describe("create (v2) — owner fallback", () => {
  function createAsAdmin(body: Record<string, unknown> = {}) {
    asAdmin();
    property.findOne.mockReturnValue(buildQuery({ _id: PROPERTY, ownerId: ADMIN }));
    task.create.mockImplementation(async (doc: Record<string, unknown>) => ({
      ...doc,
      _id: TASK,
      toObject() {
        return { ...doc, _id: TASK };
      },
    }));
    return CREATE(
      post("/api/v1/tasks", signToken(ADMIN), {
        title: "Leak",
        propertyId: PROPERTY,
        dueDate: "2026-12-01",
        ...body,
      }),
    );
  }

  it("gives an unassigned task to the owner when nobody manages the property", async () => {
    managementAssignment.find.mockReturnValue(buildQuery([]));
    const res = await createAsAdmin();
    expect(res.status).toBe(201);
    expect(task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedTo: ADMIN,
        assignedToName: "Owner",
        assignee: { kind: "staff", userId: ADMIN, vendorId: "", name: "Owner" },
      }),
    );
    expect(extra.taskActivity.create).toHaveBeenCalled();
  });

  it("leaves it unassigned when a custodian manages the property", async () => {
    managementAssignment.find.mockImplementation((query: Record<string, unknown>) =>
      buildQuery(
        query.accessRole ? [{ principalUserId: OTHER, startsAt: null, endsAt: null }] : [],
      ),
    );
    user.countDocuments.mockResolvedValue(1);
    const res = await createAsAdmin();
    expect(res.status).toBe(201);
    expect(task.create).toHaveBeenCalledWith(
      expect.objectContaining({ assignee: null, assignedTo: "" }),
    );
  });
});

describe("bill tenant", () => {
  it("creates a draft repair invoice with no lease and zero rent", async () => {
    asAdmin();
    user.findById.mockReturnValue(
      buildQuery(makeUser({ _id: ADMIN, role: "admin", name: "Owner" })),
    );
    stubTask(
      taskRow({
        complaintIds: [COMPLAINT],
        cost: { payer: "tenant", labourAmount: 1000, materialsAmount: 500 },
      }),
    );
    complaint.find.mockReturnValue(buildQuery([{ tenantId: TENANT }]));
    tenant.findById.mockReturnValue(
      buildQuery({ ownerId: ADMIN, propertyId: PROPERTY, name: "Jane" }),
    );
    invoice.create.mockResolvedValue({ _id: "inv-1" });
    const res = await BILL(
      post(`/api/v1/tasks/${TASK}/bill-tenant`, signToken(ADMIN), {}),
      withParams(TASK),
    );
    expect(res.status).toBe(201);
    expect(invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        invoiceNumber: "",
        leaseId: "",
        rentAmount: 0,
        amountDue: 1500,
        tenantId: TENANT,
      }),
    );
  });

  it("refuses until 'who pays' is the tenant", async () => {
    asAdmin();
    stubTask(taskRow({ cost: { payer: "owner", labourAmount: 100 } }));
    const res = await BILL(
      post(`/api/v1/tasks/${TASK}/bill-tenant`, signToken(ADMIN), {}),
      withParams(TASK),
    );
    expect(res.status).toBe(409);
  });
});

describe("vendors", () => {
  it("editing one field leaves the others untouched", async () => {
    asAdmin();
    extra.vendor.findOne.mockReturnValue(buildQuery({ _id: VENDOR, ownerId: ADMIN }));
    extra.vendor.findOneAndUpdate.mockReturnValue(buildQuery({ _id: VENDOR, name: "New" }));
    task.updateMany.mockResolvedValue({});
    const res = await VENDOR_PATCH(
      buildRequest(`/api/v1/vendors/${VENDOR}`, {
        method: "PATCH",
        token: signToken(ADMIN),
        body: { name: "New" },
      }),
      withParams(VENDOR),
    );
    expect(res.status).toBe(200);
    const [, update] = extra.vendor.findOneAndUpdate.mock.calls[0];
    expect(update).toEqual({ $set: { name: "New" } });
  });
});
