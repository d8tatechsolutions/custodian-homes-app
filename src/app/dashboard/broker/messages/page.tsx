"use client";

import { ChatInbox } from "@/components/chat/ChatInbox";
import { DashboardShell } from "@/components/DashboardShell";
import { brokerNav as nav } from "@/config/dashboardNav";

const BrokerMessagesPage = () => (
  <DashboardShell
    roleName="Broker"
    nav={nav}
    title="Messages"
    subtitle="Start and manage conversations across your network."
  >
    <ChatInbox canStartConversation emptyHint="Your conversations appear here." />
  </DashboardShell>
);

export default BrokerMessagesPage;
