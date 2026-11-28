"use client";

import { AuditHistoryView } from "@/components/audit/AuditHistoryView";
import { DashboardShell } from "@/components/DashboardShell";
import { brokerNav } from "@/config/dashboardNav";

const BrokerHistoryPage = () => (
  <DashboardShell
    roleName="Broker"
    nav={brokerNav}
    title="History"
    subtitle="Your own actions and changes to your account."
  >
    <AuditHistoryView />
  </DashboardShell>
);

export default BrokerHistoryPage;
