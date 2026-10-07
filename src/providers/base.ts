import { randomUUID } from "node:crypto";
import type {
  DeleteOptions,
  DownloadOptions,
  FileInfo,
  MultipartAbortOptions,
  MultipartCompleteOptions,
  MultipartCompleteResponse,
  MultipartInitOptions,
  MultipartInitResponse,
  MultipartPartUrl,
  MultipartPartUrlsOptions,
  PresignedDownloadUrlOptions,
  PresignedUploadUrlOptions,
  PresignedUrlResponse,
  UploadOptions,
} from "../types/core";
import { UploadError } from "../utils/errors";
import {
  normalizeStorageKey,
  sanitizeFilename as sanitizeSafeFilename,
} from "../utils/security";
import type { StorageProvider } from "./contracts";

export type { StorageProvider } from "./contracts";

/**
 * Abstract base class with common functionality
 */
export abstract class BaseStorageProvider implements StorageProvider {
  abstract upload(options: UploadOptions): Promise<FileInfo>;
  abstract download(options: DownloadOptions): Promise<Buffer>;
  abstract delete(options: DeleteOptions): Promise<void>;

  supportsPresignedUrls(): boolean {
    return false;
  }

  supportsMultipartUpload(): boolean {
    return false;
  }

  async generatePresignedUploadUrl(
    _options: PresignedUploadUrlOptions,
  ): Promise<PresignedUrlResponse> {
    throw new UploadError(
      "PROVIDER_UNSUPPORTED",
      "Presigned URLs not supported by this provider",
    );
  }

  async generatePresignedDownloadUrl(
    _options: PresignedDownloadUrlOptions,
  ): Promise<string> {
    throw new UploadError(
      "PROVIDER_UNSUPPORTED",
      "Presigned URLs not supported by this provider",
    );
  }

  async initiateMultipartUpload(
    _options: MultipartInitOptions,
  ): Promise<MultipartInitResponse> {
    throw new UploadError(
      "PROVIDER_UNSUPPORTED_MULTIPART",
      "Multipart upload not supported by this provider",
    );
  }

  async getMultipartPartUrls(
    _options: MultipartPartUrlsOptions,
  ): Promise<MultipartPartUrl[]> {
    throw new UploadError(
      "PROVIDER_UNSUPPORTED_MULTIPART",
      "Multipart upload not supported by this provider",
    );
  }

  async completeMultipartUpload(
    _options: MultipartCompleteOptions,
  ): Promise<MultipartCompleteResponse> {
    throw new UploadError(
      "PROVIDER_UNSUPPORTED_MULTIPART",
      "Multipart upload not supported by this provider",
    );
  }

  async abortMultipartUpload(_options: MultipartAbortOptions): Promise<void> {
    throw new UploadError(
      "PROVIDER_UNSUPPORTED_MULTIPART",
      "Multipart upload not supported by this provider",
    );
  }

  /**
   * Generate a unique key for a file
   */
  protected generateKey(
    fileName: string,
    preserveKey: boolean = false,
  ): string {
    const safeFileName = sanitizeSafeFilename(fileName).replace(/\s+/g, "-");
    if (preserveKey) {
      return normalizeStorageKey(safeFileName);
    }
    return normalizeStorageKey(`${Date.now()}-${randomUUID()}-${safeFileName}`);
  }

  /** Normalize caller-provided keys before passing them to a backend. */
  protected normalizeKey(key: string): string {
    return normalizeStorageKey(key);
  }

  /** Keep bearer-style URLs short-lived and reject invalid caller input. */
  protected normalizeExpirationSeconds(
    value: number | undefined,
    defaultValue: number = 3600,
  ): number {
    const expiration = value ?? defaultValue;
    if (
      !Number.isSafeInteger(expiration) ||
      expiration < 1 ||
      expiration > 604_800
    ) {
      throw new Error(
        "URL expiration must be an integer between 1 and 604800 seconds",
      );
    }
    return expiration;
  }

  /**
   * Sanitize filename for metadata headers (ASCII only)
   */
  protected sanitizeFilename(filename: string): string {
    return (
      filename
        .replace(/[^\x20-\x7E]/g, "") // Keep only printable ASCII
        .replace(/["\\]/g, "") // Remove problematic characters
        .replace(/\s+/g, " ") // Normalize spaces
        .trim() || "file"
    );
  }

  /**
   * Sanitize metadata values
   */
  protected sanitizeMetadata(
    metadata: Record<string, string>,
    maxLength: number = 2000,
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata).slice(0, 100)) {
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) continue;
      const sanitizedValue = String(value)
        .replace(/[^\x20-\x7E]/g, "")
        .replace(/["\\]/g, "")
        .substring(0, maxLength);
      if (sanitizedValue) {
        sanitized[key] = sanitizedValue;
      }
    }
    return sanitized;
  }
}
