"use client";

import { AuditHistoryView } from "@/components/audit/AuditHistoryView";
import { DashboardShell } from "@/components/DashboardShell";
import { adminNav } from "@/config/dashboardNav";

const AdminHistoryPage = () => (
  <DashboardShell
    roleName="Owner"
    nav={adminNav}
    title="History"
    subtitle="Changes on your properties, payments and team — who did what, and when."
  >
    <AuditHistoryView />
  </DashboardShell>
);

export default AdminHistoryPage;
