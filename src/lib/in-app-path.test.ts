import { describe, expect, it } from "vitest";

import { isInAppPath } from "@/lib/in-app-path";

describe("isInAppPath", () => {
  it("accepts paths inside the site", () => {
    expect(isInAppPath("/dashboard/broker?tab=requests")).toBe(true);
    expect(isInAppPath("/dashboard/admin/tasks/64b7f0c2a1b2c3d4e5f60718")).toBe(true);
  });

  it("refuses other sites, scripts and empty values", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      expect(isInAppPath(bad)).toBe(false);
    }
  });
});
