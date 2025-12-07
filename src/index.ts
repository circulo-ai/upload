// Core types
export type {
  FileInfo,
  FileMetadata,
  UploadOptions,
  DownloadOptions,
  DeleteOptions,
  PresignedUploadUrlOptions,
  PresignedDownloadUrlOptions,
  PresignedUrlResponse,
  S3UploadPart,
  AzureUploadPart,
  MultipartUploadPart,
  MultipartInitResponse,
  MultipartPartUrl,
  MultipartInitOptions,
  MultipartPartUrlsOptions,
  MultipartCompleteOptions,
  MultipartAbortOptions,
  MultipartCompleteResponse,
  ContentType,
  FileValidationError,
  SupportedDocumentExtension,
  SupportedAudioExtension,
  SupportedVideoExtension,
  SupportedMediaExtension,
} from "./types/core";

export {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  MAX_FILE_SIZE,
} from "./types/core";

// Provider interfaces and base classes
export { type StorageProvider, BaseStorageProvider } from "./providers/base";

// Provider implementations
export { S3StorageProvider, type S3Config } from "./providers/s3";
export {
  AzureBlobStorageProvider,
  type AzureBlobConfig,
} from "./providers/azure-blob";
export {
  LocalStorageProvider,
  type LocalStorageConfig,
} from "./providers/local";

// Storage manager
export {
  StorageManager,
  type StorageManagerConfig,
  type ContextualUploadOptions,
  type ContextualDownloadOptions,
  type ContextualDeleteOptions,
  type ContextualPresignedUploadUrlOptions,
  type ContextualPresignedDownloadUrlOptions,
  type ContextualMultipartInitOptions,
  type ContextualMultipartPartUrlsOptions,
  type ContextualMultipartCompleteOptions,
  type ContextualMultipartAbortOptions,
} from "./storage-manager";

// Utilities
export {
  getContentType,
  isSupportedMimeType,
  getFileExtension,
  getMimeTypeFromExtension,
  validateFileType,
  validateFileSize,
  formatFileSize,
  MIME_TYPE_MAPPING,
  SUPPORTED_MIME_TYPES,
  SUPPORTED_AUDIO_MIME_TYPES,
  SUPPORTED_VIDEO_MIME_TYPES,
} from "./utils/validation";

export {
  sanitizeFilename,
  isValidUrl,
  bufferToBase64,
  base64ToBuffer,
} from "./utils/security";
