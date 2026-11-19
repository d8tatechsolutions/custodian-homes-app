"use client";

import { ChatInbox } from "@/components/chat/ChatInbox";
import { DashboardShell } from "@/components/DashboardShell";
import { systemAdminNav as nav } from "@/config/dashboardNav";

const SystemAdminCommunicationsPage = () => (
  <DashboardShell
    roleName="System Admin"
    nav={nav}
    title="Communications"
    subtitle="Conversations you participate in across the platform."
  >
    <ChatInbox canStartConversation emptyHint="Your conversations appear here." />
  </DashboardShell>
);

export default SystemAdminCommunicationsPage;
