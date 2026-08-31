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
import {
  normalizeStorageKey,
  sanitizeFilename as sanitizeSafeFilename,
} from "../utils/security";

/**
 * Base storage provider interface that all providers must implement
 */
export interface StorageProvider {
  /**
   * Upload a file to storage
   */
  upload(options: UploadOptions): Promise<FileInfo>;

  /**
   * Download a file from storage
   */
  download(options: DownloadOptions): Promise<Buffer>;

  /**
   * Delete a file from storage
   */
  delete(options: DeleteOptions): Promise<void>;

  /**
   * Generate a presigned URL for uploading
   */
  generatePresignedUploadUrl?(
    options: PresignedUploadUrlOptions,
  ): Promise<PresignedUrlResponse>;

  /**
   * Generate a presigned URL for downloading
   */
  generatePresignedDownloadUrl?(
    options: PresignedDownloadUrlOptions,
  ): Promise<string>;

  /**
   * Check if provider supports presigned URLs
   */
  supportsPresignedUrls(): boolean;

  /**
   * Check if provider supports multipart uploads
   */
  supportsMultipartUpload(): boolean;

  /**
   * Initiate a multipart upload
   */
  initiateMultipartUpload?(
    options: MultipartInitOptions,
  ): Promise<MultipartInitResponse>;

  /**
   * Get presigned URLs for uploading multiple parts
   */
  getMultipartPartUrls?(
    options: MultipartPartUrlsOptions,
  ): Promise<MultipartPartUrl[]>;

  /**
   * Complete a multipart upload
   * NOTE: The parts array type depends on the provider implementation
   */
  completeMultipartUpload?(
    options: MultipartCompleteOptions,
  ): Promise<MultipartCompleteResponse>;

  /**
   * Abort a multipart upload
   */
  abortMultipartUpload?(options: MultipartAbortOptions): Promise<void>;
}

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
    throw new Error("Presigned URLs not supported by this provider");
  }

  async generatePresignedDownloadUrl(
    _options: PresignedDownloadUrlOptions,
  ): Promise<string> {
    throw new Error("Presigned URLs not supported by this provider");
  }

  async initiateMultipartUpload(
    _options: MultipartInitOptions,
  ): Promise<MultipartInitResponse> {
    throw new Error("Multipart upload not supported by this provider");
  }

  async getMultipartPartUrls(
    _options: MultipartPartUrlsOptions,
  ): Promise<MultipartPartUrl[]> {
    throw new Error("Multipart upload not supported by this provider");
  }

  async completeMultipartUpload(
    _options: MultipartCompleteOptions,
  ): Promise<MultipartCompleteResponse> {
    throw new Error("Multipart upload not supported by this provider");
  }

  async abortMultipartUpload(_options: MultipartAbortOptions): Promise<void> {
    throw new Error("Multipart upload not supported by this provider");
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
