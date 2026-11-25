"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface DetailField {
  label: string;
  value: ReactNode;
}

interface DetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  fields: DetailField[];
  /** Optional link to the item's full page. */
  href?: string;
  hrefLabel?: string;
  children?: ReactNode;
}

/** Read-only side panel for quick views of a row (clickable titles where no detail page exists). */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  fields,
  href,
  hrefLabel = "Open full page",
  children,
}: DetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle className="break-words">{title}</SheetTitle>
          {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
        </SheetHeader>
        <dl className="mt-6 divide-y divide-border/60 rounded-xl border border-border">
          {fields.map((field) => (
            <div key={field.label} className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="col-span-2 break-words text-foreground">
                {field.value === "" || field.value == null ? "—" : field.value}
              </dd>
            </div>
          ))}
        </dl>
        {children ? <div className="mt-6">{children}</div> : null}
        {href ? (
          <Button asChild variant="outline" className="mt-6 w-full rounded-full">
            <Link href={href}>
              {hrefLabel}
              <ExternalLink className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
