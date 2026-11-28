import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((event: unknown) => void) }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  return {
    ...real,
    DndContext: (props: Parameters<typeof real.DndContext>[0]) => {
      dnd.onDragEnd = (props.onDragEnd as (event: unknown) => void) ?? null;
      return createElement(real.DndContext, props);
    },
  };
});

import { LegacyTaskBoard, legacyMoves } from "@/components/tasks/LegacyTaskBoard";

const tasks = [
  { _id: "a", title: "Fix the gate", status: "open", priority: "high", property: "Palm Court" },
  { _id: "b", title: "Paint the hall", status: "in-progress", priority: "low" },
  { _id: "c", title: "Replace bulb", status: "done", priority: "medium" },
];

function renderBoard(onMove = vi.fn(), disabled = false) {
  render(
    <LegacyTaskBoard
      tasks={tasks}
      resolveAssignee={(t) => (t._id === "a" ? "Amka" : "")}
      onMove={onMove}
      disabled={disabled}
    />,
  );
  return onMove;
}

describe("legacyMoves (same moves as the existing buttons)", () => {
  it("allows open ↔ in progress, either → done, and done → open only", () => {
    expect(legacyMoves("open")).toEqual(["in-progress", "done"]);
    expect(legacyMoves("in-progress")).toEqual(["open", "done"]);
    expect(legacyMoves("done")).toEqual(["open"]);
    expect(legacyMoves("cancelled")).toEqual([]);
  });
});

describe("LegacyTaskBoard", () => {
  it("shows three columns with their cards", () => {
    renderBoard();
    const open = screen.getByRole("region", { name: "Open tasks" });
    expect(within(open).getByText("Fix the gate")).toBeInTheDocument();
    expect(within(open).getByText("Amka")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "In progress tasks" })).getByText("Paint the hall"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Done tasks" })).getByText("Replace bulb"),
    ).toBeInTheDocument();
  });

  it("moves a card dropped on an allowed column", () => {
    const onMove = renderBoard();
    act(() => dnd.onDragEnd?.({ active: { id: "a" }, over: { id: "in-progress" } }));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ _id: "a" }), "in-progress");
  });

  it("ignores drops on its own column, a disallowed column, or nowhere", () => {
    const onMove = renderBoard();
    act(() => dnd.onDragEnd?.({ active: { id: "a" }, over: { id: "open" } }));
    act(() => dnd.onDragEnd?.({ active: { id: "c" }, over: { id: "in-progress" } }));
    act(() => dnd.onDragEnd?.({ active: { id: "b" }, over: null }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does nothing while a save is in progress", () => {
    const onMove = renderBoard(vi.fn(), true);
    act(() => dnd.onDragEnd?.({ active: { id: "a" }, over: { id: "done" } }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("offers a Move to menu for phones and keyboards", async () => {
    const onMove = renderBoard();
    await userEvent.click(screen.getByRole("combobox", { name: "Move Replace bulb" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Open"]);
    await userEvent.click(screen.getByRole("option", { name: "Open" }));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ _id: "c" }), "open");
  });
});
