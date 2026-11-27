import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaretakerRow } from "@/hooks/use-caretakers";

const mocks = vi.hoisted(() => {
  const list = [] as CaretakerRow[];
  const flags = {
    loading: false,
    error: null as string | null,
    pendingId: null as string | null,
  };
  const updatePrivileges = vi.fn();
  const setAgent = vi.fn();
  const toast = { success: vi.fn(), error: vi.fn() };
  return {
    list,
    flags,
    updatePrivileges,
    setAgent,
    toast,
    useUpdateCaretakerTitle: () => ({ setAgent, pendingId: null }),
    useCaretakers: () => ({
      caretakers: list,
      loading: flags.loading,
      error: flags.error,
      refetch: vi.fn(),
    }),
    useUpdateCaretakerPrivileges: () => ({
      updatePrivileges,
      pendingId: flags.pendingId,
      error: null,
    }),
  };
});

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/use-caretakers", () => ({
  useCaretakers: mocks.useCaretakers,
  useUpdateCaretakerPrivileges: mocks.useUpdateCaretakerPrivileges,
  useUpdateCaretakerTitle: mocks.useUpdateCaretakerTitle,
}));

import { CaretakerPrivilegesTable } from "@/components/team/CaretakerPrivilegesTable";

const caretakerRows: CaretakerRow[] = [
  {
    id: "care-1",
    name: "Amka",
    email: "amka@keja.co",
    managedByOwnerId: "owner-1",
    privileges: ["manage_tenants"],
    propertyCount: 3,
  },
];

