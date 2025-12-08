/**
 * Information about an uploaded file
 */
export interface FileInfo {
  /** Access path for the file (URL or serve path) */
  path: string;
  /** Storage key/identifier */
  key: string;
  /** Original filename */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  type: string;
}

/**
 * Metadata for files stored in cloud storage
 */
export interface FileMetadata {
  /** Original filename */
  originalName: string;
  /** Upload timestamp (ISO 8601) */
  uploadedAt: string;
  /** Additional custom metadata */
  [key: string]: string;
}

/**
 * Options for uploading a file
 */
export interface UploadOptions {
  /** File buffer to upload */
  file: Buffer;
  /** Original filename */
  fileName: string;
  /** MIME type */
  contentType: string;
  /** Skip timestamp prefix (useful for deterministic keys) */
  preserveKey?: boolean;
  /** Custom storage key (overrides fileName) */
  customKey?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Options for downloading a file
 */
export interface DownloadOptions {
  /** Storage key to download */
  key: string;
}

/**
 * Options for deleting a file
 */
export interface DeleteOptions {
  /** Storage key to delete */
  key: string;
}

/**
 * Options for generating presigned URLs for upload
 */
export interface PresignedUploadUrlOptions {
  /** Filename for upload */
  fileName: string;
  /** MIME type */
  contentType: string;
  /** File size in bytes */
  fileSize: number;
  /** URL expiration time in seconds (default: 3600) */
  expirationSeconds?: number;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Options for generating presigned URLs for download
 */
export interface PresignedDownloadUrlOptions {
  /** Storage key */
  key: string;
  /** URL expiration time in seconds (default: 3600) */
  expirationSeconds?: number;
}

/**
 * Response from presigned URL generation
 */
export interface PresignedUrlResponse {
  /** Presigned URL */
  url: string;
  /** Storage key that will be used */
  key: string;
  /** Additional headers required for upload (provider-specific) */
  uploadHeaders?: Record<string, string>;
}

// ============================================================================
// MULTIPART UPLOAD TYPES - Provider-specific parts
// ============================================================================

/**
 * S3 multipart upload part (after upload completes)
 * Used with AWS S3, Cloudflare R2, MinIO, and other S3-compatible services
 */
export interface S3UploadPart {
  /** Part number (1-indexed) */
  PartNumber: number;
  /** ETag returned from S3 after uploading the part */
  ETag: string;
}

/**
 * Azure Blob multipart upload part (block)
 * Used with Azure Blob Storage
 */
export interface AzureUploadPart {
  /** Base64-encoded block ID */
  blockId: string;
  /** Part number for ordering (used for sorting before commit) */
  partNumber: number;
}

/**
 * Base interface for multipart upload parts
 * Providers should use either S3UploadPart or AzureUploadPart
 */
export type MultipartUploadPart = S3UploadPart | AzureUploadPart;

/**
 * Response from multipart upload initiation
 */
export interface MultipartInitResponse {
  /** Upload ID for tracking */
  uploadId: string;
  /** Storage key for the file */
  key: string;
}

/**
 * Presigned URL for multipart upload part
 */
export interface MultipartPartUrl {
  /** Part number (1-indexed) */
  partNumber: number;
  /** Presigned URL for uploading this part */
  url: string;
  /** Block ID (Azure Blob only) */
  blockId?: string;
}

/**
 * Options for initiating multipart upload
 */
export interface MultipartInitOptions {
  /** Filename */
  fileName: string;
  /** MIME type */
  contentType: string;
  /** Total file size in bytes */
  fileSize: number;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Options for getting part upload URLs
 */
export interface MultipartPartUrlsOptions {
  /** Upload ID from initiation */
  uploadId: string;
  /** Storage key */
  key: string;
  /** Array of part numbers to generate URLs for */
  partNumbers: number[];
}

/**
 * Options for completing multipart upload
 */
export interface MultipartCompleteOptions {
  /** Upload ID from initiation */
  uploadId: string;
  /** Storage key */
  key: string;
  /** Array of uploaded parts (provider-specific format) */
  parts: MultipartUploadPart[];
}

/**
 * Options for aborting multipart upload
 */
export interface MultipartAbortOptions {
  /** Upload ID from initiation */
  uploadId: string;
  /** Storage key */
  key: string;
}

/**
 * Result from completing multipart upload
 */
export interface MultipartCompleteResponse {
  /** Final file location URL */
  location: string;
  /** Serve path for the file */
  path: string;
  /** Storage key */
  key: string;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Supported document file extensions
 */
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "csv",
  "doc",
  "docx",
  "txt",
  "md",
  "xlsx",
  "xls",
  "ppt",
  "pptx",
  "html",
  "htm",
  "json",
  "yaml",
  "yml",
] as const;

/**
 * Supported audio file extensions
 */
export const SUPPORTED_AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "wav",
  "webm",
  "ogg",
  "flac",
  "aac",
  "opus",
] as const;

/**
 * Supported video file extensions
 */
export const SUPPORTED_VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
] as const;

export type SupportedDocumentExtension =
  (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];
export type SupportedAudioExtension =
  (typeof SUPPORTED_AUDIO_EXTENSIONS)[number];
export type SupportedVideoExtension =
  (typeof SUPPORTED_VIDEO_EXTENSIONS)[number];
export type SupportedMediaExtension =
  | SupportedDocumentExtension
  | SupportedAudioExtension
  | SupportedVideoExtension;

/**
 * File validation error
 */
export interface FileValidationError {
  code: "UNSUPPORTED_FILE_TYPE" | "MIME_TYPE_MISMATCH" | "FILE_TOO_LARGE";
  message: string;
  supportedTypes: readonly string[];
}

/**
 * MIME type content categories
 */
export type ContentType = "image" | "document" | "audio" | "video";

/**
 * Maximum file size (100MB)
 */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;
