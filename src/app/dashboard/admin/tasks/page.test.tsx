import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const emptyList: never[] = [];
  return {
    useProperties: () => ({ properties: emptyList, loading: false, error: null, refetch: vi.fn() }),
    useCaretakers: () => ({ caretakers: emptyList, loading: false, error: null, refetch: vi.fn() }),
    useTasks: () => ({
      items: emptyList,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }),
    useTaskMutations: () => ({
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      pending: false,
    }),
  };
});

vi.mock("@/components/DashboardShell", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    DashboardShell: (props: { title?: string; children?: React.ReactNode }) =>
      createElement(Fragment, null, props.title, props.children),
  };
});
// Tasks v2 is behind a release flag; with it off the page is the legacy one under test.
vi.mock("@/hooks/use-fx", () => ({
  useReleaseFlags: () => ({
    flags: { tasksV2: false, brokerBids: false, fxDisplay: false },
    loading: false,
  }),
}));
vi.mock("@/hooks/use-properties", () => ({ useProperties: mocks.useProperties }));
vi.mock("@/hooks/use-caretakers", () => ({ useCaretakers: mocks.useCaretakers }));
vi.mock("@/hooks/use-tasks", () => ({
  useTasks: mocks.useTasks,
  useTaskMutations: mocks.useTaskMutations,
}));

import AdminTasksPage from "@/app/dashboard/admin/tasks/page";

describe("admin tasks page", () => {
  it("renders the tasks shell and stat cards", () => {
    render(<AdminTasksPage />);
    expect(screen.getByText("Tasks & Maintenance")).toBeInTheDocument();
    expect(screen.getByText("Open tasks")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("shows the empty state when no tasks are loaded", () => {
    render(<AdminTasksPage />);
    expect(screen.getByText("No open tasks match your query.")).toBeInTheDocument();
  });
});
