import { describe, expect, it } from "vitest";

import { isOptimizableImage } from "@/lib/image-hosts";

describe("isOptimizableImage", () => {
  it("optimizes local images and the allowed hosts", () => {
    expect(isOptimizableImage("/images/hero-building.jpg")).toBe(true);
    expect(isOptimizableImage("https://utfs.io/f/abc")).toBe(true);
    expect(isOptimizableImage("https://ul22gpno3i.ufs.sh/f/abc")).toBe(true);
    expect(isOptimizableImage("https://images.unsplash.com/photo-1")).toBe(true);
  });

  it("does not optimize other hosts, plain http or look-alike domains", () => {
    expect(isOptimizableImage("https://example.com/a.jpg")).toBe(false);
    expect(isOptimizableImage("http://utfs.io/f/abc")).toBe(false);
    expect(isOptimizableImage("https://ufs.sh.evil.com/a.jpg")).toBe(false);
    expect(isOptimizableImage("https://evilufs.sh/a.jpg")).toBe(false);
    expect(isOptimizableImage("//evil.com/a.jpg")).toBe(false);
    expect(isOptimizableImage("not a url")).toBe(false);
  });
});
