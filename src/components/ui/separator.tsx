import { cn } from "@/lib/utils";

interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

/** Visual divider. Horizontal renders a semantic <hr>; vertical is decorative. */
export function Separator({ className, orientation = "horizontal" }: SeparatorProps) {
  if (orientation === "vertical") {
    return <span aria-hidden="true" className={cn("h-full w-px shrink-0 bg-border", className)} />;
  }
  return <hr className={cn("h-px w-full shrink-0 border-0 bg-border", className)} />;
}
