"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { type DetailField, DetailSheet } from "@/components/common/DetailSheet";
import { cn } from "@/lib/utils";

const TITLE_CLASS =
  "rounded-sm text-left font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface TitleCellProps {
  children: ReactNode;
  className?: string;
  /** When the item has its own page, the title links there. */
  href?: string;
  /** Otherwise the title opens a read-only side panel with these details. */
  detail?: {
    title: string;
    subtitle?: string;
    fields: DetailField[];
  };
}

/**
 * Clickable table title: a link where a detail route exists, otherwise a
 * button that opens a read-only drawer. Falls back to plain text when neither
 * is provided so callers can adopt it incrementally.
 */
export function TitleCell({ children, className, href, detail }: TitleCellProps) {
  const [open, setOpen] = useState(false);

  if (href) {
    return (
      <Link href={href} className={cn(TITLE_CLASS, className)}>
        {children}
      </Link>
    );
  }
  if (!detail) {
    return <span className={cn("font-medium text-foreground", className)}>{children}</span>;
  }
  return (
    <>
      <button type="button" className={cn(TITLE_CLASS, className)} onClick={() => setOpen(true)}>
        {children}
      </button>
      <DetailSheet
        open={open}
        onOpenChange={setOpen}
        title={detail.title}
        subtitle={detail.subtitle}
        fields={detail.fields}
      />
    </>
  );
}
