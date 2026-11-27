import { beforeEach, describe, expect, it, vi } from "vitest";

import { cached, clearMemoryCache, invalidateCached } from "@/lib/memory-cache";

describe("memory cache", () => {
  beforeEach(() => {
    clearMemoryCache();
    vi.useRealTimers();
  });

  it("loads once and serves the cached value until it expires", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue("rate-1");
    expect(await cached("fx", 1000, load)).toBe("rate-1");
    expect(await cached("fx", 1000, load)).toBe("rate-1");
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);
    load.mockResolvedValue("rate-2");
    expect(await cached("fx", 1000, load)).toBe("rate-2");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent callers", async () => {
    let resolve: (v: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const all = Promise.all([
      cached("k", 1000, load),
      cached("k", 1000, load),
      cached("k", 1000, load),
    ]);
    resolve("one");
    expect(await all).toEqual(["one", "one", "one"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue("ok");
    await expect(cached("k", 1000, load)).rejects.toThrow("db down");
    expect(await cached("k", 1000, load)).toBe("ok");
  });

  it("forgets entries by prefix after a change", async () => {
    const load = vi.fn().mockResolvedValue(["Apartment"]);
    await cached("property-types:active", 60_000, load);
    invalidateCached("property-types:");
    await cached("property-types:active", 60_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
