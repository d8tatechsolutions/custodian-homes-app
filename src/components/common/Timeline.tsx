import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  /** Marks the dot as done/current/pending (progress timelines). */
  state?: "done" | "current" | "pending";
}

interface TimelineProps {
  items: TimelineItem[];
  className?: string;
  emptyText?: string;
}

const DOT: Record<NonNullable<TimelineItem["state"]>, string> = {
  done: "border-primary bg-primary",
  current: "border-primary bg-background ring-4 ring-primary/20",
  pending: "border-border bg-background",
};

export function Timeline({ items, className, emptyText = "Nothing yet." }: TimelineProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ol className={cn("relative space-y-5 border-l border-border pl-6", className)}>
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              "absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2",
              DOT[item.state ?? "done"],
            )}
          />
          <div className="text-sm font-medium text-foreground">{item.title}</div>
          {item.meta ? <div className="text-xs text-muted-foreground">{item.meta}</div> : null}
          {item.body ? <div className="mt-1.5 text-sm text-foreground/90">{item.body}</div> : null}
        </li>
      ))}
    </ol>
  );
}
