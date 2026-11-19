import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatRequest, ChatThread } from "@/types/communications";

const mocks = vi.hoisted(() => {
  const threads: ChatThread[] = [];
  const messages: ChatMessage[] = [];
  const requests: ChatRequest[] = [];
  const contacts: Array<{
    userId: string;
    name: string;
    role: "owner" | "caretaker";
    propertyId: string;
    property: string;
  }> = [];
  const refetch = vi.fn();
  const refetchRequests = vi.fn();
  const markThreadRead = vi.fn();
  const bumpThread = vi.fn();
  const openThread = vi.fn();
  const sendMessage = vi.fn();
  const startThread = vi.fn();
  const approve = vi.fn();
  const decline = vi.fn();
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  return {
    threads,
    messages,
    requests,
    contacts,
    refetch,
    refetchRequests,
    approve,
    decline,
    markThreadRead,
    bumpThread,
    openThread,
    sendMessage,
    startThread,
    toast,
    useChatThreads: vi.fn(() => ({
      items: threads,
      loading: false,
      error: null,
      refetch,
      markThreadRead,
      bumpThread,
    })),
    useThreadMessages: vi.fn(() => ({
      messages,
      loading: false,
      error: null,
      appendMessage: (message: ChatMessage) => messages.push(message),
    })),
    useChatMutations: vi.fn(() => ({ sendMessage, openThread, startThread, pending: false })),
    useChatContacts: vi.fn(() => ({ items: contacts, loading: false, error: null, refetch })),
    useChatRequests: vi.fn(() => ({
      items: requests,
      loading: false,
      error: null,
      refetch: refetchRequests,
    })),
    useChatRequestMutations: vi.fn(() => ({ approve, decline, cancel: vi.fn(), pending: false })),
  };
});

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/use-chat", () => ({
  useChatThreads: mocks.useChatThreads,
  useThreadMessages: mocks.useThreadMessages,
  useChatMutations: mocks.useChatMutations,
  useChatContacts: mocks.useChatContacts,
  useChatRequests: mocks.useChatRequests,
  useChatRequestMutations: mocks.useChatRequestMutations,
}));

import { ChatInbox } from "@/components/chat/ChatInbox";

const thread: ChatThread = {
  _id: "thread-1",
  tenantId: "tenant-1",
  propertyId: "prop-1",
  ownerId: "owner-1",
  agentUserId: "owner-1",
  agentRole: "owner",
  contact: "Amina Otieno",
  role: "Tenant",
  property: "Sunset Villa",
  lastAt: "2026-09-02T09:00:00.000Z",
  lastMessageText: "Water tanks Thursday.",
  unread: 2,
};

const message: ChatMessage = {
  _id: "msg-1",
  threadId: "thread-1",
  senderUserId: "owner-1",
  senderRole: "owner",
  sender: "me",
  text: "On my way.",
  at: "2026-09-02T09:30:00.000Z",
};

const chatRequest: ChatRequest = {
  _id: "request-1",
  requesterId: "tenant-2",
  recipientId: "owner-1",
  pairKey: "tenant-2:owner-1",
  propertyId: "prop-1",
  status: "pending",
  requesterName: "Grace Wanjiku",
  propertyTitle: "Sunset Villa",
  createdAt: "2026-09-02T08:00:00.000Z",
};

