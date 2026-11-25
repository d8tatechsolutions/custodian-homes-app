import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  info: "border-primary/20 bg-primary/15 text-primary",
  success: "border-success/20 bg-success/15 text-success",
  warning: "border-warning/20 bg-warning/15 text-warning",
  danger: "border-destructive/20 bg-destructive/15 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

interface StatusBadgeProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  /** Small leading dot, useful in dense tables. */
  dot?: boolean;
}

/** One colour language for every status across the app (tasks, bids, invoices, listings). */
export function StatusBadge({ tone, children, className, dot }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
