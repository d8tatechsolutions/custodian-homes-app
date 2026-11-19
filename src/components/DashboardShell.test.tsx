import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home } from "lucide-react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: { value: "/dashboard/admin" },
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname.value,
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));

vi.mock("@/components/Logo", () => ({ Logo: () => <div data-testid="logo" /> }));
vi.mock("@/components/NotificationsBell", () => ({ NotificationsBell: () => null }));
vi.mock("@/components/SearchBar", () => ({ SearchBar: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

import { DashboardShell } from "@/components/DashboardShell";
import { adminNav } from "@/config/dashboardNav";
import { NavAccordionProvider } from "@/contexts/NavAccordionContext";

const withProvider = (children: ReactNode) =>
  createElement(NavAccordionProvider, { role: "admin", children });

const renderShell = (
  nav: React.ComponentProps<typeof DashboardShell>["nav"] = adminNav,
  pathname = "/dashboard/admin",
) => {
  mocks.pathname.value = pathname;
  return render(
    withProvider(
      <DashboardShell roleName="Administrator" nav={nav} title="Dashboard">
        <div>Page content</div>
      </DashboardShell>,
    ),
  );
};

describe("DashboardShell nav accordion", () => {
  beforeEach(() => {
    mocks.pathname.value = "/dashboard/admin";
    mocks.push.mockClear();
    window.localStorage.clear();
  });

  it("keeps only one group open at a time", async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "People" }));
    expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Properties" }));
    expect(screen.getByRole("button", { name: "Properties" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "People" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("toggles a group with Enter and Space", async () => {
    const user = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole("button", { name: "People" });
    trigger.focus();

    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("auto-opens the group containing the active deep link", () => {
    renderShell(adminNav, "/dashboard/admin/portfolio/123");

    expect(screen.getByRole("button", { name: "Properties" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Portfolio" })).toHaveAttribute("aria-current", "page");
  });

  it("renders the grouped nav in the mobile sheet and closes it on item click", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog");
    const peopleTrigger = within(dialog).getByRole("button", { name: "People" });

    await user.click(peopleTrigger);
    expect(peopleTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-expanded", "true");

    await user.click(within(dialog).getByRole("link", { name: "Tenants" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renders ungrouped items as standalone links when no groups exist", () => {
    renderShell([{ to: "/dashboard/admin", label: "Plain Overview", icon: Home }]);

    expect(screen.getByRole("link", { name: "Plain Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /overview/i })).toBeNull();
  });

  it("returns focus to the trigger when a focused group collapses", async () => {
    const view = renderShell();
    const overviewTrigger = screen.getByRole("button", { name: "Overview" });
    screen.getByRole("link", { name: "Overview" }).focus();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveFocus();

    mocks.pathname.value = "/dashboard/admin/portfolio";
    view.rerender(
      withProvider(
        <DashboardShell roleName="Administrator" nav={adminNav} title="Dashboard">
          <div>Page content</div>
        </DashboardShell>,
      ),
    );

    await waitFor(() => expect(overviewTrigger).toHaveFocus());
    expect(screen.getByRole("button", { name: "Properties" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
