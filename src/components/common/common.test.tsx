import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { type DataColumn, DataTable } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Timeline } from "@/components/common/Timeline";
import { TitleCell } from "@/components/common/TitleCell";

interface Row {
  id: string;
  name: string;
  amount: number;
}

const columns: DataColumn<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { key: "amount", header: "Amount", cell: (r) => String(r.amount), sortValue: (r) => r.amount },
];

const rows: Row[] = [
  { id: "1", name: "Bravo", amount: 2 },
  { id: "2", name: "Alpha", amount: 3 },
  { id: "3", name: "Charlie", amount: 1 },
];

function desktopNames() {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);
}

describe("DataTable", () => {
  it("renders the empty state when there are no rows", () => {
    render(
      <DataTable rows={[]} columns={columns} getRowId={(r) => r.id} emptyTitle="No tasks yet" />,
    );
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    const { rerender } = render(
      <DataTable rows={rows} columns={columns} getRowId={(r) => r.id} loading />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    rerender(<DataTable rows={rows} columns={columns} getRowId={(r) => r.id} error="Boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
  });

  it("sorts ascending, then descending, then back to the original order", async () => {
    const user = userEvent.setup();
    render(<DataTable rows={rows} columns={columns} getRowId={(r) => r.id} />);
    expect(desktopNames()).toEqual(["Bravo", "Alpha", "Charlie"]);
    const header = within(screen.getByRole("table")).getByRole("button", { name: /name/i });
    await user.click(header);
    expect(desktopNames()).toEqual(["Alpha", "Bravo", "Charlie"]);
    await user.click(header);
    expect(desktopNames()).toEqual(["Charlie", "Bravo", "Alpha"]);
    await user.click(header);
    expect(desktopNames()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("renders row actions in both layouts", () => {
    render(
      <DataTable
        rows={rows.slice(0, 1)}
        columns={columns}
        getRowId={(r) => r.id}
        rowActions={() => <button type="button">Edit</button>}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });
});

describe("TitleCell", () => {
  it("links to the detail page when an href is given", () => {
    render(<TitleCell href="/dashboard/admin/tasks/1">Fix gate</TitleCell>);
    expect(screen.getByRole("link", { name: "Fix gate" })).toHaveAttribute(
      "href",
      "/dashboard/admin/tasks/1",
    );
  });

  it("opens a read-only drawer when there is no detail page", async () => {
    const user = userEvent.setup();
    render(
      <TitleCell detail={{ title: "Jane Doe", fields: [{ label: "Phone", value: "+254700" }] }}>
        Jane Doe
      </TitleCell>,
    );
    await user.click(screen.getByRole("button", { name: "Jane Doe" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("+254700")).toBeInTheDocument();
  });

  it("falls back to plain text", () => {
    render(<TitleCell>Plain</TitleCell>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Plain")).toBeInTheDocument();
  });
});

describe("StatusBadge and Timeline", () => {
  it("renders a labelled badge", () => {
    render(<StatusBadge tone="success">Done</StatusBadge>);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders timeline items and an empty message", () => {
    const { rerender } = render(<Timeline items={[]} emptyText="No activity" />);
    expect(screen.getByText("No activity")).toBeInTheDocument();
    rerender(<Timeline items={[{ id: "a", title: "Created", meta: "Today" }]} />);
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });
});
