import { describe, expect, it } from "vitest";

import { uploadRejection } from "@/lib/upload-rules";

describe("uploadRejection", () => {
  it("accepts ordinary photos, including camera files without an extension", () => {
    expect(
      uploadRejection(
        [
          { name: "front.jpg", type: "image/jpeg" },
          { name: "kitchen.PNG", type: "image/png" },
          { name: "IMG_0042.heic", type: "image/heic" },
          { name: "1000012345", type: "image/jpeg" },
        ],
        { allowPdf: false },
      ),
    ).toBeNull();
  });

  it("accepts a PDF only where PDFs are allowed", () => {
    const pdf = [{ name: "quote.pdf", type: "application/pdf" }];
    expect(uploadRejection(pdf, { allowPdf: true })).toBeNull();
    expect(uploadRejection(pdf, { allowPdf: false })).toMatch(/can't be uploaded/);
  });

  it("refuses SVG, pages, scripts and files whose extension does not match", () => {
    for (const file of [
      { name: "logo.svg", type: "image/svg+xml" },
      { name: "page.html", type: "text/html" },
      { name: "run.exe", type: "application/octet-stream" },
      { name: "evil.html", type: "image/png" },
      { name: "evil.svg", type: "image/png" },
      { name: "invoice.pdf.exe", type: "application/pdf" },
    ]) {
      expect(uploadRejection([file], { allowPdf: true })).toMatch(/can't be uploaded/);
    }
  });

  it("checks every file, not just the first", () => {
    expect(
      uploadRejection(
        [
          { name: "a.jpg", type: "image/jpeg" },
          { name: "b.svg", type: "image/svg+xml" },
        ],
        { allowPdf: false },
      ),
    ).toMatch(/b\.svg/);
  });
});

describe("isPropertyImageUrl", () => {
  it("accepts uploads and the site's own placeholders", async () => {
    const { isPropertyImageUrl } = await import("@/lib/upload-rules");
    for (const ok of [
      "https://utfs.io/f/abc123",
      "https://ul22gpno3i.ufs.sh/f/abc123",
      "/images/property-1.jpg",
    ]) {
      expect(isPropertyImageUrl(ok)).toBe(true);
    }
  });

  it("refuses outside hosts, scripts, data blobs and tricks", async () => {
    const { isPropertyImageUrl } = await import("@/lib/upload-rules");
    for (const bad of [
      "https://evil.example/pixel.gif",
      "http://utfs.io/f/abc",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://ufs.sh.evil.com/f/abc",
      "https://utfs.io.evil.com/f/abc",
      "/images/../../etc/passwd.jpg",
      "//evil.example/a.jpg",
      `https://utfs.io/f/${"a".repeat(600)}`,
    ]) {
      expect(isPropertyImageUrl(bad)).toBe(false);
    }
  });
});
