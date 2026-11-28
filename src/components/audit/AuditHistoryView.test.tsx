import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { AuditHistoryView } from "@/components/audit/AuditHistoryView";

const entry = {
  id: "e1",
  at: "2026-11-28T08:00:00.000Z",
  action: "invoice.payment_recorded",
  label: "Payment recorded by hand",
  entityType: "invoice",
  entityId: "i1",
  actor: { name: "Amka", role: "Caretaker", isYou: false },
  propertyId: "p1",
  propertyTitle: "Palm Court",
  changes: [{ field: "amountPaid", before: "0", after: "5000" }],
  notes: [],
};

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
}

function page(canAddNotes: boolean) {
  return { data: [entry], pagination: { page: 1, total: 1, totalPages: 1 }, canAddNotes };
}

afterEach(() => {
  vi.unstubAllGlobals();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("AuditHistoryView", () => {
  it("lists entries with who, where and the changed fields", async () => {
    const fetchMock = vi.fn<FetchFn>(() => respond(page(false)));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuditHistoryView />);

    expect(await screen.findByText("Payment recorded by hand")).toBeInTheDocument();
    expect(screen.getByText("Amka")).toBeInTheDocument();
    expect(screen.getByText(/Palm Court/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add note/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show details/i }));
    expect(screen.getByText("Amount paid")).toBeInTheDocument();
    expect(screen.getByText("5000")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/audit?page=1&limit=20");
  });

  it("lets the platform admin add a note without changing the entry", async () => {
    const fetchMock = vi.fn<FetchFn>((url) =>
      url.includes("/notes")
        ? respond({
            data: { id: "n1", authorName: "Admin", text: "Confirmed", createdAt: "" },
          })
        : respond(page(true)),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AuditHistoryView />);

    await userEvent.click(await screen.findByRole("button", { name: /add note/i }));
    await userEvent.type(screen.getByRole("textbox"), "Confirmed");
    await userEvent.click(screen.getByRole("button", { name: /save note/i }));

    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => u.includes("/notes"));
    const [url, init = {}] = call ?? [""];
    expect(url).toBe("/api/v1/audit/e1/notes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ text: "Confirmed" });
    expect(toast.success).toHaveBeenCalledWith("Note added");
  });

  it("shows the server's message when loading fails, and an empty state otherwise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => respond({ error: "Unauthorized" }, false)),
    );
    const { unmount } = render(<AuditHistoryView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => respond({ data: [], pagination: { page: 1, total: 0, totalPages: 0 } })),
    );
    render(<AuditHistoryView />);
    await waitFor(() => expect(screen.getByText("Nothing recorded yet")).toBeInTheDocument());
  });
});
