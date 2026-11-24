/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatInvoiceNumber } from "@/lib/invoice-numbering";
import { buildRequest, signToken, withParams } from "@/test/utils/api-request";
import { activeAssignment } from "@/test/utils/assignment-mocks";
import { makeInvoice, makeObjectId, makeUser } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", async () => {
  const { getModelStubs: get } = await import("@/test/utils/model-mocks");
  return { User: get().user };
});
vi.mock("@/models/Property", async () => {
  const { getModelStubs: get } = await import("@/test/utils/model-mocks");
  return { Property: get().property };
});
vi.mock("@/models/Invoice", async () => {
  const { getModelStubs: get } = await import("@/test/utils/model-mocks");
  return { Invoice: get().invoice };
});
vi.mock("@/models/ManagementAssignment", async () => {
  const { getModelStubs: get } = await import("@/test/utils/model-mocks");
  return { ManagementAssignment: get().managementAssignment };
});
vi.mock("@/models/Unit", async () => {
  const { getModelStubs: get } = await import("@/test/utils/model-mocks");
  return { Unit: get().unit };
});
vi.mock("@/models/Lease", async () => {
  const { getModelStubs: get } = await import("@/test/utils/model-mocks");
  return { Lease: get().lease };
});
vi.mock("@/models/BillingAccount", async () => {
  const { getModelStubs: get } = await import("@/test/utils/model-mocks");
  return { BillingAccount: get().billingAccount };
});

import { POST as DUPLICATE } from "@/app/api/v1/invoices/[id]/duplicate/route";
import { POST as ISSUE } from "@/app/api/v1/invoices/[id]/issue/route";

const { user, invoice: invoiceStub, managementAssignment } = getModelStubs();

const OWNER_ID = makeObjectId("admin");
const PROPERTY_ID = makeObjectId("p1");
const INVOICE_ID = makeObjectId("invoice");

function asAdmin() {
  user.findById.mockReturnValue(buildQuery(makeUser({ _id: OWNER_ID, role: "admin" })));
  managementAssignment.find.mockReturnValue(
    buildQuery([
      activeAssignment({
        principalUserId: OWNER_ID,
        accessRole: "admin",
        propertyId: PROPERTY_ID,
        permissions: ["invoice:read", "invoice:manage"],
      }),
    ]),
  );
}

function draft(overrides: Record<string, unknown> = {}) {
  return makeInvoice({
    _id: INVOICE_ID,
    ownerId: OWNER_ID,
    propertyId: PROPERTY_ID,
    status: "draft",
    invoiceNumber: "",
    period: "2026-01",
    dueDate: new Date("2026-02-10T00:00:00.000Z"),
    ...overrides,
  });
}

function post(path: string, body: unknown = {}) {
  return buildRequest(path, { method: "POST", token: signToken(OWNER_ID), body });
}

describe("POST /api/v1/invoices/[id]/issue", () => {
  beforeEach(() => {
    resetModelStubs();
  });

  it("reserves a number, stamps issuedAt and keeps the draft's due date", async () => {
    asAdmin();
    invoiceStub.findById.mockReturnValue(buildQuery(draft()));
    user.findOneAndUpdate.mockReturnValue(buildQuery({ invoiceCounters: {} }));
    invoiceStub.findOneAndUpdate.mockReturnValue(
      buildQuery(draft({ status: "pending", invoiceNumber: formatInvoiceNumber("2026-01", 1) })),
    );

    const res = await ISSUE(post(`/api/v1/invoices/${INVOICE_ID}/issue`), withParams(INVOICE_ID));
    expect(res.status).toBe(200);
    const [filter, update] = invoiceStub.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toEqual({ _id: INVOICE_ID, status: "draft" });
    expect(update.$set).toMatchObject({
      status: "pending",
      invoiceNumber: formatInvoiceNumber("2026-01", 1),
      dueDate: new Date("2026-02-10T00:00:00.000Z"),
    });
    expect(update.$set.issuedAt).toBeInstanceOf(Date);
  });

  it("409 when the invoice is not a draft", async () => {
    asAdmin();
    invoiceStub.findById.mockReturnValue(buildQuery(draft({ status: "pending" })));
    const res = await ISSUE(post(`/api/v1/invoices/${INVOICE_ID}/issue`), withParams(INVOICE_ID));
    expect(res.status).toBe(409);
    expect(user.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("409 when a concurrent request issued it first", async () => {
    asAdmin();
    invoiceStub.findById.mockReturnValue(buildQuery(draft()));
    user.findOneAndUpdate.mockReturnValue(buildQuery({ invoiceCounters: {} }));
    invoiceStub.findOneAndUpdate.mockReturnValue(buildQuery(null));
    const res = await ISSUE(post(`/api/v1/invoices/${INVOICE_ID}/issue`), withParams(INVOICE_ID));
    expect(res.status).toBe(409);
  });

  it("400 for a draft with no amount", async () => {
    asAdmin();
    invoiceStub.findById.mockReturnValue(buildQuery(draft({ amountDue: 0 })));
    const res = await ISSUE(post(`/api/v1/invoices/${INVOICE_ID}/issue`), withParams(INVOICE_ID));
    expect(res.status).toBe(400);
  });

  it("404 for an invoice outside the actor's scope", async () => {
    asAdmin();
    invoiceStub.findById.mockReturnValue(buildQuery(draft({ propertyId: makeObjectId("other") })));
    const res = await ISSUE(post(`/api/v1/invoices/${INVOICE_ID}/issue`), withParams(INVOICE_ID));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/invoices/[id]/duplicate", () => {
  beforeEach(() => {
    resetModelStubs();
  });

  it("copies an issued invoice into a number-less draft for the chosen month", async () => {
    asAdmin();
    invoiceStub.findById
      .mockReturnValueOnce(
        buildQuery(
          draft({
            status: "paid",
            invoiceNumber: "INV-202601-0001",
            amountPaid: 25000,
            rentAmount: 20000,
            serviceChargeAmount: 5000,
          }),
        ),
      )
      .mockReturnValueOnce(buildQuery(draft({ period: "2026-02" })));
    invoiceStub.create.mockResolvedValue({ _id: makeObjectId("copy") });

    const res = await DUPLICATE(
      post(`/api/v1/invoices/${INVOICE_ID}/duplicate`, { period: "2026-02" }),
      withParams(INVOICE_ID),
    );
    expect(res.status).toBe(201);
    expect(invoiceStub.create).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceNumber: "",
        status: "draft",
        issuedAt: null,
        amountPaid: 0,
        period: "2026-02",
        dueDate: new Date(Date.UTC(2026, 2, 5)),
        rentAmount: 20000,
        serviceChargeAmount: 5000,
      }),
    );
  });

  it("400 for a future month", async () => {
    asAdmin();
    invoiceStub.findById.mockReturnValue(buildQuery(draft()));
    const res = await DUPLICATE(
      post(`/api/v1/invoices/${INVOICE_ID}/duplicate`, { period: "2099-01" }),
      withParams(INVOICE_ID),
    );
    expect(res.status).toBe(400);
    expect(invoiceStub.create).not.toHaveBeenCalled();
  });
});
