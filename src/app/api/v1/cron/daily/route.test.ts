/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest } from "@/test/utils/api-request";

vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
const run = vi.fn();
vi.mock("@/lib/cron/steps", () => ({
  dailySteps: () => [
    { name: "a", run: async () => run() },
    {
      name: "b",
      run: async () => {
        throw new Error("boom");
      },
    },
  ],
}));

import { GET } from "@/app/api/v1/cron/daily/route";

const original = process.env.CRON_SECRET;

beforeEach(() => {
  run.mockReset().mockResolvedValue({ done: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

function call(auth?: string) {
  return GET(buildRequest("/api/v1/cron/daily", auth ? { headers: { authorization: auth } } : {}));
}

describe("GET /api/v1/cron/daily", () => {
  it("refuses to run when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await call("Bearer anything");
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects missing or wrong secrets", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("s3cret")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs every step and reports a failing one without stopping the rest", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.results).toEqual([
      expect.objectContaining({ step: "a", ok: true, detail: { done: 1 } }),
      expect.objectContaining({ step: "b", ok: false, error: "boom" }),
    ]);
  });
});
