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
  ObjectStatOptions,
  PresignedDownloadUrlOptions,
  PresignedUploadUrlOptions,
  PresignedUrlResponse,
  StoredObjectMetadata,
  UploadOptions,
} from "../types/core";

/** Small capabilities can be implemented without inheriting a package base class. */
export interface ObjectUploader {
  upload(options: UploadOptions): Promise<FileInfo>;
}
export interface ObjectDownloader {
  download(options: DownloadOptions): Promise<Buffer>;
}
export interface ObjectDeleter {
  delete(options: DeleteOptions): Promise<void>;
}
export interface ObjectMetadataReader {
  stat(options: ObjectStatOptions): Promise<StoredObjectMetadata>;
}
export interface StorageLifecycle {
  close(): void | Promise<void>;
}

export interface PresignedUrlProvider {
  generatePresignedUploadUrl(
    options: PresignedUploadUrlOptions,
  ): Promise<PresignedUrlResponse>;
  generatePresignedDownloadUrl(
    options: PresignedDownloadUrlOptions,
  ): Promise<string>;
}

export interface MultipartUploadProvider {
  initiateMultipartUpload(
    options: MultipartInitOptions,
  ): Promise<MultipartInitResponse>;
  getMultipartPartUrls(
    options: MultipartPartUrlsOptions,
  ): Promise<MultipartPartUrl[]>;
  completeMultipartUpload(
    options: MultipartCompleteOptions,
  ): Promise<MultipartCompleteResponse>;
  abortMultipartUpload(options: MultipartAbortOptions): Promise<void>;
}

export interface StorageProvider
  extends
    ObjectUploader,
    ObjectDownloader,
    ObjectDeleter,
    Partial<ObjectMetadataReader>,
    Partial<StorageLifecycle>,
    Partial<PresignedUrlProvider>,
    Partial<MultipartUploadProvider> {
  supportsPresignedUrls(): boolean;
  supportsMultipartUpload(): boolean;
}

/** Verify the declared capability and its complete implementation before dispatch. */
export function isPresignedUrlProvider(
  provider: StorageProvider,
): provider is StorageProvider & PresignedUrlProvider {
  return (
    provider.supportsPresignedUrls() &&
    typeof provider.generatePresignedUploadUrl === "function" &&
    typeof provider.generatePresignedDownloadUrl === "function"
  );
}

export function isMultipartUploadProvider(
  provider: StorageProvider,
): provider is StorageProvider & MultipartUploadProvider {
  return (
    provider.supportsMultipartUpload() &&
    typeof provider.initiateMultipartUpload === "function" &&
    typeof provider.getMultipartPartUrls === "function" &&
    typeof provider.completeMultipartUpload === "function" &&
    typeof provider.abortMultipartUpload === "function"
  );
}
