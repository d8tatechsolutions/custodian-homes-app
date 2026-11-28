/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/auth/logout/route";
import { buildRequest } from "@/test/utils/api-request";

function cleared(res: Response) {
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.includes("keja-token=;") && /expires=Thu, 01 Jan 1970/i.test(cookie);
}

describe("/api/auth/logout", () => {
  it("POST clears the session cookie", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(cleared(res)).toBe(true);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("GET from the app itself still signs out (pages on the previous build)", async () => {
    const res = await GET(
      buildRequest("/api/auth/logout", { headers: { "sec-fetch-site": "same-origin" } }),
    );
    expect(res.status).toBe(200);
    expect(cleared(res)).toBe(true);
  });

  it("GET from another site or a typed/pasted link cannot sign people out", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const res = await GET(
        buildRequest("/api/auth/logout", { headers: { "sec-fetch-site": site } }),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    const noHeader = await GET(buildRequest("/api/auth/logout"));
    expect(noHeader.status).toBe(405);
  });
});
