import { describe, expect, it } from "vitest";
import { canTransition, dmKey, pairKey, requiresApproval } from "@/lib/chat/approval";

describe("pairKey / dmKey", () => {
  it("is order-independent", () => {
    expect(pairKey("user-b", "user-a")).toBe("user-a:user-b");
    expect(pairKey("user-a", "user-b")).toBe(pairKey("user-b", "user-a"));
  });

  it("namespaces the DM key", () => {
    expect(dmKey(pairKey("b", "a"))).toBe("dm:a:b");
  });
});

describe("requiresApproval", () => {
  it("is false when both users share a property", () => {
    expect(requiresApproval(["p1", "p2"], ["p2", "p3"])).toBe(false);
  });

  it("is true when the property sets are disjoint", () => {
    expect(requiresApproval(["p1"], ["p2"])).toBe(true);
  });

  it("is true when either side has no property", () => {
    expect(requiresApproval([], ["p1"])).toBe(true);
    expect(requiresApproval(["p1"], [])).toBe(true);
    expect(requiresApproval([], [])).toBe(true);
  });

  it("ignores empty property ids", () => {
    expect(requiresApproval(["", "p1"], ["", "p1"])).toBe(false);
  });
});

describe("canTransition", () => {
  it("lets the recipient approve or decline a pending request", () => {
    expect(canTransition("pending", "approved", true, false)).toBe(true);
    expect(canTransition("pending", "declined", true, false)).toBe(true);
  });

  it("lets the requester cancel a pending request", () => {
    expect(canTransition("pending", "cancelled", false, true)).toBe(true);
  });

  it("does not let a requester approve or a recipient cancel", () => {
    expect(canTransition("pending", "approved", false, true)).toBe(false);
    expect(canTransition("pending", "declined", false, true)).toBe(false);
    expect(canTransition("pending", "cancelled", true, false)).toBe(false);
  });

  it("rejects same-role flags and transitions from terminal states", () => {
    expect(canTransition("pending", "approved", true, true)).toBe(true);
    for (const from of ["approved", "declined", "cancelled"] as const) {
      for (const to of ["approved", "declined", "cancelled"] as const) {
        expect(canTransition(from, to, true, false)).toBe(false);
        expect(canTransition(from, to, false, true)).toBe(false);
      }
    }
  });
});
