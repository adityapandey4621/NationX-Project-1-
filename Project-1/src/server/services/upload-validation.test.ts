import { describe, expect, it } from "vitest";
import { ServiceError } from "./service-result";
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, sniffFile, validateUpload } from "./upload-validation";

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

const bytes = (sig: number[], total = sig.length) => {
  const b = new Uint8Array(total);
  b.set(sig);
  return b;
};

describe("sniffFile", () => {
  it("identifies files by content, not by name or declared type", () => {
    expect(sniffFile(bytes(JPEG))?.ext).toBe("jpg");
    expect(sniffFile(bytes(PNG))?.ext).toBe("png");
    expect(sniffFile(bytes(WEBP))?.ext).toBe("webp");
    expect(sniffFile(bytes(PDF))?.mime).toBe("application/pdf");
  });
  it("rejects scripts and HTML disguised as images", () => {
    expect(sniffFile(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffFile(new TextEncoder().encode("<?php system($_GET['c']); ?>"))).toBeNull();
    expect(sniffFile(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // Windows executable
  });
});

describe("validateUpload", () => {
  it("accepts images for photos and logos", () => {
    expect(validateUpload(bytes(PNG), "logo").mime).toBe("image/png");
    expect(validateUpload(bytes(JPEG), "photo").mime).toBe("image/jpeg");
  });
  it("allows PDFs only as documents", () => {
    expect(validateUpload(bytes(PDF), "document").ext).toBe("pdf");
    expect(() => validateUpload(bytes(PDF), "photo")).toThrow(ServiceError);
    expect(() => validateUpload(bytes(PDF), "gallery")).toThrow(ServiceError);
  });
  it("enforces 5 MB for images and 10 MB for documents", () => {
    expect(() => validateUpload(bytes(JPEG, MAX_IMAGE_BYTES + 1), "photo")).toThrow(/too large/);
    expect(validateUpload(bytes(JPEG, MAX_IMAGE_BYTES), "photo").ext).toBe("jpg");
    expect(validateUpload(bytes(PDF, MAX_DOCUMENT_BYTES), "document").ext).toBe("pdf");
    expect(() => validateUpload(bytes(PDF, MAX_DOCUMENT_BYTES + 1), "document")).toThrow(/too large/);
  });
  it("rejects empty and unknown files", () => {
    expect(() => validateUpload(new Uint8Array(), "photo")).toThrow(/empty/);
    expect(() => validateUpload(new TextEncoder().encode("hello"), "photo")).toThrow(/Only JPEG/);
  });
});
