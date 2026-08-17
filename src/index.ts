// Core types
export type {
  AzureUploadPart,
  ContentType,
  DeleteOptions,
  DownloadOptions,
  FileInfo,
  FileMetadata,
  FileValidationError,
  MultipartAbortOptions,
  MultipartCompleteOptions,
  MultipartCompleteResponse,
  MultipartInitOptions,
  MultipartInitResponse,
  MultipartPartUrl,
  MultipartPartUrlsOptions,
  MultipartUploadPart,
  PresignedDownloadUrlOptions,
  PresignedUploadUrlOptions,
  PresignedUrlResponse,
  S3UploadPart,
  SupportedAudioExtension,
  SupportedDocumentExtension,
  SupportedMediaExtension,
  SupportedVideoExtension,
  UploadOptions,
} from "./types/core";

export {
  MAX_FILE_SIZE,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
} from "./types/core";

// Provider interfaces and base classes
export { BaseStorageProvider, type StorageProvider } from "./providers/base";

// Provider implementations
export {
  AzureBlobStorageProvider,
  type AzureBlobConfig,
} from "./providers/azure-blob";
export {
  LocalStorageProvider,
  type LocalStorageConfig,
} from "./providers/local";
export { S3StorageProvider, type S3Config } from "./providers/s3";
export {
  VercelBlobStorageProvider,
  type VercelBlobConfig,
} from "./providers/vercel-blob";

// Storage manager
export {
  StorageManager,
  type ContextualDeleteOptions,
  type ContextualDownloadOptions,
  type ContextualMultipartAbortOptions,
  type ContextualMultipartCompleteOptions,
  type ContextualMultipartInitOptions,
  type ContextualMultipartPartUrlsOptions,
  type ContextualPresignedDownloadUrlOptions,
  type ContextualPresignedUploadUrlOptions,
  type ContextualUploadOptions,
  type StorageManagerConfig,
  type StorageManagerFactory,
  type StorageManagerProviders,
  type StorageProviderFactory,
} from "./storage-manager";

// Route handler
export {
  FileRouteHandler,
  type BatchPresignedRequest,
  type BatchPresignedResponse,
  type DeleteRequest,
  type DeleteResponse,
  type DownloadRequest,
  type DownloadResponse,
  type FileHandlerConfig,
  type FileHandlerHooks,
  type FileValidationInput,
  type MultipartAbortData,
  type MultipartAbortResponse,
  type MultipartCompleteData,
  type MultipartGetPartUrlsData,
  type MultipartGetPartUrlsResponse,
  type MultipartInitiateData,
  type MultipartResponse,
  type PresignedRequest,
  type PresignedResponse,
  type ServeResponse,
  type UploadFile,
  type UploadResponse,
} from "./routes/handler";

// Utilities
export {
  MIME_TYPE_MAPPING,
  SUPPORTED_AUDIO_MIME_TYPES,
  SUPPORTED_MIME_TYPES,
  SUPPORTED_VIDEO_MIME_TYPES,
  formatFileSize,
  getContentType,
  getFileExtension,
  getMimeTypeFromExtension,
  isSupportedMimeType,
  validateFileSize,
  validateFileType,
} from "./utils/validation";

export { UploadError, type UploadErrorCode } from "./utils/errors";
export {
  base64ToBuffer,
  bufferToBase64,
  isValidUrl,
  sanitizeFilename,
} from "./utils/security";
