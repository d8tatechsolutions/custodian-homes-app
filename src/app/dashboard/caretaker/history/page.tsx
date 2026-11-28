"use client";

import { AuditHistoryView } from "@/components/audit/AuditHistoryView";
import { DashboardShell } from "@/components/DashboardShell";
import { caretakerNav } from "@/config/dashboardNav";

const CaretakerHistoryPage = () => (
  <DashboardShell
    roleName="Caretaker"
    nav={caretakerNav}
    title="History"
    subtitle="Changes on the properties you look after, and your own actions."
  >
    <AuditHistoryView />
  </DashboardShell>
);

export default CaretakerHistoryPage;
