/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { botVerdict } from "@/lib/bot-guard";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("botVerdict", () => {
  it("lets browsers and search engines through", () => {
    expect(botVerdict("/marketplace", CHROME)).toBeNull();
    expect(botVerdict("/api/v1/marketplace/listings", CHROME)).toBeNull();
    expect(
      botVerdict("/", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toBeNull();
    expect(botVerdict("/", "Mozilla/5.0 (compatible; bingbot/2.0)")).toBeNull();
    expect(botVerdict("/marketplace/1", "facebookexternalhit/1.1")).toBeNull();
  });

  it("blocks AI crawlers everywhere", () => {
    expect(
      botVerdict("/marketplace", "Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2)"),
    ).toBe("ai-crawler");
    expect(botVerdict("/", "CCBot/2.0 (https://commoncrawl.org/faq/)")).toBe("ai-crawler");
    expect(botVerdict("/properties/1", "Mozilla/5.0 (compatible; ClaudeBot/1.0)")).toBe(
      "ai-crawler",
    );
    expect(botVerdict("/api/v1/marketplace/listings", "Bytespider")).toBe("ai-crawler");
  });

  it("blocks scraping and attack tools", () => {
    expect(botVerdict("/api/v1/marketplace/listings", "python-requests/2.32")).toBe("bad-tool");
    expect(botVerdict("/", "sqlmap/1.7")).toBe("bad-tool");
    expect(botVerdict("/marketplace", "Go-http-client/1.1")).toBe("bad-tool");
  });

  it("refuses API calls without a user agent but not page views", () => {
    expect(botVerdict("/api/v1/tasks", "")).toBe("no-user-agent");
    expect(botVerdict("/api/v1/tasks", null)).toBe("no-user-agent");
    expect(botVerdict("/marketplace", "")).toBeNull();
  });

  it("never blocks payment callbacks, uploads or the scheduled job", () => {
    expect(botVerdict("/api/v1/payments/mpesa/callback/o/t", "")).toBeNull();
    expect(botVerdict("/api/v1/payments/paystack/webhook", "Go-http-client/1.1")).toBeNull();
    expect(botVerdict("/api/uploadthing", "")).toBeNull();
    expect(botVerdict("/api/v1/cron/daily", "vercel-cron/1.0")).toBeNull();
  });
});
