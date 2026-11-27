import { describe, expect, it } from "vitest";
import { isUploadedMediaList, MAX_LISTING_MEDIA } from "@/lib/listing-media";

describe("isUploadedMediaList", () => {
  it("accepts files uploaded through the app", () => {
    expect(isUploadedMediaList([])).toBe(true);
    expect(
      isUploadedMediaList([
        { url: "https://abc123.ufs.sh/f/key1", caption: "Kitchen" },
        { url: "https://utfs.io/f/key2" },
      ]),
    ).toBe(true);
  });

  it("rejects outside links, non-https links and malformed items", () => {
    expect(isUploadedMediaList([{ url: "https://tracker.example/pixel.png" }])).toBe(false);
    expect(isUploadedMediaList([{ url: "http://utfs.io/f/key" }])).toBe(false);
    expect(isUploadedMediaList([{ url: "https://utfs.io.evil.example/f/key" }])).toBe(false);
    expect(isUploadedMediaList([{ url: 5 }])).toBe(false);
    expect(isUploadedMediaList([null])).toBe(false);
    expect(isUploadedMediaList("https://utfs.io/f/key")).toBe(false);
  });

  it("caps the number of photos", () => {
    const many = Array.from({ length: MAX_LISTING_MEDIA + 1 }, (_, i) => ({
      url: `https://utfs.io/f/k${i}`,
    }));
    expect(isUploadedMediaList(many)).toBe(false);
  });
});
