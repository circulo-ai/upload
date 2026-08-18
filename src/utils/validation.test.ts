import { describe, expect, it } from "vitest";

import {
  getMimeTypeFromExtension,
  validateFileSize,
  validateFileType,
} from "./validation";

describe("upload validation", () => {
  it("accepts matching document MIME types", () => {
    expect(validateFileType("report.pdf", "application/pdf")).toBeNull();
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
});
