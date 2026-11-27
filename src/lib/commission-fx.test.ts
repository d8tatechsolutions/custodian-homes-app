import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildQuery } from "@/test/utils/model-mocks";

const { accrualStub, payoutStub, rateStub } = vi.hoisted(() => ({
  accrualStub: {
    find: vi.fn(),
    updateMany: vi.fn(),
    countDocuments: vi.fn(),
  },
  payoutStub: { findById: vi.fn(), create: vi.fn(), updateOne: vi.fn() },
  rateStub: vi.fn(),
}));

vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("@/lib/fx", () => ({ getUsdKesRateOn: rateStub }));
vi.mock("@/models/Attribution", () => ({ Attribution: { findOne: vi.fn() } }));
vi.mock("@/models/CommissionAccrual", () => ({ CommissionAccrual: accrualStub }));
vi.mock("@/models/CommissionPayout", () => ({ CommissionPayout: payoutStub }));
vi.mock("@/models/CommissionAgreement", () => ({ CommissionAgreement: { findById: vi.fn() } }));

import { createPayoutBatch, executePayout } from "@/lib/commission";

const admin = { userId: "sys-1", role: "system-admin" as const };

beforeEach(() => {
  vi.clearAllMocks();
  accrualStub.updateMany.mockResolvedValue({ modifiedCount: 0 });
  payoutStub.create.mockResolvedValue({ _id: "payout-1" });
  payoutStub.findById.mockReturnValue(buildQuery({ _id: "payout-1", status: "approved" }));
  payoutStub.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe("USD-agreed commission payouts", () => {
  it("leaves KES-only batches exactly as before (no rate lookup)", async () => {
    accrualStub.find.mockReturnValue(
      buildQuery([
        { _id: "a", grossMinor: 10_000, taxMinor: 1_000, netMinor: 9_000, currency: "KES" },
      ]),
    );
    await createPayoutBatch(admin, "broker-1");
    expect(rateStub).not.toHaveBeenCalled();
    const doc = payoutStub.create.mock.calls[0][0];
    expect(doc).toMatchObject({ netMinor: 9_000, currency: "KES" });
    expect(doc.fx).toBeUndefined();
  });

  it("converts USD accruals to KES and records the USD amount, rate and date", async () => {
    rateStub.mockResolvedValue({ rate: 130, effectiveDate: "2026-11-26", source: "t" });
    accrualStub.find.mockReturnValue(
      buildQuery([
        { _id: "a", grossMinor: 10_000, taxMinor: 1_000, netMinor: 9_000, currency: "KES" },
        // $100.00 net
        { _id: "b", grossMinor: 11_000, taxMinor: 1_000, netMinor: 10_000, currency: "USD" },
      ]),
    );
    await createPayoutBatch(admin, "broker-1");
    const doc = payoutStub.create.mock.calls[0][0];
    expect(doc.currency).toBe("KES");
    expect(doc.netMinor).toBe(9_000 + 1_300_000);
    expect(doc.grossMinor).toBe(10_000 + 1_430_000);
    expect(doc.fx).toEqual({
      sourceCurrency: "USD",
      sourceAmountMinor: 10_000,
      rate: 130,
      rateDate: "2026-11-26",
    });
  });

  it("refuses to pay USD commission when no rate is available", async () => {
    rateStub.mockResolvedValue(null);
    accrualStub.find.mockReturnValue(buildQuery([{ _id: "b", netMinor: 10_000, currency: "USD" }]));
    await expect(createPayoutBatch(admin, "broker-1")).rejects.toThrow(/exchange rate/);
  });

  it("re-converts at the payout-day rate when the payout is executed", async () => {
    vi.stubEnv("COMMISSION_PAYOUTS_ENABLED", "true");
    payoutStub.findById.mockReturnValue(
      buildQuery({ _id: "payout-1", status: "approved", fx: { sourceCurrency: "USD" } }),
    );
    accrualStub.find.mockReturnValue(
      buildQuery([
        { _id: "b", grossMinor: 10_000, taxMinor: 0, netMinor: 10_000, currency: "USD" },
      ]),
    );
    rateStub.mockResolvedValue({ rate: 128.5, effectiveDate: "2026-11-27", source: "t" });
    await executePayout(admin, "payout-1", "REF1");
    const [, update] = payoutStub.updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({
      status: "paid",
      netMinor: 1_285_000,
      fx: { sourceCurrency: "USD", sourceAmountMinor: 10_000, rate: 128.5, rateDate: "2026-11-27" },
    });
    vi.unstubAllEnvs();
  });
});
