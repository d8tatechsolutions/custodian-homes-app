"use client";

import { caretakerNav, caretakerNavWithTenants } from "@/config/dashboardNav";
import { useAuth } from "@/hooks/use-auth";

export const useCaretakerNav = () => {
  const { user } = useAuth();
  const nav = user?.privileges?.includes("manage_tenants") ? caretakerNavWithTenants : caretakerNav;
  // Tasks requires manage_tasks; without it the page would 403, so hide the
  // entry once the session is known (keep the nav stable while auth loads).
  if (!user || user.privileges?.includes("manage_tasks")) return nav;
  return nav.filter((item) => item.to !== "/dashboard/caretaker/tasks");
};
