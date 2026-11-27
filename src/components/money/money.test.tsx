import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Money } from "@/components/money/Money";
import { MoneyInput, type MoneyValue } from "@/components/money/MoneyInput";
import { resetFxCaches } from "@/hooks/use-fx";

function mockApi(flags: { fxDisplay: boolean }, rate = 129.25) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/v1/features")) {
        return new Response(
          JSON.stringify({ data: { tasksV2: false, brokerBids: false, ...flags } }),
        );
      }
      if (url.startsWith("/api/v1/fx")) {
        return new Response(
          JSON.stringify({
            data: { rate, effectiveDate: "2026-11-25", source: "test", stale: false },
          }),
        );
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

beforeEach(() => resetFxCaches());
afterEach(() => vi.unstubAllGlobals());

describe("Money", () => {
  it("shows only KES when the FX display flag is off", async () => {
    mockApi({ fxDisplay: false });
    render(<Money amount={12925} />);
    expect(screen.getByText(/12,925/)).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/v1/features"));
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it("adds the USD equivalent when the flag is on", async () => {
    mockApi({ fxDisplay: true });
    render(<Money amount={12925} />);
    expect(await screen.findByText("≈ $100.00")).toBeInTheDocument();
  });

  it("uses a supplied historical rate instead of today's", async () => {
    mockApi({ fxDisplay: true });
    render(<Money amount={13000} rate={130} rateDate="2026-01-01" />);
    expect(await screen.findByText("≈ $100.00")).toBeInTheDocument();
  });
});

function Harness({ initial }: { initial: MoneyValue }) {
  const [value, setValue] = useState<MoneyValue>(initial);
  return (
    <>
      <MoneyInput label="Commission" value={value} onChange={setValue} />
      <output data-testid="state">{JSON.stringify(value)}</output>
    </>
  );
}

describe("MoneyInput", () => {
  it("switches currency and shows the live conversion", async () => {
    mockApi({ fxDisplay: true });
    const user = userEvent.setup();
    render(<Harness initial={{ amount: "", currency: "KES" }} />);
    await user.type(screen.getByRole("spinbutton"), "12925");
    expect(await screen.findByText(/≈ \$100\.00 at 1 USD = 129\.25 KES/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "USD" }));
    expect(screen.getByTestId("state")).toHaveTextContent('"currency":"USD"');
    expect(await screen.findByText(/≈ Ksh/)).toBeInTheDocument();
  });

  it("hides the switch when only one currency is allowed", () => {
    mockApi({ fxDisplay: true });
    render(
      <MoneyInput
        label="Amount"
        value={{ amount: 10, currency: "KES" }}
        onChange={() => {}}
        currencies={["KES"]}
      />,
    );
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
