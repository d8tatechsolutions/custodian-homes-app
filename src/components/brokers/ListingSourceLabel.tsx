"use client";

import { useReleaseFlags } from "@/hooks/use-fx";
import { cn } from "@/lib/utils";

/** "Listed by owner" / "Shared by a broker", shown once the broker release is on. */
export function ListingSourceLabel({
  broker,
  className,
}: {
  broker?: boolean;
  className?: string;
}) {
  const { flags } = useReleaseFlags();
  if (!flags.brokerBids) return null;
  return (
    <span className={cn("text-[11px] text-muted-foreground", className)}>
      {broker ? "Shared by a broker" : "Listed by owner"}
    </span>
  );
}
