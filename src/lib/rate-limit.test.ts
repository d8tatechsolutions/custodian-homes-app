/** @vitest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { rateLimit, routeBucket } from "@/lib/rate-limit";

let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function req(path: string, ip: string, method = "POST") {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimit", () => {
  it("allows requests within the limit and refuses the next one", async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) {
      expect(await rateLimit(req("/api/v1/leads", ip), { limit: 3 })).not.toBeInstanceOf(
        NextResponse,
      );
    }
    const refused = await rateLimit(req("/api/v1/leads", ip), { limit: 3 });
    expect(refused).toBeInstanceOf(NextResponse);
    expect((refused as NextResponse).status).toBe(429);
  });

  it("keeps a separate counter per route, so one route cannot use up another's limit", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await rateLimit(req("/api/v1/tasks", ip), { limit: 30 });
    // A route limited to 5 is untouched by the 5 calls above.
    expect(await rateLimit(req("/api/v1/leads", ip), { limit: 5 })).not.toBeInstanceOf(
      NextResponse,
    );
  });

  it("shares one counter across ids on the same route", async () => {
    const ip = freshIp();
    await rateLimit(req("/api/v1/tasks/64b7f0c2a1b2c3d4e5f60718/status", ip), { limit: 1 });
    const second = await rateLimit(req("/api/v1/tasks/64b7f0c2a1b2c3d4e5f60719/status", ip), {
      limit: 1,
    });
    expect(second).toBeInstanceOf(NextResponse);
  });

  it("an explicit key still scopes the counter to that key", async () => {
    const ip = freshIp();
    await rateLimit(req("/api/v1/a", ip), { limit: 1, key: "user:1" });
    expect(await rateLimit(req("/api/v1/b", ip), { limit: 1, key: "user:1" })).toBeInstanceOf(
      NextResponse,
    );
  });
});

describe("routeBucket", () => {
  it("names the route without its ids, by method", () => {
    expect(routeBucket(req("/api/v1/tasks/64b7f0c2a1b2c3d4e5f60718/status", "x"))).toBe(
      "POST /api/v1/tasks/:id/status",
    );
    expect(routeBucket(req("/api/v1/leads", "x", "GET"))).toBe("GET /api/v1/leads");
  });
});
