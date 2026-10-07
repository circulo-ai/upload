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
  ObjectStatOptions,
  PresignedDownloadUrlOptions,
  PresignedUploadUrlOptions,
  PresignedUrlResponse,
  S3UploadPart,
  StoredObjectMetadata,
  SupportedAudioExtension,
  SupportedDocumentExtension,
  SupportedImageExtension,
  SupportedMediaExtension,
  SupportedVideoExtension,
  UploadOptions,
} from "./types/core";

export {
  MAX_FILE_SIZE,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
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
  FtpStorageProvider,
  type FtpAccessOptions,
  type FtpClient,
  type FtpClientFactory,
  type FtpClientFactoryOptions,
  type FtpConfig,
} from "./providers/ftp";
export {
  LocalStorageProvider,
  type LocalStorageConfig,
} from "./providers/local";
export {
  S3StorageProvider,
  type S3Config,
  type S3Credentials,
} from "./providers/s3";
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
  SUPPORTED_IMAGE_MIME_TYPES,
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
  MAX_FILENAME_LENGTH,
  MAX_STORAGE_KEY_LENGTH,
  base64ToBuffer,
  bufferToBase64,
  contentDisposition,
  isValidUrl,
  normalizeStorageKey,
  sanitizeFilename,
} from "./utils/security";

// Typed file routers
export {
  FileRouteBuilder,
  createFileRouter,
  f,
  getFileRouteRule,
  parseFileSize,
  type FileRouteComplete,
  type FileRouteCompleteContext,
  type FileRouteConfig,
  type FileRouteDefinition,
  type FileRouteFile,
  type FileRouteFileType,
  type FileRouteInputParser,
  type FileRouteMiddleware,
  type FileRouteMiddlewareContext,
  type FileRouteRule,
  type FileRouter,
  type FileRouterEndpoint,
  type FileRouterInput,
} from "./router";
export {
  FileRouterHandler,
  type FileRouterCompletionFile,
  type FileRouterCompletionResponse,
  type FileRouterHandlerConfig,
} from "./routes/router-handler";

export {
  SignedLocalStorageProvider,
  type SignedLocalStorageConfig,
} from "./providers/local-signed";

export { detectCommonMimeType } from "./utils/content";

export * from "./providers/contracts";
