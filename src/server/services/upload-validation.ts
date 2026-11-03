import { ServiceError } from "./service-result";

/** Limits from docs/SECURITY.md §5: 5 MB photos, 10 MB documents. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type UploadKind = "logo" | "photo" | "document" | "banner" | "gallery" | "product";

interface Sniffed {
  mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  ext: "jpg" | "png" | "webp" | "pdf";
}

/** Identify a file by its leading bytes; the client-declared MIME type is never trusted. */
export function sniffFile(bytes: Uint8Array): Sniffed | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: "image/webp", ext: "webp" };
  }
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", ext: "pdf" };
  return null;
}

/** Returns the verified type/extension, or throws a user-safe VALIDATION_ERROR. */
export function validateUpload(bytes: Uint8Array, kind: UploadKind): Sniffed {
  if (bytes.byteLength === 0) throw new ServiceError("VALIDATION_ERROR", "The file is empty");
  const sniffed = sniffFile(bytes);
  if (!sniffed) throw new ServiceError("VALIDATION_ERROR", "Only JPEG, PNG or WebP images (and PDF documents) are allowed");
  const isPdf = sniffed.mime === "application/pdf";
  if (isPdf && kind !== "document") {
    throw new ServiceError("VALIDATION_ERROR", "Photos and logos must be JPEG, PNG or WebP images");
  }
  const limit = isPdf || kind === "document" ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
  if (bytes.byteLength > limit) {
    throw new ServiceError("VALIDATION_ERROR", `File is too large (maximum ${limit / (1024 * 1024)} MB)`);
  }
  return sniffed;
}
