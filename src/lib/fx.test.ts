/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildQuery, type createModelStub } from "@/test/utils/model-mocks";

const { fxRate } = vi.hoisted(() => ({ fxRate: {} as ReturnType<typeof createModelStub> }));
vi.mock("@/models/FxRate", async () => {
  const { createModelStub: make } = await import("@/test/utils/model-mocks");
  Object.assign(fxRate, make());
  return { FxRate: fxRate };
});

import { FX_PROVIDER_URL, getUsdKesRate, getUsdKesRateOn, refreshUsdKesRate } from "@/lib/fx";
import {
  convertAmount,
  convertMinor,
  formatCurrency,
  formatDual,
  isCurrency,
  isPlausibleKesRate,
} from "@/lib/fx-math";

const NOW = new Date("2026-11-25T06:00:00Z");

function providerOk(rate = 129.25, unix = Date.parse("2026-11-25T00:00:01Z") / 1000) {
  return new Response(
    JSON.stringify({
      result: "success",
      base_code: "USD",
      time_last_update_unix: unix,
      rates: { KES: rate },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const fn of Object.values(fxRate)) (fn as ReturnType<typeof vi.fn>).mockReset?.();
  fxRate.updateOne.mockResolvedValue({ acknowledged: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fx-math", () => {
  it("converts both ways and rounds to cents", () => {
    expect(convertAmount(100, "USD", "KES", 129.25)).toBe(12925);
    expect(convertAmount(12925, "KES", "USD", 129.25)).toBe(100);
    expect(convertAmount(1000, "KES", "USD", 129.25)).toBe(7.74);
    expect(convertAmount(55.555, "KES", "KES", 129.25)).toBe(55.56);
  });

  it("converts minor units", () => {
    expect(convertMinor(10_000, "USD", "KES", 129.25)).toBe(1_292_500);
  });

  it("rejects a missing rate for cross-currency conversion", () => {
    expect(() => convertAmount(1, "USD", "KES", 0)).toThrow(/positive exchange rate/);
  });

  it("formats single and dual amounts", () => {
    expect(formatCurrency(12925, "KES")).toMatch(/12,925/);
    expect(formatCurrency(100, "USD")).toBe("$100.00");
    const dual = formatDual(12925, "KES", 129.25);
    expect(dual.secondary).toBe("≈ $100.00");
    expect(formatDual(10, "KES", null).secondary).toBeNull();
  });

  it("validates currencies and plausible rates", () => {
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("EUR")).toBe(false);
    expect(isPlausibleKesRate(129)).toBe(true);
    expect(isPlausibleKesRate(1.29)).toBe(false);
    expect(isPlausibleKesRate(Number.NaN)).toBe(false);
  });
});

describe("refreshUsdKesRate", () => {
  it("stores the provider rate for the published day", async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerOk());
    vi.stubGlobal("fetch", fetchMock);
    const quote = await refreshUsdKesRate(NOW);
    expect(fetchMock).toHaveBeenCalledWith(FX_PROVIDER_URL, expect.anything());
    expect(quote).toMatchObject({ rate: 129.25, effectiveDate: "2026-11-25", stale: false });
    expect(fxRate.updateOne).toHaveBeenCalledWith(
      { base: "USD", quote: "KES", effectiveDate: "2026-11-25" },
      { $set: expect.objectContaining({ rate: 129.25 }) },
      { upsert: true },
    );
  });

  it("returns null and stores nothing on outage, bad payload or implausible rate", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await refreshUsdKesRate(NOW)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    expect(await refreshUsdKesRate(NOW)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerOk(1.2)));
    expect(await refreshUsdKesRate(NOW)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
    expect(await refreshUsdKesRate(NOW)).toBeNull();
    expect(fxRate.updateOne).not.toHaveBeenCalled();
  });
});

describe("getUsdKesRate", () => {
  it("serves a fresh cached rate without calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fxRate.findOne.mockReturnValue(
      buildQuery({
        rate: 129,
        effectiveDate: "2026-11-25",
        source: "x",
        fetchedAt: "2026-11-25T03:00:00Z",
      }),
    );
    expect(await getUsdKesRate(NOW)).toMatchObject({ rate: 129, stale: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a stale rate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerOk(130)));
    fxRate.findOne.mockReturnValue(
      buildQuery({
        rate: 129,
        effectiveDate: "2026-11-20",
        source: "x",
        fetchedAt: "2026-11-20T03:00:00Z",
      }),
    );
    expect(await getUsdKesRate(NOW)).toMatchObject({ rate: 130, stale: false });
  });

  it("falls back to the last known rate, flagged stale, when the provider is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fxRate.findOne.mockReturnValue(
      buildQuery({
        rate: 129,
        effectiveDate: "2026-11-20",
        source: "x",
        fetchedAt: "2026-11-20T03:00:00Z",
      }),
    );
    expect(await getUsdKesRate(NOW)).toMatchObject({ rate: 129, stale: true });
  });

  it("returns null when nothing is stored and the provider is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    fxRate.findOne.mockReturnValue(buildQuery(null));
    expect(await getUsdKesRate(NOW)).toBeNull();
  });
});

describe("getUsdKesRateOn", () => {
  it("uses the newest rate on or before the day", async () => {
    fxRate.findOne.mockReturnValueOnce(
      buildQuery({
        rate: 128,
        effectiveDate: "2026-11-10",
        source: "x",
        fetchedAt: "2026-11-10T03:00:00Z",
      }),
    );
    expect(await getUsdKesRateOn("2026-11-12", NOW)).toMatchObject({ rate: 128, stale: false });
    expect(fxRate.findOne).toHaveBeenCalledWith({
      base: "USD",
      quote: "KES",
      effectiveDate: { $lte: "2026-11-12" },
    });
  });

  it("falls back to the earliest stored rate for days before our history", async () => {
    fxRate.findOne.mockReturnValueOnce(buildQuery(null)).mockReturnValueOnce(
      buildQuery({
        rate: 127,
        effectiveDate: "2026-11-25",
        source: "x",
        fetchedAt: "2026-11-25T03:00:00Z",
      }),
    );
    expect(await getUsdKesRateOn("2025-01-01", NOW)).toMatchObject({ rate: 127 });
  });
});
