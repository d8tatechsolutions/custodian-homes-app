/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSameOrigin } from "@/lib/rate-limit";

function write(url: string, headers: Record<string, string>) {
  return new NextRequest(url, { method: "POST", headers });
}

describe("checkSameOrigin", () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.custodianhomes.co.ke";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = previous;
  });

  it("allows the configured app address", () => {
    const req = write("https://www.custodianhomes.co.ke/api/v1/x", {
      origin: "https://www.custodianhomes.co.ke",
      "sec-fetch-site": "same-origin",
    });
    expect(checkSameOrigin(req)).toBeNull();
  });

  it("allows a page calling the deployment it was served from (Vercel preview, bare domain)", () => {
    for (const host of [
      "https://custodian-homes-app-git-stage-team.vercel.app",
      "https://custodianhomes.co.ke",
    ]) {
      const req = write(`${host}/api/v1/x`, { origin: host, "sec-fetch-site": "same-origin" });
      expect(checkSameOrigin(req)).toBeNull();
    }
  });

  it("blocks another site posting to us", () => {
    const req = write("https://www.custodianhomes.co.ke/api/v1/x", {
      origin: "https://evil.example",
    });
    expect(checkSameOrigin(req)?.status).toBe(403);
  });

  it("blocks a preview-looking origin that is not the host being called", () => {
    const req = write("https://www.custodianhomes.co.ke/api/v1/x", {
      origin: "https://attacker.vercel.app",
    });
    expect(checkSameOrigin(req)?.status).toBe(403);
  });

  it("blocks cross-site requests flagged by the browser", () => {
    const req = write("https://www.custodianhomes.co.ke/api/v1/x", {
      "sec-fetch-site": "cross-site",
    });
    expect(checkSameOrigin(req)?.status).toBe(403);
  });

  it("allows requests without an Origin (server-to-server, same as before)", () => {
    expect(checkSameOrigin(write("https://www.custodianhomes.co.ke/api/v1/x", {}))).toBeNull();
  });
});
