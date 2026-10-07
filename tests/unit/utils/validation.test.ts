import { describe, expect, it } from "vitest";

import {
  base64ToBuffer,
  contentDisposition,
  normalizeStorageKey,
  sanitizeFilename,
} from "../../../src/utils/security";
import {
  getMimeTypeFromExtension,
  validateFileSize,
  validateFileType,
} from "../../../src/utils/validation";

describe("upload validation", () => {
  it("accepts matching document MIME types", () => {
    expect(validateFileType("report.pdf", "application/pdf")).toBeNull();
  });

  it("accepts common image attachments", () => {
    expect(validateFileType("photo.jpg", "image/jpeg")).toBeNull();
    expect(validateFileType("photo.png", "image/png")).toBeNull();
  });

  it("rejects MIME types that do not match the extension", () => {
    expect(validateFileType("report.pdf", "image/png")).toMatchObject({
      code: "MIME_TYPE_MISMATCH",
    });
  });

  it("rejects unsupported extensions", () => {
    expect(
      validateFileType("archive.exe", "application/octet-stream"),
    ).toMatchObject({
      code: "UNSUPPORTED_FILE_TYPE",
    });
  });

  it("accepts files at the configured size boundary", () => {
    expect(validateFileSize(100 * 1024 * 1024)).toBeNull();
  });

  it("rejects files larger than the configured size boundary", () => {
    expect(validateFileSize(100 * 1024 * 1024 + 1)).toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("provides a safe MIME fallback for browser files without a type", () => {
    expect(getMimeTypeFromExtension("md")).toBe("text/markdown");
  });

  it("normalizes MIME parameters and case before validating", () => {
    expect(
      validateFileType("photo.JPG", "IMAGE/JPEG; charset=binary"),
    ).toBeNull();
  });

  it("includes image extensions in unsupported-type guidance", () => {
    expect(
      validateFileType("archive.exe", "application/octet-stream")
        ?.supportedTypes,
    ).toContain("png");
  });

  it("rejects ambiguous storage keys instead of rewriting them", () => {
    expect(() => normalizeStorageKey("../secret.txt")).toThrow();
    expect(() => normalizeStorageKey("folder\\secret.txt")).toThrow();
    expect(normalizeStorageKey("folder/file.txt")).toBe("folder/file.txt");
  });

  it("sanitizes display names and builds injection-safe content disposition", () => {
    expect(sanitizeFilename("..\\avatar\u0000.png")).toBe("avatar_.png");
    expect(contentDisposition('report".pdf')).toContain(
      'filename="report_.pdf"',
    );
  });

  it("rejects malformed base64 instead of silently discarding input", () => {
    expect(() => base64ToBuffer("not base64!")).toThrow("Invalid base64");
  });
});
