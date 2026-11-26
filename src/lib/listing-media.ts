import { isFingerprintableUrl } from "@/lib/listing-fingerprint";

export const MAX_LISTING_MEDIA = 30;
export const LISTING_MEDIA_ERROR = "Photos must be uploaded through the app";

/**
 * Listing photos are shown to every marketplace visitor, so they must be files
 * uploaded through the app. An outside image link would let a third party log
 * the visitors who open the listing.
 */
export function isUploadedMediaList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_LISTING_MEDIA) return false;
  return value.every(
    (item) =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { url?: unknown }).url === "string" &&
      isFingerprintableUrl((item as { url: string }).url),
  );
}
