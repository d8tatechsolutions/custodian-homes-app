"use client";

import { ArrowLeft, Mail, MessagesSquare, Plus, Send } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { SearchInput } from "@/components/SearchInput";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useChatMutations,
  useChatRequestMutations,
  useChatRequests,
  useChatThreads,
  useThreadMessages,
} from "@/hooks/use-chat";
import { relativeTime } from "@/lib/format";
import { matchesQuery } from "@/lib/search";
import type { ChatRequest, ChatThread, ChatThreadStatus } from "@/types/communications";

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const ContactAvatar = ({ name, className = "" }: { name: string; className?: string }) => (
  <div
    className={`flex items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary ${className}`}
  >
    {initials(name)}
  </div>
);

const isThread = (result: ChatThread | ChatRequest): result is ChatThread => "lastAt" in result;

const ThreadStatusBadge = ({ status }: { status?: ChatThreadStatus }) => {
  if (!status) return null;
  if (status === "pending") {
    return <Badge variant="secondary">Awaiting approval</Badge>;
  }
  if (status === "declined" || status === "cancelled") {
    return <Badge variant="destructive">Declined</Badge>;
  }
  return <Badge variant="outline">Active</Badge>;
};

export interface ChatInboxProps {
  /** Show the "New conversation" picker (tenants and staff can both initiate). */
  canStartConversation?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  searchPlaceholder?: string;
  /** Note rendered above the search row; used by the tenant panel. */
  footerNote?: ReactNode;
}

type InboxTab = "conversations" | "requests";

/**
 * Shared chat body for the tenant Messages page and the staff Communications
 * inbox. Any viewer can start a conversation; non-shared-property recipients
 * must approve the request before messages can be exchanged.
 */
