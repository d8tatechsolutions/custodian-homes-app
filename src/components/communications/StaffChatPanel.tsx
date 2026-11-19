"use client";

import { ChatInbox } from "@/components/chat/ChatInbox";

/** Staff chat inbox — rendered inside the Communications tabs of every staff role. */
export function StaffChatPanel() {
  return <ChatInbox canStartConversation emptyHint="Messages from tenants appear here." />;
}
