/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bucket = vi.hoisted(() => ({ findOneAndUpdate: vi.fn() }));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/RateLimitBucket", () => ({ RateLimitBucket: bucket }));

import { clientIp, durableRateLimit, hitDurableLimit } from "@/lib/durable-rate-limit";

function counted(count: number) {
  return { lean: () => Promise.resolve({ count }) };
}

beforeEach(() => {
  process.env.DURABLE_RATE_LIMIT_IN_TESTS = "1";
  bucket.findOneAndUpdate.mockReset();
});
afterEach(() => {
  delete process.env.DURABLE_RATE_LIMIT_IN_TESTS;
});

describe("durable rate limit", () => {
  it("counts per fixed window in one atomic upsert", async () => {
    bucket.findOneAndUpdate.mockReturnValue(counted(1));
    const now = 10 * 60_000 + 5_000;
    const res = await hitDurableLimit("auth:signin:1.2.3.4", { windowMs: 60_000, limit: 3 }, now);
    expect(res.limited).toBe(false);
    expect(bucket.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "auth:signin:1.2.3.4:10" },
      { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(11 * 60_000 + 60_000) } },
      { upsert: true, returnDocument: "after" },
    );
  });

  it("limits once the count passes the limit", async () => {
    bucket.findOneAndUpdate.mockReturnValue(counted(4));
    expect((await hitDurableLimit("k", { windowMs: 60_000, limit: 3 })).limited).toBe(true);
  });

  it("fails open if the database is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    bucket.findOneAndUpdate.mockImplementation(() => {
      throw new Error("down");
    });
    expect((await hitDurableLimit("k", { windowMs: 60_000, limit: 1 })).limited).toBe(false);
  });

  it("returns 429 with Retry-After and keys by the first forwarded IP", async () => {
    bucket.findOneAndUpdate.mockReturnValue(counted(99));
    const req = new Request("http://x/api", {
      headers: { "x-forwarded-for": "41.90.1.2, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("41.90.1.2");
    const res = await durableRateLimit(req, { key: "contact", windowMs: 60_000, limit: 5 });
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBeTruthy();
    expect(bucket.findOneAndUpdate.mock.calls[0][0]._id).toMatch(/^contact:41\.90\.1\.2:/);
  });

  it("is skipped under unit tests unless explicitly enabled", async () => {
    delete process.env.DURABLE_RATE_LIMIT_IN_TESTS;
    expect((await hitDurableLimit("k", { windowMs: 60_000, limit: 0 })).limited).toBe(false);
    expect(bucket.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
