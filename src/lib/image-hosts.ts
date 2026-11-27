/**
 * Hosts the image optimizer may fetch from (used by next.config.ts). Uploads come
 * from UploadThing; the marketplace placeholder is on Unsplash.
 */
export const OPTIMIZED_IMAGE_HOSTS = [
  { protocol: "https", hostname: "utfs.io" },
  { protocol: "https", hostname: "*.ufs.sh" },
  { protocol: "https", hostname: "images.unsplash.com" },
] as const;

/**
 * True when next/image may optimize this src: a site-relative path or one of the
 * hosts above. Anything else is shown with `unoptimized`, so an older photo on
 * another host still displays instead of failing the whole image component.
 */
export function isOptimizableImage(src: string | null | undefined): boolean {
  if (!src) return true;
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return OPTIMIZED_IMAGE_HOSTS.some(({ hostname }) =>
    hostname.startsWith("*.") ? host.endsWith(hostname.slice(1)) : host === hostname,
  );
}
