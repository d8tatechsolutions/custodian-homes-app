import { describe, expect, it } from "vitest";
import {
  type AuditViewer,
  auditActionLabel,
  auditChanges,
  auditDetailFor,
  auditVisibilityFilter,
  toAuditEntryView,
} from "@/lib/audit-view";

function viewer(overrides: Partial<AuditViewer>): AuditViewer {
  return {
    role: "admin",
    userId: "u1",
    propertyIds: [],
    invoiceIds: [],
    leaseIds: [],
    ...overrides,
  };
}

describe("auditVisibilityFilter (need-to-know)", () => {
  it("system admin sees everything", () => {
    expect(auditVisibilityFilter(viewer({ role: "system-admin" }))).toEqual({});
  });

  it("owners and staff see their properties and their own actions", () => {
    for (const role of ["admin", "custodian", "caretaker"] as const) {
      expect(auditVisibilityFilter(viewer({ role, propertyIds: ["p1", "p2"] }))).toEqual({
        $or: [{ actorUserId: "u1" }, { "scope.propertyId": { $in: ["p1", "p2"] } }],
      });
    }
  });

  it("tenants see their own actions, account, invoices and leases only", () => {
    expect(
      auditVisibilityFilter(viewer({ role: "tenant", invoiceIds: ["i1"], leaseIds: ["l1"] })),
    ).toEqual({
      $or: [
        { actorUserId: "u1" },
        { entityType: "user", entityId: "u1" },
        { entityType: "invoice", entityId: { $in: ["i1"] } },
        { entityType: "lease", entityId: { $in: ["l1"] } },
      ],
    });
  });

  it("brokers see their own actions and account only", () => {
    expect(auditVisibilityFilter(viewer({ role: "broker" }))).toEqual({
      $or: [{ actorUserId: "u1" }, { entityType: "user", entityId: "u1" }],
    });
  });
});

describe("auditChanges", () => {
  it("lists changed fields only and never internal ones", () => {
    const changes = auditChanges(
      { status: "pending", amountPaid: 0, passwordHash: "x", note: "same" },
      { status: "paid", amountPaid: 5000, passwordHash: "y", note: "same" },
      "full",
    );
    expect(changes).toEqual([
      { field: "status", before: "pending", after: "paid" },
      { field: "amountPaid", before: "0", after: "5000" },
    ]);
  });

  it("hides personal contact details from anyone who doesn't see entries in full", () => {
    const before = { phone: "+254700000001", email: "a@b.co", rent: 10 };
    const after = { phone: "+254700000002", email: "c@d.co", rent: 12 };
    expect(auditChanges(before, after, "staff")).toEqual([
      { field: "phone", before: "hidden", after: "hidden" },
      { field: "email", before: "hidden", after: "hidden" },
      { field: "rent", before: "10", after: "12" },
    ]);
    expect(auditChanges(before, after, "full")[0]).toEqual({
      field: "phone",
      before: "+254700000001",
      after: "+254700000002",
    });
  });

  it("shows every field of a creation", () => {
    expect(auditChanges(null, { status: "draft" }, "full")).toEqual([
      { field: "status", before: "—", after: "draft" },
    ]);
  });
});

describe("toAuditEntryView", () => {
  const row = {
    _id: "e1",
    actorUserId: "staff-1",
    actorRole: "caretaker",
    action: "invoice.payment_recorded",
    entityType: "invoice",
    entityId: "i1",
    scope: { propertyId: "p1" },
    before: { amountPaid: 0 },
    after: { amountPaid: 100 },
    createdAt: new Date("2026-11-28T10:00:00Z"),
  };
  const lookups = {
    names: new Map([["staff-1", "Amka"]]),
    propertyTitles: new Map([["p1", "Palm Court"]]),
    notes: new Map([["e1", [{ id: "n1", authorName: "Admin", text: "Checked", createdAt: "" }]]]),
  };

  it("owners see names, the property and notes", () => {
    const view = toAuditEntryView(row, viewer({ role: "admin" }), lookups);
    expect(view).toMatchObject({
      label: "Payment recorded by hand",
      actor: { name: "Amka", role: "Caretaker", isYou: false },
      propertyTitle: "Palm Court",
      entityId: "i1",
      notes: [{ text: "Checked" }],
    });
  });

  it("tenants see the role, not the staff member's name or internal ids", () => {
    const view = toAuditEntryView(row, viewer({ role: "tenant", userId: "t1" }), lookups);
    expect(view.actor.name).toBe("Caretaker");
    expect(view.entityId).toBe("");
    expect(view.propertyId).toBe("");
  });

  it("marks the viewer's own actions", () => {
    const view = toAuditEntryView(row, viewer({ role: "caretaker", userId: "staff-1" }), lookups);
    expect(view.actor).toMatchObject({ name: "You", isYou: true });
  });
});

describe("labels and detail levels", () => {
  it("has readable labels and a fallback", () => {
    expect(auditActionLabel("lease.ended")).toBe("Lease ended");
    expect(auditActionLabel("something.new_thing")).toBe("Something new thing");
  });

  it("maps roles to detail levels", () => {
    expect(auditDetailFor("system-admin")).toBe("full");
    expect(auditDetailFor("admin")).toBe("full");
    expect(auditDetailFor("caretaker")).toBe("staff");
    expect(auditDetailFor("tenant")).toBe("self");
    expect(auditDetailFor("broker")).toBe("self");
  });
});