export function ChatInbox({
  canStartConversation = false,
  emptyTitle = "Select a conversation",
  emptyHint = "Messages with your property team appear here.",
  searchPlaceholder = "Search conversations…",
  footerNote,
}: ChatInboxProps) {
  const { items, markThreadRead, bumpThread, refetch } = useChatThreads();
  const { items: requests, loading: requestsLoading, refetch: refetchRequests } = useChatRequests();
  const { approve, decline, pending: deciding } = useChatRequestMutations();
  const [tab, setTab] = useState<InboxTab>("conversations");
  const [query, setQuery] = useState("");
  const visibleItems = items.filter((t) => matchesQuery(query, t.contact, t.lastMessageText));
  const { sendMessage, openThread, startThread } = useChatMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { messages, appendMessage } = useThreadMessages(selectedId);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selected = items.find((t) => t._id === selectedId) ?? null;
  const totalThreads = items.length;
  const unreadThreads = items.filter((t) => t.unread > 0).length;
  const composerBlocked =
    selected?.status === "pending" ||
    selected?.status === "declined" ||
    selected?.status === "cancelled";

  const openThreadAndMarkRead = (id: string) => {
    setSelectedId(id);
    if (items.find((t) => t._id === id)?.unread) {
      markThreadRead(id);
    }
    void openThread(id);
  };

  const send = async () => {
    if (!selected || !draft.trim()) return;
    const text = draft.trim();
    try {
      const message = await sendMessage(selected._id, text);
      appendMessage(message);
      bumpThread(selected._id, { lastAt: message.at, lastMessageText: message.text });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setDraft("");
    }
  };

  const decide = async (id: string, decision: "approved" | "declined") => {
    try {
      if (decision === "approved") await approve(id);
      else await decline(id);
      toast.success(
        decision === "approved" ? "Message request approved" : "Message request declined",
      );
      refetch();
      refetchRequests();
    } catch (err) {
      toast.error("Could not update message request", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const beginConversation = async (contact: {
    userId: string;
    role: "owner" | "caretaker" | "custodian";
    propertyId?: string;
  }) => {
    try {
      const result = contact.propertyId
        ? await startThread(contact.userId, contact.role, contact.propertyId)
        : await startThread(contact.userId, contact.role);
      refetch();
      refetchRequests();
      setPickerOpen(false);
      if (isThread(result)) {
        setSelectedId(result._id);
        setTab("conversations");
      } else {
        toast.info("Message request sent. You can chat once they approve it.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start conversation");
    }
  };

  return (
    <>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <StatCard
          label="Conversations"
          value={totalThreads}
          icon={MessagesSquare}
          hint="Active message threads"
        />
        <StatCard
          label="Unread threads"
          value={unreadThreads}
          icon={Mail}
          hint="Waiting for your reply"
        />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as InboxTab)} className="mt-2">
        <TabsList>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="requests">
            Requests
            {requests.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {requests.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversations">
          <div className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-soft md:grid-cols-[320px_1fr]">
            <div className={`border-r border-border ${selected ? "hidden md:block" : "block"}`}>
              <div className="border-b border-border p-4">
                <h3 className="font-display text-lg font-semibold">Conversations</h3>
              </div>
              <div className="max-h-[32rem] overflow-y-auto">
                {visibleItems.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    No conversations match your search.
                  </p>
                )}
                {visibleItems.map((thread) => (
                  <button
                    key={thread._id}
                    type="button"
                    className={`flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                      thread._id === selectedId ? "bg-muted/50" : ""
                    }`}
                    onClick={() => openThreadAndMarkRead(thread._id)}
                  >
                    <ContactAvatar name={thread.contact} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{thread.contact}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {relativeTime(thread.lastAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted-foreground">
                          {thread.lastMessageText}
                        </p>
                        {thread.unread > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                            {thread.unread}
                          </span>
                        )}
                      </div>
                      {thread.status && (
                        <div className="mt-2">
                          <ThreadStatusBadge status={thread.status} />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className={`flex flex-col ${selected ? "block" : "hidden md:flex"}`}>
              {selected ? (
                <>
                  <div className="flex items-center gap-3 border-b border-border p-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="md:hidden"
                      onClick={() => setSelectedId(null)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <ContactAvatar name={selected.contact} className="h-9 w-9" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{selected.contact}</p>
                        <ThreadStatusBadge status={selected.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selected.role} · {selected.property}
                      </p>
                    </div>
                  </div>
                  <div className="flex max-h-[24rem] flex-1 flex-col gap-3 overflow-y-auto p-4">
                    {messages.map((message) => (
                      <div
                        key={message._id}
                        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                          message.sender === "me"
                            ? "self-end bg-primary text-primary-foreground"
                            : "self-start bg-muted text-foreground"
                        }`}
                      >
                        <p>{message.text}</p>
                        <p
                          className={`mt-1 text-[10px] ${
                            message.sender === "me"
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {relativeTime(message.at)}
                        </p>
                      </div>
                    ))}
                  </div>
                  {composerBlocked ? (
                    <div className="border-t border-border p-4 text-center text-xs text-muted-foreground">
                      {selected.status === "pending"
                        ? "Messaging opens once this request is approved."
                        : "This conversation is closed."}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 border-t border-border p-3">
                      <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void send()}
                        placeholder={`Message ${selected.contact}…`}
                      />
                      <Button
                        size="icon"
                        aria-label="Send message"
                        className="shrink-0 rounded-full"
                        disabled={!draft.trim()}
                        onClick={() => void send()}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
                  <MessagesSquare className="h-10 w-10 text-muted-foreground" />
                  <h3 className="mt-3 font-display text-xl">{emptyTitle}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{emptyHint}</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="requests">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="border-b border-border p-4">
              <h3 className="font-display text-lg font-semibold">Pending requests</h3>
              <p className="text-xs text-muted-foreground">
                Approve or decline requests to start a conversation.
              </p>
            </div>
            {requestsLoading && requests.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Loading message requests…
              </p>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-10 text-center">
                <MessagesSquare className="h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">No pending message requests.</p>
              </div>
            ) : (
              requests.map((request) => {
                const name = request.requesterName || "Someone";
                return (
                  <div
                    key={request._id}
                    className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <ContactAvatar name={name} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {relativeTime(request.createdAt)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {request.propertyTitle
                          ? `Regarding ${request.propertyTitle}`
                          : "Cross-property conversation"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={deciding}
                        aria-label={`Approve request from ${name}`}
                        onClick={() => void decide(request._id, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deciding}
                        aria-label={`Decline request from ${name}`}
                        onClick={() => void decide(request._id, "declined")}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-6 rounded-2xl border border-dashed border-border p-4 text-center">
        {footerNote && <p className="text-xs text-muted-foreground">{footerNote}</p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={searchPlaceholder}
            className="w-full sm:w-56"
          />
          {canStartConversation && (
            <Button variant="outline" className="rounded-full" onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4" />
              New conversation
            </Button>
          )}
        </div>
      </div>

      {canStartConversation && (
        <NewConversationDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={(contact) => void beginConversation(contact)}
        />
      )}
    </>
  );
}

type StaffSearchResult = { id: string; name: string; role: string };

function chatRoleForUserRole(role: string): "owner" | "caretaker" | "custodian" | null {
  if (role === "admin" || role === "system-admin") return "owner";
  if (role === "caretaker") return "caretaker";
  if (role === "custodian") return "custodian";
  return null;
}

function staffRoleLabel(role: "owner" | "caretaker" | "custodian") {
  return role === "owner" ? "Landlord" : role === "custodian" ? "Custodian" : "Caretaker";
}

function NewConversationDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (contact: {
    userId: string;
    role: "owner" | "caretaker" | "custodian";
    propertyId?: string;
  }) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<StaffSearchResult | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const contact = query.trim();
    if (!contact) return;
    const param = contact.includes("@") ? "email" : "phone";
    setSearching(true);
    setError(null);
    setResult(null);
    setSearched(false);
    try {
      const res = await fetch(`/api/v1/users/search?${param}=${encodeURIComponent(contact)}`);
      const json = await res.json();
      if (res.status === 409) {
        setError(json.error ?? "Those details belong to different accounts.");
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Could not look up that contact.");
        return;
      }
      setResult((json.data ?? [])[0] ?? null);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSearching(false);
    }
  };

  const chatRole = result ? chatRoleForUserRole(result.role) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Search by the email or phone number of a caretaker, custodian, or landlord.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
            placeholder="Email or phone number"
            aria-label="Email or phone number"
          />
          <Button type="button" disabled={!query.trim() || searching} onClick={() => void search()}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {!error && searched && !result && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No staff member found. Check the email or phone number and try again.
          </p>
        )}
        {result && chatRole && (
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/50"
            onClick={() => onSelect({ userId: result.id, role: chatRole })}
          >
            <ContactAvatar name={result.name} className="h-10 w-10" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{result.name}</p>
              <p className="truncate text-xs text-muted-foreground">{staffRoleLabel(chatRole)}</p>
            </div>
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
