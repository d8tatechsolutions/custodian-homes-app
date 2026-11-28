"use client";

import { AuditHistoryView } from "@/components/audit/AuditHistoryView";
import { DashboardShell } from "@/components/DashboardShell";
import { systemAdminNav } from "@/config/dashboardNav";

const SystemAdminHistoryPage = () => (
  <DashboardShell
    roleName="System admin"
    nav={systemAdminNav}
    title="History"
    subtitle="Every recorded change on the platform. Add notes to explain or correct an entry."
  >
    <AuditHistoryView />
  </DashboardShell>
);

export default SystemAdminHistoryPage;
