import { notifyListingFlagged } from "@/lib/broker-notify";
import { ListingFlag } from "@/models/ListingFlag";
import { MediaFingerprint } from "@/models/MediaFingerprint";

/**
 * Duplicate-photo detection for listings (fraud check before brokers or
 * owners publish the same photos on another property).
 *
 * Each photo gets a 64-bit difference hash: shrink to 9×8 greyscale and
 * record whether each pixel is brighter than its right neighbour. Re-encoded,
 * resized or lightly edited copies of a photo hash within a few bits of each
 * other; unrelated photos differ in about half the bits.
 *
 * Only images on our own upload hosts are fetched, so a listing can never
 * make the server request an arbitrary URL.
 */

export const MATCH_DISTANCE = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const ALLOWED_HOST = /(^|\.)(ufs\.sh|utfs\.io|uploadthing\.com)$/i;

export function isFingerprintableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

function popcount32(n: number): number {
  let v = n >>> 0;
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Number of differing bits between two 16-hex-char hashes. */
export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return 64;
  const hi = Number.parseInt(a.slice(0, 8), 16) ^ Number.parseInt(b.slice(0, 8), 16);
  const lo = Number.parseInt(a.slice(8), 16) ^ Number.parseInt(b.slice(8), 16);
  return popcount32(hi) + popcount32(lo);
}

/** dHash of raw 9×8 greyscale pixels (row-major, 72 bytes) as 16 hex chars. */
export function dHashFromPixels(pixels: Uint8Array): string {
  if (pixels.length < 72) throw new Error("Expected 9x8 greyscale pixels");
  const words = [0, 0];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const bit = pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? 1 : 0;
      const index = row * 8 + col;
      const w = index < 32 ? 0 : 1;
      words[w] = ((words[w] << 1) | bit) >>> 0;
    }
  }
  return words.map((w) => w.toString(16).padStart(8, "0")).join("");
}

export async function fingerprintImage(url: string): Promise<string | null> {
  if (!isFingerprintableUrl(url)) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) return null;
    const sharp = (await import("sharp")).default;
    const pixels = await sharp(buffer, { limitInputPixels: 40_000_000 })
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer();
    return dHashFromPixels(new Uint8Array(pixels));
  } catch (error) {
    console.warn(
      "[fingerprint] could not hash an image:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export interface FingerprintTarget {
  listingId: string;
  propertyId: string;
  urls: string[];
}

/**
 * Fingerprints a listing's photos and raises a flag for every near-identical
 * photo on a DIFFERENT property. Returns the number of new flags. Never throws:
 * a failure here must not block saving the listing.
 */
export async function checkListingPhotos(target: FingerprintTarget): Promise<number> {
  try {
    const urls = [...new Set(target.urls.filter(isFingerprintableUrl))].slice(0, 20);
    if (urls.length === 0) return 0;

    const known = (await MediaFingerprint.find({ listingId: target.listingId, url: { $in: urls } })
      .select("url hash")
      .lean()) as { url: string; hash: string }[];
    const hashes = new Map(known.map((k) => [k.url, k.hash]));
    for (const url of urls) {
      if (hashes.has(url)) continue;
      const hash = await fingerprintImage(url);
      if (!hash) continue;
      hashes.set(url, hash);
      await MediaFingerprint.updateOne(
        { listingId: target.listingId, url },
        { $set: { hash, propertyId: target.propertyId } },
        { upsert: true },
      );
    }
    if (hashes.size === 0) return 0;

    const others = (await MediaFingerprint.find({ propertyId: { $ne: target.propertyId } })
      .select("url hash listingId propertyId")
      .limit(20_000)
      .lean()) as { url: string; hash: string; listingId: string; propertyId: string }[];

    let flagged = 0;
    for (const [url, hash] of hashes) {
      for (const other of others) {
        const distance = hammingDistance(hash, other.hash);
        if (distance > MATCH_DISTANCE) continue;
        const res = await ListingFlag.updateOne(
          { listingId: target.listingId, matchedListingId: other.listingId, url },
          {
            $setOnInsert: {
              kind: "duplicate_photo",
              propertyId: target.propertyId,
              matchedPropertyId: other.propertyId,
              matchedUrl: other.url,
              distance,
              status: "open",
            },
          },
          { upsert: true },
        );
        if (res.upsertedCount) flagged += 1;
      }
    }
    if (flagged > 0) await notifyListingFlagged(target.listingId, flagged);
    return flagged;
  } catch (error) {
    console.error(
      "[fingerprint] listing check failed:",
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}
