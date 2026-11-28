"use client";

import { AuditHistoryView } from "@/components/audit/AuditHistoryView";
import { DashboardShell } from "@/components/DashboardShell";
import { tenantNav } from "@/config/dashboardNav";

const TenantHistoryPage = () => (
  <DashboardShell
    roleName="Tenant"
    nav={tenantNav}
    title="History"
    subtitle="Changes to your invoices, payments, lease and account."
  >
    <AuditHistoryView />
  </DashboardShell>
);

export default TenantHistoryPage;
