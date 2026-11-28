"use client";

import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface BoardColumn {
  id: string;
  title: string;
}

interface DndTaskBoardProps<T> {
  columns: BoardColumn[];
  items: T[];
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  /** The column a card currently sits in. */
  columnOf: (item: T) => string;
  /** Whether a card may be dropped on a column (the same rules the menu uses). */
  canDrop: (item: T, columnId: string) => boolean;
  onDrop: (item: T, columnId: string) => void;
  renderCard: (item: T) => ReactNode;
  disabled?: boolean;
  /** Tailwind grid columns for the board, e.g. "md:grid-cols-3". */
  gridClassName?: string;
  emptyText?: string;
}

/** Arrow keys jump a picked-up card to the next / previous column. */
const columnJump: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const rects = [...context.droppableRects.values()].sort(
    (a, b) => a.left - b.left || a.top - b.top,
  );
  if (rects.length === 0) return undefined;
  const x = currentCoordinates.x;
  const centre = (r: (typeof rects)[number]) => ({
    x: r.left + r.width / 2,
    y: r.top + Math.min(40, r.height / 2),
  });
  if (event.code === "ArrowRight" || event.code === "ArrowDown") {
    event.preventDefault();
    const next = rects.find((r) => r.left + r.width / 2 > x + 1) ?? rects[rects.length - 1];
    return centre(next);
  }
  if (event.code === "ArrowLeft" || event.code === "ArrowUp") {
    event.preventDefault();
    const prev = [...rects].reverse().find((r) => r.left + r.width / 2 < x - 1) ?? rects[0];
    return centre(prev);
  }
  return undefined;
};

/** The column under the pointer; falls back to overlap for keyboard and touch. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

function Column({
  column,
  count,
  state,
  children,
}: {
  column: BoardColumn;
  count: number;
  state: "idle" | "allowed" | "over" | "blocked";
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.title} tasks`}
      className={cn(
        "min-w-0 rounded-2xl bg-muted/40 p-3 transition-[box-shadow,opacity]",
        state === "allowed" && "ring-1 ring-primary/30",
        state === "over" && "ring-2 ring-primary",
        state === "blocked" && "opacity-60",
      )}
    >
      <h3 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold">
        {column.title}
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
          {count}
        </span>
      </h3>
      {children}
    </section>
  );
}

function Card({
  id,
  movable,
  hidden,
  children,
}: {
  id: string;
  movable: boolean;
  hidden: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id, disabled: !movable });
  return (
    <li
      ref={setNodeRef}
      {...(movable ? attributes : {})}
      {...(movable ? listeners : {})}
      className={cn(
        "rounded-xl border border-border bg-card p-3 shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-ring",
        movable && "cursor-grab touch-manipulation active:cursor-grabbing",
        hidden && "opacity-40",
      )}
    >
      {children}
    </li>
  );
}

/**
 * Drag-and-drop task board (mouse, touch press-and-hold, and keyboard: Space
 * to pick up, arrows to change column, Space to drop). Dropping only calls
 * `onDrop` when `canDrop` allows it, so the status rules stay in one place.
 */
export function DndTaskBoard<T>({
  columns,
  items,
  getId,
  getTitle,
  columnOf,
  canDrop,
  onDrop,
  renderCard,
  disabled,
  gridClassName = "md:grid-cols-3",
  emptyText = "Nothing here",
}: DndTaskBoardProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [getId(i), i])), [items, getId]);
  const active = activeId ? (byId.get(activeId) ?? null) : null;
  const titleOf = (column: string) => columns.find((c) => c.id === column)?.title ?? column;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnJump }),
  );

  const movable = (item: T) => !disabled && columns.some((c) => canDrop(item, c.id));

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => {
      const item = byId.get(String(a.id));
      return item ? `Picked up ${getTitle(item)}. Use the arrow keys to choose a column.` : "";
    },
    onDragOver: ({ active: a, over }) => {
      const item = byId.get(String(a.id));
      if (!item || !over) return "";
      return canDrop(item, String(over.id))
        ? `Over ${titleOf(String(over.id))}.`
        : `${titleOf(String(over.id))} is not available for this task.`;
    },
    onDragEnd: ({ active: a, over }) => {
      const item = byId.get(String(a.id));
      if (!item || !over || !canDrop(item, String(over.id))) return "Task not moved.";
      return `Moving ${getTitle(item)} to ${titleOf(String(over.id))}.`;
    },
    onDragCancel: () => "Move cancelled.",
  };

  const handleStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleEnd = (e: DragEndEvent) => {
    const item = byId.get(String(e.active.id));
    const target = e.over ? String(e.over.id) : null;
    setActiveId(null);
    setOverId(null);
    if (item && target && target !== columnOf(item) && canDrop(item, target)) onDrop(item, target);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move a task, press Space, use the arrow keys to choose a column, then press Space again. Press Escape to cancel.",
        },
      }}
      onDragStart={handleStart}
      onDragOver={(e) => setOverId(e.over ? String(e.over.id) : null)}
      onDragEnd={handleEnd}
      onDragCancel={() => {
        setActiveId(null);
        setOverId(null);
      }}
    >
      <div className={cn("grid gap-4", gridClassName)}>
        {columns.map((column) => {
          const cards = items.filter((i) => columnOf(i) === column.id);
          const state: "idle" | "allowed" | "over" | "blocked" = !active
            ? "idle"
            : columnOf(active) === column.id
              ? "idle"
              : canDrop(active, column.id)
                ? overId === column.id
                  ? "over"
                  : "allowed"
                : "blocked";
          return (
            <Column key={column.id} column={column} count={cards.length} state={state}>
              <ul className="space-y-2">
                {cards.map((item) => (
                  <Card
                    key={getId(item)}
                    id={getId(item)}
                    movable={movable(item)}
                    hidden={activeId === getId(item)}
                  >
                    {renderCard(item)}
                  </Card>
                ))}
                {cards.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {state === "allowed" || state === "over" ? "Drop here" : emptyText}
                  </li>
                )}
              </ul>
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="rotate-1 cursor-grabbing rounded-xl border border-primary/40 bg-card p-3 shadow-lg">
            {renderCard(active)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Wrap links and menus inside a card: their own keys (Enter / Space) and, with
 * `blockPointer`, presses never start a drag of the card around them.
 */
export function NoDrag({
  children,
  blockPointer = false,
  className,
}: {
  children: ReactNode;
  blockPointer?: boolean;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops events from reaching the card
    <div
      className={className}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={blockPointer ? (e) => e.stopPropagation() : undefined}
      onTouchStart={blockPointer ? (e) => e.stopPropagation() : undefined}
    >
      {children}
    </div>
  );
}
