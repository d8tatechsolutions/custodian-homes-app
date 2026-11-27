/**
 * Which files may be uploaded. UploadThing already limits each route to images
 * (and PDFs where allowed) by size and count; this adds what it does not check:
 *
 * - No SVG. An SVG is a document that can carry script, so "image" alone is not
 *   enough; photos must be raster images.
 * - The file extension must agree with the declared type, so a page or script
 *   renamed to look like a photo is refused.
 */
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif"]);

export interface UploadCandidate {
  name: string;
  type: string;
}

function extensionOf(name: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : null;
}

/** A message for the first file that is not allowed, or null when all are fine. */
export function uploadRejection(
  files: readonly UploadCandidate[] | undefined,
  { allowPdf }: { allowPdf: boolean },
): string | null {
  for (const file of files ?? []) {
    const type = (file.type ?? "").toLowerCase();
    // Some phones send camera files without an extension; the type decides then.
    const ext = extensionOf(file.name ?? "");
    const isImage = IMAGE_TYPES.has(type) && (ext === null || IMAGE_EXTENSIONS.has(ext));
    const isPdf = allowPdf && type === "application/pdf" && (ext === null || ext === "pdf");
    if (!isImage && !isPdf) {
      return `"${file.name}" can't be uploaded. Use a JPG, PNG, WebP, GIF or HEIC photo${allowPdf ? ", or a PDF" : ""}.`;
    }
  }
  return null;
}

/** An address of a file uploaded through the app (UploadThing). */
const UPLOADED_FILE_URL =
  /^https:\/\/([a-z0-9-]+\.)*(ufs\.sh|utfs\.io|uploadthing\.com)\/[^\s"'<>]*$/i;
/** The site's own placeholder photos, e.g. /images/property-1.jpg. */
const SITE_IMAGE_PATH = /^\/images\/[a-z0-9_-]+(\/[a-z0-9_-]+)*\.(jpe?g|png|webp|avif|gif)$/i;

export const MAX_PROPERTY_IMAGES = 50;
export const PROPERTY_IMAGE_ERROR = "Photos must be uploaded through the app";

/**
 * Property photos are shown on public pages, so they must be uploads (or the
 * site's own placeholders): never an outside tracking image, a data: blob or a
 * javascript: link.
 */
export function isPropertyImageUrl(value: string): boolean {
  if (value.length > 500) return false;
  return UPLOADED_FILE_URL.test(value) || SITE_IMAGE_PATH.test(value);
}
