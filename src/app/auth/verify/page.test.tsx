import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerifyPage from "./page";

const replaceMock = vi.fn();
let currentToken: string | null = "test-token";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === "token" ? currentToken : null),
  }),
}));

describe("VerifyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentToken = "test-token";
  });

  it("shows error when token is missing", async () => {
    currentToken = null;
    render(<VerifyPage />);

    expect(
      await screen.findByText("This verification link is missing a token."),
    ).toBeInTheDocument();
  });

  it("calls verify-email and displays success state with redirect link", async () => {
    currentToken = "good-token";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: "Email verified successfully",
        redirectTo: "/dashboard/tenant",
      }),
    } as Response);

    render(<VerifyPage />);

    expect(await screen.findByText("Email verified")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /continue to dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard/tenant");

    await waitFor(
      () => {
        expect(replaceMock).toHaveBeenCalledWith("/dashboard/tenant");
      },
      { timeout: 2500 },
    );
  });

  it("shows error state when verification API fails", async () => {
    currentToken = "failing-token";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid or expired verification token" }),
    } as Response);

    render(<VerifyPage />);

    expect(await screen.findByText("Invalid or expired verification token")).toBeInTheDocument();
  });

  it("sends one request when the page runs twice, so a used link never shows as failed", async () => {
    currentToken = "once-token";
    // The second call would fail like the real server (token already used).
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redirectTo: "/dashboard/tenant" }),
      } as Response)
      .mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Invalid or expired verification token" }),
      } as Response);

    render(
      <StrictMode>
        <VerifyPage />
      </StrictMode>,
    );

    expect(await screen.findByText("Email verified")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Invalid or expired verification token")).toBeNull();
  });
});
