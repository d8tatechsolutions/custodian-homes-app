"use client";

import { AuditHistoryView } from "@/components/audit/AuditHistoryView";
import { DashboardShell } from "@/components/DashboardShell";
import { custodianNav } from "@/config/dashboardNav";

const CustodianHistoryPage = () => (
  <DashboardShell
    roleName="Custodian"
    nav={custodianNav}
    title="History"
    subtitle="Changes on the properties you manage, and your own actions."
  >
    <AuditHistoryView />
  </DashboardShell>
);

export default CustodianHistoryPage;
