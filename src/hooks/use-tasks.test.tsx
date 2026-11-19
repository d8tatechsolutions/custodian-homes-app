import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskMutations, useTasks } from "@/hooks/use-tasks";
import type { Task } from "@/types/communications";

const task: Task = {
  _id: "task-1",
  title: "Inspect water tank",
  propertyId: "prop-1",
  property: "Sunrise Apartments",
  priority: "high",
  status: "open",
  assignedTo: "user-1",
  assignedToName: "John Kiprono",
  createdBy: "owner-1",
  createdByRole: "owner",
  createdByName: "Mary Wanjiku",
  dueDate: "2026-11-25",
  notes: "Check the lid seal.",
  createdAt: "2026-11-18T08:00:00.000Z",
  updatedAt: "2026-11-18T08:00:00.000Z",
};

function stubFetch(json: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue(json) }),
  );
}

describe("useTasks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads tasks from GET /api/v1/tasks?limit=100", async () => {
    stubFetch({ data: [task] });
    const { result } = renderHook(() => useTasks());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([task]);
    expect(result.current.error).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v1/tasks?limit=100");
  });

  it("surfaces a non-ok response error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({ error: "Forbidden" }),
      }),
    );
    const { result } = renderHook(() => useTasks());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Forbidden");
    expect(result.current.items).toEqual([]);
  });

  it("refetch triggers another GET request", async () => {
    stubFetch({ data: [task] });
    const { result } = renderHook(() => useTasks());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(result.current.items).toEqual([task]);
  });

  it("builds status and propertyId filters as query params", async () => {
    stubFetch({ data: [task] });
    renderHook(() => useTasks({ status: "open", propertyId: "prop-1" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/v1/tasks?limit=100&status=open&propertyId=prop-1"),
    );
  });
});

describe("useTaskMutations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createTask POSTs the payload and returns the created row", async () => {
    stubFetch({ data: task });
    const { result } = renderHook(() => useTaskMutations());

    const input = {
      title: "Inspect water tank",
      propertyId: "prop-1",
      priority: "high" as const,
      status: "open" as const,
      assignedTo: "user-1",
      assignedToName: "John Kiprono",
      dueDate: "2026-11-25",
      notes: "Check the lid seal.",
    };
    let out: Task | undefined;
    await act(async () => {
      out = await result.current.createTask(input);
    });

    expect(out).toEqual(task);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("createTask throws the API error on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ error: "Invalid task payload" }),
      }),
    );
    const { result } = renderHook(() => useTaskMutations());

    let rejection: unknown;
    await act(async () => {
      rejection = await result.current
        .createTask({ title: "", dueDate: "2026-11-25" })
        .catch((err: unknown) => err);
    });
    expect((rejection as Error).message).toBe("Invalid task payload");
  });

  it("updateTask PATCHes the id with the payload and returns the updated row", async () => {
    const updated = { ...task, status: "done" as const };
    stubFetch({ data: updated });
    const { result } = renderHook(() => useTaskMutations());

    const input = { status: "done" as const, completedAt: "2026-11-19T10:00:00.000Z" };
    let out: Task | undefined;
    await act(async () => {
      out = await result.current.updateTask("task-1", input);
    });

    expect(out).toEqual(updated);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v1/tasks/task-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updateTask throws the API error on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: "Task not found" }),
      }),
    );
    const { result } = renderHook(() => useTaskMutations());

    let rejection: unknown;
    await act(async () => {
      rejection = await result.current
        .updateTask("task-1", { status: "done" })
        .catch((err: unknown) => err);
    });
    expect((rejection as Error).message).toBe("Task not found");
  });

  it("deleteTask DELETEs the id", async () => {
    stubFetch({ data: { _id: "task-1" } });
    const { result } = renderHook(() => useTaskMutations());

    await act(async () => {
      await result.current.deleteTask("task-1");
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v1/tasks/task-1", {
      method: "DELETE",
    });
  });

  it("deleteTask throws the API error on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({ error: "Forbidden" }),
      }),
    );
    const { result } = renderHook(() => useTaskMutations());

    let rejection: unknown;
    await act(async () => {
      rejection = await result.current.deleteTask("task-1").catch((err: unknown) => err);
    });
    expect((rejection as Error).message).toBe("Forbidden");
  });
});
