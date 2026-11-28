/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicErrorMessage } from "@/lib/public-error";

class DomainError extends Error {}

describe("publicErrorMessage", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("passes through a plain business-rule message", () => {
    expect(publicErrorMessage(new Error("Commission accrual not found"), "Failed")).toBe(
      "Commission accrual not found",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("passes through an allowed domain error class", () => {
    expect(publicErrorMessage(new DomainError("Bad layout"), "Failed", [DomainError])).toBe(
      "Bad layout",
    );
  });

  it("hides database, driver and system errors and logs them", () => {
    class MongoServerError extends Error {
      code = 11000;
    }
    const duplicate = new MongoServerError("E11000 duplicate key error collection: app.units");
    expect(publicErrorMessage(duplicate, "Failed to generate units")).toBe(
      "Failed to generate units",
    );

    const network = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:27017"), {
      code: "ECONNREFUSED",
      syscall: "connect",
    });
    expect(publicErrorMessage(network, "Failed")).toBe("Failed");

    expect(publicErrorMessage(new TypeError("Cannot read properties of undefined"), "Failed")).toBe(
      "Failed",
    );
    expect(publicErrorMessage(new DomainError("not allowed here"), "Failed")).toBe("Failed");
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("hides non-errors, empty and oversized messages", () => {
    expect(publicErrorMessage("boom", "Failed")).toBe("Failed");
    expect(publicErrorMessage(new Error("   "), "Failed")).toBe("Failed");
    expect(publicErrorMessage(new Error("x".repeat(301)), "Failed")).toBe("Failed");
  });
});
