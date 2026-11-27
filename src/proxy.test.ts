/** @vitest-environment node */
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getJwtSecret } from "@/lib/jwt";
import { proxy } from "@/proxy";

function buildDashboardRequest(path: string, token?: string): NextRequest {
  const url = `http://localhost:3000${path}`;
  const headers = new Headers();
  if (token) {
    headers.set("cookie", `keja-token=${token}`);
  }
  return new NextRequest(url, { headers });
}

function makeToken(role: string): string {
  return jwt.sign({ userId: "user-123", role }, getJwtSecret());
}

describe("proxy middleware", () => {
  it("redirects unauthenticated dashboard request to /auth", async () => {
    const req = buildDashboardRequest("/dashboard/owner");
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/auth");
  });

  it("redirects invalid token to /auth", async () => {
    const req = buildDashboardRequest("/dashboard/owner", "invalid-token");
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/auth");
  });

  it("redirects root /dashboard to the role default route", async () => {
    const req = buildDashboardRequest("/dashboard", makeToken("admin"));
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/admin");

    const adminReq = buildDashboardRequest("/dashboard", makeToken("admin"));
    const adminRes = await proxy(adminReq);
    expect(adminRes.status).toBe(307);
    expect(adminRes.headers.get("location")).toBe("http://localhost:3000/dashboard/admin");
  });

  it("redirects the retired /dashboard/owner surface to the role dashboard", async () => {
    const req = buildDashboardRequest("/dashboard/owner", makeToken("admin"));
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/admin");
  });

  it("allows admin accessing /dashboard/admin and nested pages", async () => {
    const req = buildDashboardRequest("/dashboard/admin/portfolio/123", makeToken("admin"));
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("redirects retired nested owner paths to the role dashboard", async () => {
    const req = buildDashboardRequest("/dashboard/owner/portfolio/123", makeToken("admin"));
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/admin");
  });

  it("redirects tenant attempting to access /dashboard/owner to /dashboard/tenant", async () => {
    const req = buildDashboardRequest("/dashboard/owner", makeToken("tenant"));
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/tenant");
  });

  it("allows tenant accessing /dashboard/tenant/invoices", async () => {
    const req = buildDashboardRequest("/dashboard/tenant/invoices", makeToken("tenant"));
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("passes through non-dashboard requests", async () => {
    const req = buildDashboardRequest("/api/v1/properties");
    // API calls must carry a user agent (bot guard); use a normal browser one.
    req.headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0");
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("refuses AI crawlers, attack tools and UA-less API calls", async () => {
    const ai = new NextRequest("http://localhost:3000/marketplace", {
      headers: { "user-agent": "GPTBot/1.2" },
    });
    expect((await proxy(ai)).status).toBe(403);
    const tool = new NextRequest("http://localhost:3000/api/v1/marketplace/listings", {
      headers: { "user-agent": "sqlmap/1.7" },
    });
    expect((await proxy(tool)).status).toBe(403);
    expect((await proxy(new NextRequest("http://localhost:3000/api/v1/tasks"))).status).toBe(403);
  });

  it("never blocks payment callbacks or the scheduled job", async () => {
    const cb = new NextRequest("http://localhost:3000/api/v1/payments/paystack/webhook");
    expect((await proxy(cb)).status).toBe(200);
    const cron = new NextRequest("http://localhost:3000/api/v1/cron/daily", {
      headers: { "user-agent": "vercel-cron/1.0" },
    });
    expect((await proxy(cron)).status).toBe(200);
  });
  describe("cross-site writes", () => {
    const UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0";
    function write(path: string, method: string, headers: Record<string, string> = {}) {
      return new NextRequest(`http://localhost:3000${path}`, {
        method,
        headers: { "user-agent": UA, ...headers },
      });
    }

    it("refuses an API write from another site", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await proxy(
          write("/api/v1/favourites", method, { origin: "https://evil.example" }),
        );
        expect(res.status).toBe(403);
      }
      const fetchSite = await proxy(write("/api/auth", "POST", { "sec-fetch-site": "cross-site" }));
      expect(fetchSite.status).toBe(403);
    });

    it("allows writes from the app itself and from non-browser clients", async () => {
      const same = await proxy(
        write("/api/v1/favourites", "POST", {
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        }),
      );
      expect(same.status).toBe(200);
      expect((await proxy(write("/api/v1/favourites", "POST"))).status).toBe(200);
    });

    it("never applies to reads, pages or server-to-server callbacks", async () => {
      const evil = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
      expect((await proxy(write("/api/v1/properties", "GET", evil))).status).toBe(200);
      expect((await proxy(write("/api/v1/payments/paystack/webhook", "POST", evil))).status).toBe(
        200,
      );
      expect((await proxy(write("/api/uploadthing", "POST", evil))).status).toBe(200);
      expect((await proxy(write("/api/v1/cron/daily", "POST", evil))).status).toBe(200);
    });
  });
});