describe("ChatInbox", () => {
  beforeEach(() => {
    mocks.threads.length = 0;
    mocks.messages.length = 0;
    mocks.requests.length = 0;
    mocks.contacts.length = 0;
    for (const fn of [
      mocks.refetch,
      mocks.refetchRequests,
      mocks.markThreadRead,
      mocks.bumpThread,
      mocks.openThread,
      mocks.sendMessage,
      mocks.startThread,
      mocks.approve,
      mocks.decline,
    ]) {
      fn.mockReset();
    }
    mocks.toast.error.mockClear();
    mocks.toast.success.mockClear();
    mocks.toast.info.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists threads and opens one on click", async () => {
    mocks.threads.push(thread);
    const user = userEvent.setup();
    render(<ChatInbox />);

    await user.click(screen.getByRole("button", { name: /amina otieno/i }));

    expect(mocks.markThreadRead).toHaveBeenCalledWith("thread-1");
    expect(mocks.openThread).toHaveBeenCalledWith("thread-1");
  });

  it("sends a message in the selected thread", async () => {
    mocks.threads.push(thread);
    mocks.sendMessage.mockResolvedValue(message);
    const user = userEvent.setup();
    render(<ChatInbox />);

    await user.click(screen.getByRole("button", { name: /amina otieno/i }));
    await user.type(screen.getByPlaceholderText(/message amina otieno/i), "On my way.");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith("thread-1", "On my way."));
    expect(mocks.bumpThread).toHaveBeenCalled();
  });

  it("hides the new-conversation picker for staff by default", () => {
    render(<ChatInbox />);
    expect(screen.queryByRole("button", { name: /new conversation/i })).not.toBeInTheDocument();
  });

  it("starts a conversation from the tenant search picker", async () => {
    mocks.startThread.mockResolvedValue(thread);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "owner-1", name: "Test Owner", role: "admin" }] }),
      }),
    );
    const user = userEvent.setup();
    render(<ChatInbox canStartConversation />);

    await user.click(screen.getByRole("button", { name: /new conversation/i }));
    await user.type(screen.getByPlaceholderText(/email or phone number/i), "owner@keja.co");
    await user.click(screen.getByRole("button", { name: /search/i }));
    await user.click(await screen.findByRole("button", { name: /test owner/i }));

    await waitFor(() => expect(mocks.startThread).toHaveBeenCalledWith("owner-1", "owner"));
    expect(fetch).toHaveBeenCalledWith("/api/v1/users/search?email=owner%40keja.co");
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("searches by phone and shows an empty state when no staff member matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) }),
    );
    const user = userEvent.setup();
    render(<ChatInbox canStartConversation />);

    await user.click(screen.getByRole("button", { name: /new conversation/i }));
    await user.type(screen.getByPlaceholderText(/email or phone number/i), "+254712345678");
    await user.click(screen.getByRole("button", { name: /search/i }));

    expect(await screen.findByText(/no staff member found/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/v1/users/search?phone=%2B254712345678");
  });

  it("shows the conflict message from a 409 lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "Email and phone belong to different accounts" }),
      }),
    );
    const user = userEvent.setup();
    render(<ChatInbox canStartConversation />);

    await user.click(screen.getByRole("button", { name: /new conversation/i }));
    await user.type(screen.getByPlaceholderText(/email or phone number/i), "owner@keja.co");
    await user.click(screen.getByRole("button", { name: /search/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email and phone belong to different accounts",
    );
  });

  it("lists pending requests and approves one from the Requests tab", async () => {
    mocks.requests.push(chatRequest);
    mocks.approve.mockResolvedValue(chatRequest);
    const user = userEvent.setup();
    render(<ChatInbox />);

    await user.click(screen.getByRole("tab", { name: /requests/i }));
    expect(screen.getByText("Grace Wanjiku")).toBeInTheDocument();
    expect(screen.getByText(/regarding sunset villa/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /approve request from grace wanjiku/i }));

    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith("request-1"));
    expect(mocks.toast.success).toHaveBeenCalledWith("Message request approved");
    expect(mocks.refetch).toHaveBeenCalled();
    expect(mocks.refetchRequests).toHaveBeenCalled();
  });

  it("declines a pending request", async () => {
    mocks.requests.push(chatRequest);
    mocks.decline.mockResolvedValue(chatRequest);
    const user = userEvent.setup();
    render(<ChatInbox />);

    await user.click(screen.getByRole("tab", { name: /requests/i }));
    await user.click(screen.getByRole("button", { name: /decline request from grace wanjiku/i }));

    await waitFor(() => expect(mocks.decline).toHaveBeenCalledWith("request-1"));
    expect(mocks.toast.success).toHaveBeenCalledWith("Message request declined");
  });

  it("shows an empty state in the Requests tab when there are none", async () => {
    const user = userEvent.setup();
    render(<ChatInbox />);
    await user.click(screen.getByRole("tab", { name: /requests/i }));

    expect(screen.getByText(/no pending message requests/i)).toBeInTheDocument();
  });

  it("badges a pending thread and hides the composer", async () => {
    mocks.threads.push({ ...thread, status: "pending" });
    const user = userEvent.setup();
    render(<ChatInbox />);
    await user.click(screen.getByRole("button", { name: /amina otieno/i }));

    expect(screen.getAllByText("Awaiting approval").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument();
    expect(screen.getByText(/messaging opens once this request is approved/i)).toBeInTheDocument();
  });

  it("badges a declined thread and hides the composer", async () => {
    mocks.threads.push({ ...thread, status: "declined" });
    const user = userEvent.setup();
    render(<ChatInbox />);
    await user.click(screen.getByRole("button", { name: /amina otieno/i }));

    expect(screen.getAllByText("Declined").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument();
  });

  it("badges an active thread and keeps the composer available", async () => {
    mocks.threads.push({ ...thread, status: "active" });
    const user = userEvent.setup();
    render(<ChatInbox />);
    await user.click(screen.getByRole("button", { name: /amina otieno/i }));

    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument();
  });

  it("shows a pending-request notice when the picker creates a request", async () => {
    mocks.startThread.mockResolvedValue(chatRequest);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "owner-1", name: "Test Owner", role: "admin" }] }),
      }),
    );
    const user = userEvent.setup();
    render(<ChatInbox canStartConversation />);

    await user.click(screen.getByRole("button", { name: /new conversation/i }));
    await user.type(screen.getByPlaceholderText(/email or phone number/i), "owner@keja.co");
    await user.click(screen.getByRole("button", { name: /search/i }));
    await user.click(await screen.findByRole("button", { name: /test owner/i }));

    await waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith(
        "Message request sent. You can chat once they approve it.",
      ),
    );
    expect(mocks.refetchRequests).toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/message grace wanjiku/i)).not.toBeInTheDocument();
  });
});
