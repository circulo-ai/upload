import { UploadError } from "./errors";

export function assertByteSize(value: number, name = "File size"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UploadError(
      "INVALID_INPUT",
      `${name} must be a non-negative safe integer`,
    );
  }
}

export function assertContentType(value: string): void {
  if (
    typeof value !== "string" ||
    !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;[^\r\n\x00-\x1f\x7f]*)?$/.test(value)
  ) {
    throw new UploadError(
      "INVALID_INPUT",
      "A valid MIME content type is required",
    );
  }
}

export function assertPartNumbers(parts: readonly number[]): void {
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.length > 10_000 ||
    new Set(parts).size !== parts.length ||
    parts.some((part) => !Number.isInteger(part) || part < 1 || part > 10_000)
  ) {
    throw new UploadError(
      "INVALID_INPUT",
      "Multipart part numbers must be unique integers between 1 and 10000",
    );
  }
}

export function assertWriteMode(value: unknown): void {
  if (value !== undefined && value !== "overwrite" && value !== "create-only")
    throw new UploadError("INVALID_INPUT", "Unknown write mode");
}
