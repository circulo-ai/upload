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
