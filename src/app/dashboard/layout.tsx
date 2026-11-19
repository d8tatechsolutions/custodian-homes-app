"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { NavAccordionProvider } from "@/contexts/NavAccordionContext";
import { useAuth } from "@/hooks/use-auth";
import { getDashboardAllowedRoles } from "@/lib/role-routes";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const allowedRoles = getDashboardAllowedRoles(pathname);
  const { user } = useAuth();

  return (
    <AuthGuard allowedRoles={allowedRoles}>
      <NavAccordionProvider role={user?.role}>{children}</NavAccordionProvider>
    </AuthGuard>
  );
}
