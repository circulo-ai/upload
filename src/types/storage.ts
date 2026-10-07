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
  /** Create-only writes must reject existing objects, never silently overwrite. */
  writeMode?: "overwrite" | "create-only";
  /** Cache-Control for the stored object. */
  cacheControl?: string;
}

/**
 * Options for downloading a file
 */
export interface DownloadOptions {
  /** Storage key to download */
  key: string;
  /** Inclusive byte range. Providers that cannot enforce it must reject it. */
  range?: Readonly<{ start: number; end: number }>;
  /** Optional upper bound for buffered downloads, in bytes */
  maxBytes?: number;
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
  /** Exact application-owned key (otherwise a unique key is generated). */
  customKey?: string;
  /** Require a signed create-only write. */
  writeMode?: "overwrite" | "create-only";
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

/** Provider-neutral object metadata; null denotes unavailable metadata. */
export interface StoredObjectMetadata {
  byteSize: number | null;
  contentType: string | null;
  etag: string | null;
}

export interface ObjectStatOptions {
  key: string;
}
