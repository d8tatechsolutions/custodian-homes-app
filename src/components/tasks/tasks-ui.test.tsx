import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaintenanceTask } from "@/types/maintenance";

vi.mock("@/lib/uploadthing", () => ({
  useUploadThing: () => ({ startUpload: vi.fn().mockResolvedValue([]), isUploading: false }),
}));
vi.mock("@/hooks/use-properties", () => ({
  useProperties: () => ({
    properties: [{ _id: "p1", title: "Sunrise Court", ownerId: "admin-1", blocks: [] }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-units", () => ({ useUnits: () => ({ units: [], loading: false }) }));
vi.mock("@/hooks/use-complaints", () => ({
  useComplaints: () => ({ items: [], loading: false, error: null }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "admin-1", role: "admin", name: "Owner" }, loading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

import { CostCard } from "@/components/tasks/CostCard";
import { StatusChangeDialog } from "@/components/tasks/StatusChangeDialog";
import { TaskFormSheet } from "@/components/tasks/TaskFormSheet";
import { TaskListView } from "@/components/tasks/TaskListView";
import { TasksHub } from "@/components/tasks/TasksHub";
import { resetFxCaches } from "@/hooks/use-fx";

function task(overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    _id: "t1",
    ownerId: "admin-1",
    title: "Fix the gate",
    propertyId: "p1",
    property: "Sunrise Court",
    priority: "high",
    status: "open",
    createdBy: "admin-1",
    createdByRole: "admin",
    dueDate: "2026-11-20",
    overdue: true,
    complaintIds: [],
    ...overrides,
  };
}

let calls: { url: string; init?: RequestInit }[] = [];
function mockApi(routes: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const data = key ? routes[key] : null;
      return new Response(JSON.stringify({ data }), { status: data === null ? 404 : 200 });
    }),
  );
}

beforeEach(() => resetFxCaches());
afterEach(() => vi.unstubAllGlobals());

describe("TaskListView", () => {
  it("lists tasks with overdue first and links titles to the detail page", async () => {
    mockApi({
      "/api/v1/tasks?": [
        task({
          _id: "a",
          title: "Paint corridor",
          priority: "low",
          overdue: false,
          dueDate: "2026-12-30",
        }),
        task({ _id: "b", title: "Fix the gate" }),
      ],
      "/api/v1/task-categories": [],
      "/api/v1/features": { tasksV2: true, brokerBids: false, fxDisplay: false },
    });
    render(
      <TaskListView viewerRole="admin" currentUserId="admin-1" basePath="/dashboard/admin/tasks" />,
    );
    const table = await screen.findByRole("table");
    const links = within(table).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Fix the gate");
    expect(links[0]).toHaveAttribute("href", "/dashboard/admin/tasks/b");
    expect(within(table).getAllByText("Overdue").length).toBeGreaterThan(0);
  });

  it("moves a card by dragging it onto an allowed board column", async () => {
    mockApi({
      "/api/v1/tasks?": [task({ _id: "a", title: "Fix the gate" })],
      "/api/v1/task-categories": [],
    });
    render(<TaskListView viewerRole="admin" currentUserId="admin-1" basePath="/x" />);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Board" }));
    const card = (await screen.findByRole("link", { name: "Fix the gate" })).closest("li");
    if (!card) throw new Error("card not found");
    expect(card).toHaveAttribute("draggable", "true");

    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    const inProgress = screen.getByRole("region", { name: "In progress" });
    fireEvent.dragOver(inProgress, { dataTransfer });
    fireEvent.drop(inProgress, { dataTransfer });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows the empty state when there is nothing yet", async () => {
    mockApi({ "/api/v1/tasks?": [], "/api/v1/task-categories": [] });
    render(<TaskListView viewerRole="admin" currentUserId="admin-1" basePath="/x" />);
    expect(await screen.findByText("No tasks yet")).toBeInTheDocument();
  });
});

describe("StatusChangeDialog", () => {
  it("asks whether to resolve linked complaints and sends the answer", async () => {
    mockApi({ "/api/v1/tasks/t1/status": task({ status: "done" }) });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <StatusChangeDialog
        task={task({ complaintIds: ["c1"] })}
        to="done"
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    );
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: /mark done/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const sent = JSON.parse(String(calls.find((c) => c.url.endsWith("/status"))?.init?.body));
    expect(sent).toMatchObject({ status: "done", resolveComplaints: false });
  });

  it("does not ask when no complaint is linked", () => {
    mockApi({});
    render(<StatusChangeDialog task={task()} to="done" onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("TaskFormSheet", () => {
  it("keeps Create disabled until the essentials are filled", async () => {
    mockApi({
      "/api/v1/task-categories": [],
      "/api/v1/tasks/assignees": { staff: [], vendors: [] },
    });
    const user = userEvent.setup();
    render(
      <TaskFormSheet
        open
        onOpenChange={vi.fn()}
        viewerRole="admin"
        currentUserId="admin-1"
        onCreated={vi.fn()}
      />,
    );
    const create = screen.getByRole("button", { name: "Create task" });
    expect(create).toBeDisabled();
    expect(screen.getByText("Add a title")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Fix tap");
    // The single property is preselected, so the form becomes valid.
    await waitFor(() => expect(create).toBeEnabled());
  });

  it("tells caretakers their tasks are assigned to them", () => {
    mockApi({
      "/api/v1/task-categories": [],
      "/api/v1/tasks/assignees": { staff: [], vendors: [] },
    });
    render(
      <TaskFormSheet
        open
        onOpenChange={vi.fn()}
        viewerRole="caretaker"
        currentUserId="c-1"
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByText("Tasks you create are assigned to you.")).toBeInTheDocument();
  });
});

describe("CostCard", () => {
  const pending = task({
    status: "waiting-approval",
    cost: {
      quote: { amount: 9000, by: "c-1", at: "2026-11-25" },
      approval: { status: "pending", approverUserId: "admin-1" },
    },
  });

  it("offers approve/reject only to the approver, and reject needs a reason", async () => {
    mockApi({ "/api/v1/features": { tasksV2: true, brokerBids: false, fxDisplay: false } });
    render(<CostCard task={pending} currentUserId="admin-1" isSupervisor onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("tells everyone else that work waits for the approver", () => {
    mockApi({});
    render(<CostCard task={pending} currentUserId="someone" isSupervisor onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("Work waits until the approver decides.")).toBeInTheDocument();
  });
});

describe("TasksHub", () => {
  it("shows admin-only tabs to admins and hides them from caretakers", async () => {
    mockApi({ "/api/v1/tasks": [], "/api/v1/task-categories": [] });
    const { unmount } = render(<TasksHub viewerRole="admin" basePath="/dashboard/admin/tasks" />);
    for (const name of [
      "Tasks",
      "Complaints",
      "Approvals",
      "Recurring",
      "Service providers",
      "Settings",
    ]) {
      expect(screen.getByRole("tab", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    unmount();
    render(<TasksHub viewerRole="caretaker" basePath="/dashboard/caretaker/tasks" />);
    expect(screen.queryByRole("tab", { name: /Service providers/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Recurring/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Approvals/ })).toBeNull();
  });
});
