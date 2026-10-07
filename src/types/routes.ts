import type { StorageManager, StorageManagerFactory } from "../storage-manager";
import type { UploadError } from "../utils/errors";
import type {
  FileValidationError,
  MultipartCompleteResponse,
  MultipartInitResponse,
} from "./core";
export interface FileHandlerConfig {
  /**
   * Pass a factory to defer initialization until the first request.
   */
  storageManager: StorageManager | StorageManagerFactory;
  maxFileSize?: number;
  /** Maximum server-side download size; defaults to maxFileSize. */
  maxDownloadSize?: number;
  /** Maximum number of files accepted by non-router batch/upload requests. */
  maxFileCount?: number;
  /**
   * Required for client-triggered completion. Check your pending-upload record,
   * ownership, expiry, provider metadata and content before returning trusted DTOs.
   * Never return the request's files without independent verification.
   */
  verifyUploadCompletion?: (
    input: Readonly<{
      req: Request;
      endpoint: string;
      files: readonly UploadResponse[];
      metadata: unknown;
    }>,
  ) => Promise<UploadResponse[]>;
  /**
   * Optional type/MIME validation hook.
   * Return a FileValidationError or UploadError to block the request, or null to allow.
   */
  validateFile?: (
    input: FileValidationInput,
  ) => FileValidationError | UploadError | null;
  /**
   * Callback to generate serve/download URL for a key.
   * Defaults to: "/api/files/serve/" + encodeURIComponent(key)
   */
  serveUrlBuilder?: (key: string, context: string) => string;
  hooks?: FileHandlerHooks;
}

export interface FileValidationInput {
  fileName: string;
  contentType: string;
  fileSize: number;
  context: string;
  phase: "presign" | "batch-presign" | "multipart-init" | "upload";
}

export interface FileHandlerHooks {
  beforeUpload?: (file: UploadFile, context: string) => Promise<void> | void;
  afterUpload?: (
    upload: UploadResponse,
    context: string,
  ) => Promise<void> | void;
  onError?: (error: Error, context?: string) => Promise<void> | void;
}

export interface DeleteRequest {
  key: string;
  context?: string;
}

export interface DeleteResponse {
  success: boolean;
  message: string;
}

export interface DownloadRequest {
  key: string;
  name?: string;
  context?: string;
}

export interface DownloadResponse {
  downloadUrl: string;
  expiresIn: number | null;
  fileName: string;
}

export interface PresignedRequest {
  fileName: string;
  contentType: string;
  fileSize: number;
  context?: string;
  input?: unknown;
}

export interface PresignedResponse {
  fileName: string;
  presignedUrl: string;
  downloadUrl?: string;
  fileInfo: {
    path: string;
    key: string;
    name: string;
    size: number;
    type: string;
  };
  uploadHeaders?: Record<string, string>;
  directUploadSupported: boolean;
}

export interface BatchPresignedRequest {
  files: Array<{
    fileName: string;
    contentType: string;
    fileSize: number;
  }>;
  type?: string;
  input?: unknown;
}

export interface BatchPresignedResponse {
  files: PresignedResponse[];
  directUploadSupported: boolean;
}

export interface MultipartInitiateData {
  fileName: string;
  contentType: string;
  fileSize: number;
  context?: string;
  metadata?: Record<string, string>;
}

export interface MultipartGetPartUrlsData {
  uploadId: string;
  key: string;
  partNumbers: number[];
  context?: string;
}

export interface MultipartGetPartUrlsResponse {
  presignedUrls: Array<{
    partNumber: number;
    url: string;
    blockId?: string;
  }>;
}

export interface MultipartCompleteData {
  uploadId: string;
  key: string;
  parts: Array<
    | { PartNumber: number; ETag: string }
    | { blockId: string; partNumber: number }
  >;
  context?: string;
}

export interface MultipartAbortData {
  uploadId: string;
  key: string;
  context?: string;
}

export interface MultipartAbortResponse {
  success: boolean;
}

export type MultipartResponse =
  | MultipartInitResponse
  | MultipartGetPartUrlsResponse
  | MultipartCompleteResponse
  | MultipartAbortResponse;

export interface UploadFile {
  buffer: Buffer;
  name: string;
  type: string;
  size: number;
}

export interface UploadResponse {
  id: string;
  name: string;
  size: number;
  type: string;
  key: string;
  path: string;
  url: string;
  downloadUrl?: string;
  uploadedAt: string;
  expiresAt: string;
  context: string;
}

export interface ServeResponse {
  fileBuffer: Buffer;
  filename: string;
  context: string;
}