describe("CaretakerPrivilegesTable", () => {
  beforeEach(() => {
    mocks.list.length = 0;
    mocks.flags.loading = false;
    mocks.flags.error = null;
    mocks.flags.pendingId = null;
    mocks.toast.success.mockClear();
    mocks.toast.error.mockClear();
    mocks.updatePrivileges.mockReset();
    mocks.setAgent.mockReset();
  });

  it("renders one switch per configurable privilege (manage_invoices is not exposed)", () => {
    mocks.list.push(...caretakerRows);
    render(<CaretakerPrivilegesTable />);

    expect(screen.getByText("Amka")).toBeInTheDocument();
    expect(screen.getByText("amka@keja.co")).toBeInTheDocument();
    // Manage tenants is checked by default
    expect(screen.getByRole("switch", { name: "Manage tenants for Amka" })).toBeChecked();
    // Exactly 5 privilege switches per row — NOT manage_invoices
    expect(screen.getAllByRole("switch")).toHaveLength(5);
    expect(screen.getAllByRole("switch", { name: /for Amka/ })).toHaveLength(5);
    expect(screen.queryByRole("switch", { name: /manage invoices/i })).not.toBeInTheDocument();
  });

  it("counts properties in the badge", () => {
    mocks.list.push(...caretakerRows);
    render(<CaretakerPrivilegesTable />);

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("sends the toggled privilege list to the API", async () => {
    const user = userEvent.setup();
    mocks.list.push(...caretakerRows);
    mocks.updatePrivileges.mockResolvedValue({
      ...caretakerRows[0],
      privileges: ["manage_tenants", "create_property"],
    });
    render(<CaretakerPrivilegesTable />);

    await user.click(screen.getByRole("switch", { name: "Create property for Amka" }));

    await waitFor(() =>
      expect(mocks.updatePrivileges).toHaveBeenCalledWith("care-1", [
        "manage_tenants",
        "create_property",
      ]),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Amka's privileges updated");
  });

  it("sends manage_tasks in the toggled privilege list to the API", async () => {
    const user = userEvent.setup();
    mocks.list.push(...caretakerRows);
    mocks.updatePrivileges.mockResolvedValue({
      ...caretakerRows[0],
      privileges: ["manage_tenants", "manage_tasks"],
    });
    render(<CaretakerPrivilegesTable />);

    await user.click(screen.getByRole("switch", { name: "Manage tasks for Amka" }));

    await waitFor(() =>
      expect(mocks.updatePrivileges).toHaveBeenCalledWith("care-1", [
        "manage_tenants",
        "manage_tasks",
      ]),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Amka's privileges updated");
  });

  it("rolls back the optimistic update and shows an error toast on failure", async () => {
    const user = userEvent.setup();
    mocks.list.push(...caretakerRows);
    mocks.updatePrivileges.mockRejectedValue(new Error("Caretaker is bound to another owner"));
    render(<CaretakerPrivilegesTable />);

    await user.click(screen.getByRole("switch", { name: "Create property for Amka" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(mocks.toast.error).toHaveBeenCalledWith("Could not update privileges", {
      description: "Caretaker is bound to another owner",
    });
    // Rolled back — manage_tenants remains the only checked privilege
    expect(screen.getByRole("switch", { name: "Manage tenants for Amka" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Create property for Amka" })).not.toBeChecked();
  });

  it("disables toggles and explains why when canAssign is false", () => {
    mocks.list.push(...caretakerRows);
    render(<CaretakerPrivilegesTable canAssign={false} />);

    expect(
      screen.getByText("Your owner has not granted you permission to change caretaker privileges."),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Manage tenants for Amka" })).toBeDisabled();
  });

  it("shows the phone when a caretaker has no email", () => {
    mocks.list.push({ ...caretakerRows[0], email: undefined, phone: "+254712345678" });
    render(<CaretakerPrivilegesTable />);

    expect(screen.getByText("+254712345678")).toBeInTheDocument();
  });

  it("filters caretakers by the search box", async () => {
    mocks.list.push(...caretakerRows, {
      id: "care-2",
      name: "Brian",
      email: "brian@keja.co",
      managedByOwnerId: "owner-1",
      privileges: [],
      propertyCount: 1,
    });
    render(<CaretakerPrivilegesTable />);

    await userEvent.type(screen.getByPlaceholderText("Search caretakers…"), "brian");

    expect(screen.getByText("Brian")).toBeInTheDocument();
    expect(screen.queryByText("Amka")).not.toBeInTheDocument();
  });

  it("shows the loading state while fetching", () => {
    mocks.flags.loading = true;
    render(<CaretakerPrivilegesTable />);
    expect(screen.getByText("Loading caretakers…")).toBeInTheDocument();
  });

  it("shows the error state", () => {
    mocks.flags.error = "Failed to fetch caretakers";
    render(<CaretakerPrivilegesTable />);
    expect(screen.getByText("Failed to fetch caretakers")).toBeInTheDocument();
  });

  it("shows the empty state", () => {
    render(<CaretakerPrivilegesTable />);
    expect(screen.getByText("No caretakers yet")).toBeInTheDocument();
  });
  it("hides the agent column unless canSetAgent", () => {
    mocks.list.push(...caretakerRows);
    render(<CaretakerPrivilegesTable />);
    expect(screen.queryByText("Managing agent")).not.toBeInTheDocument();
  });

  it("marks a caretaker as managing agent and shows the Agent badge", async () => {
    mocks.list.push(...caretakerRows);
    mocks.setAgent.mockResolvedValue("agent");
    render(<CaretakerPrivilegesTable canSetAgent />);

    expect(screen.getByText("Managing agent")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: /show amka as managing agent/i }));

    expect(mocks.setAgent).toHaveBeenCalledWith("care-1", true);
    expect(await screen.findByText("Agent")).toBeInTheDocument();
    expect(mocks.toast.success).toHaveBeenCalled();
  });

  it("rolls back the agent switch when the update fails", async () => {
    mocks.list.push(...caretakerRows);
    mocks.setAgent.mockRejectedValue(new Error("Forbidden"));
    render(<CaretakerPrivilegesTable canSetAgent />);

    const toggle = screen.getByRole("switch", { name: /show amka as managing agent/i });
    await userEvent.click(toggle);

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });
});
