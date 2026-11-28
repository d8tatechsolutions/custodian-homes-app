/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongoose", () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));

import mongoose from "mongoose";
import { GET } from "@/app/api/health/route";
import { connectToDatabase } from "@/lib/mongoose";

describe("GET /api/health", () => {
  it("returns 200 ok when db connected", async () => {
    const original = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    Object.defineProperty(mongoose.connection, "readyState", {
      value: original,
      configurable: true,
    });
  });

  it("returns 503 when db disconnected", async () => {
    const original = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, "readyState", { value: 0, configurable: true });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    Object.defineProperty(mongoose.connection, "readyState", {
      value: original,
      configurable: true,
    });
  });

  it("never reveals the driver error (it can name the cluster host)", async () => {
    vi.mocked(connectToDatabase).mockRejectedValueOnce(
      new Error("querySrv ENOTFOUND _mongodb._tcp.cluster0.example.mongodb.net"),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("mongodb.net");
    expect(JSON.parse(text)).toEqual({ status: "error", db: "unreachable" });
    spy.mockRestore();
  });
});
