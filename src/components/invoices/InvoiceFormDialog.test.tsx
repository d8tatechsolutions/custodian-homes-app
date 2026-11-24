import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { currentPeriod } from "@/lib/invoicing";

vi.mock("@/hooks/use-leases", () => ({ useLeases: () => ({ leases: [] }) }));
vi.mock("@/hooks/use-tenants", () => ({
  useTenants: () => ({ tenants: [{ _id: "t1", name: "Amina" }] }),
}));
vi.mock("@/hooks/use-properties", () => ({
  useProperties: () => ({ properties: [{ _id: "p1", title: "Forest View" }] }),
}));

const { InvoiceFormDialog, defaultDueDate } = await import(
  "@/components/invoices/InvoiceFormDialog"
);

describe("defaultDueDate", () => {
  it("is the 5th of the month after the billed month", () => {
    expect(defaultDueDate("2026-01")).toBe("2026-02-05");
    expect(defaultDueDate("2026-12")).toBe("2027-01-05");
  });
});

describe("InvoiceFormDialog", () => {
  it("defaults to a draft for the current month with the derived due date", () => {
    render(<InvoiceFormDialog open onOpenChange={() => {}} pending={false} onSubmit={vi.fn()} />);
    const month = screen.getByLabelText("Billed month") as HTMLInputElement;
    expect(month.value).toBe(currentPeriod());
    expect(month.max).toBe(currentPeriod());
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe(
      defaultDueDate(currentPeriod()),
    );
    expect(screen.getByText("Assigned on issue")).toBeInTheDocument();
    expect(screen.queryByText("Payment method")).not.toBeInTheDocument();
  });

  it("moves the due date with the billed month until it is edited by hand", () => {
    render(<InvoiceFormDialog open onOpenChange={() => {}} pending={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Billed month"), { target: { value: "2026-01" } });
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-02-05");

    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-02-20" } });
    fireEvent.change(screen.getByLabelText("Billed month"), { target: { value: "2026-02" } });
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-02-20");
  });

  it("submits the billed month, due date and draft mode for an edited draft", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const draft = {
      _id: "d1",
      invoiceNumber: "",
      tenantId: "t1",
      propertyId: "p1",
      leaseId: "",
      ownerId: "o1",
      period: "2026-01",
      amountDue: 30000,
      amountPaid: 0,
      serviceChargeAmount: 5000,
      status: "draft" as const,
      overdue: false,
      dueDate: "2026-02-05T00:00:00.000Z",
      issuedAt: null,
    };
    render(
      <InvoiceFormDialog
        open
        onOpenChange={() => {}}
        invoice={draft}
        pending={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText(/^Rent .* = /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        {
          period: "2026-01",
          dueDate: "2026-02-05",
          amountDue: 30000,
          serviceChargeAmount: 5000,
          notes: undefined,
        },
        draft,
      ),
    );
  });

  it("rejects a service charge above the amount", async () => {
    const onSubmit = vi.fn();
    const draft = {
      _id: "d1",
      invoiceNumber: "",
      tenantId: "t1",
      propertyId: "p1",
      leaseId: "",
      ownerId: "o1",
      period: "2026-01",
      amountDue: 1000,
      amountPaid: 0,
      status: "draft" as const,
      overdue: false,
      dueDate: "2026-02-05T00:00:00.000Z",
      issuedAt: null,
    };
    render(
      <InvoiceFormDialog
        open
        onOpenChange={() => {}}
        invoice={draft}
        pending={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText("Service charge (KES)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      await screen.findByText("Service charge cannot exceed the amount due"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
