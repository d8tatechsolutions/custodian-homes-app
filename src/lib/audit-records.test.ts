/** @vitest-environment node */
import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditEvent: m.write }));

const { recordAudit, recordInvoiceAudit, recordLeaseAudit } = await import("@/lib/audit-records");

function setConnected(state: number) {
  Object.defineProperty(mongoose.connection, "readyState", { value: state, configurable: true });
}

describe("audit records", () => {
  const original = mongoose.connection.readyState;
  beforeEach(() => {
    vi.clearAllMocks();
    setConnected(1);
  });
  afterEach(() => setConnected(original));

  it("records an invoice payment with its money fields, property and unit", async () => {
    const invoice = {
      _id: "inv-1",
      propertyId: "p1",
      unitId: "u1",
      invoiceNumber: "INV-1",
      status: "pending",
      amountDue: 10000,
      amountPaid: 0,
    };
    const request = new Request("http://localhost/x", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "UA" },
    });
    await recordInvoiceAudit(
      request,
      { userId: "staff", role: "caretaker" },
      "invoice.payment_recorded",
      invoice,
      invoice,
      { ...invoice, status: "paid", amountPaid: 10000, method: "cash" },
      { amountThisPayment: 10000 },
    );
    const entry = m.write.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: "invoice.payment_recorded",
      entityType: "invoice",
      entityId: "inv-1",
      scope: { propertyId: "p1", unitId: "u1" },
      before: { status: "pending", amountPaid: 0 },
      after: { status: "paid", amountPaid: 10000, method: "cash", amountThisPayment: 10000 },
      request: { ip: "203.0.113.9", userAgent: "UA" },
    });
  });

  it("records lease rent and status changes", async () => {
    const lease = { _id: "l1", propertyId: "p1", rentAmount: 20000, status: "active" };
    await recordLeaseAudit(null, { userId: "o", role: "admin" }, "lease.ended", lease, lease, {
      ...lease,
      status: "ended",
    });
    expect(m.write.mock.calls[0][0]).toMatchObject({
      entityType: "lease",
      before: { rentAmount: 20000, status: "active" },
      after: { rentAmount: 20000, status: "ended" },
    });
  });

  it("never throws, even if the write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      recordAudit({ actor: { userId: "a", role: "admin" }, action: "x", entityType: "y" }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("skips instead of waiting when there is no database connection", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setConnected(0);
    await recordAudit({ actor: { userId: "a", role: "admin" }, action: "x", entityType: "y" });
    expect(m.write).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
