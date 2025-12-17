import type { StorageProvider } from "./providers/base";
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
} from "./types/core";

/**
 * Storage manager configuration with multiple named storage providers
 */
export interface StorageManagerConfig<TContexts extends string = string> {
  /** Map of context names to storage providers */
  providers: Record<TContexts, StorageProvider>;
  /** Default provider context to use when none specified */
  defaultContext: TContexts;
}

/**
 * Options that include context selection
 */
export interface ContextualUploadOptions<
  TContexts extends string = string,
> extends UploadOptions {
  /** Storage context/bucket to use (defaults to manager's defaultContext) */
  context?: TContexts;
}

export interface ContextualDownloadOptions<
  TContexts extends string = string,
> extends DownloadOptions {
  context?: TContexts;
}

export interface ContextualDeleteOptions<
  TContexts extends string = string,
> extends DeleteOptions {
  context?: TContexts;
}

export interface ContextualPresignedUploadUrlOptions<
  TContexts extends string = string,
> extends PresignedUploadUrlOptions {
  context?: TContexts;
}

export interface ContextualPresignedDownloadUrlOptions<
  TContexts extends string = string,
> extends PresignedDownloadUrlOptions {
  context?: TContexts;
}

export interface ContextualMultipartInitOptions<
  TContexts extends string = string,
> extends MultipartInitOptions {
  context?: TContexts;
}

export interface ContextualMultipartPartUrlsOptions<
  TContexts extends string = string,
> extends MultipartPartUrlsOptions {
  context?: TContexts;
}

export interface ContextualMultipartCompleteOptions<
  TContexts extends string = string,
> extends MultipartCompleteOptions {
  context?: TContexts;
}

export interface ContextualMultipartAbortOptions<
  TContexts extends string = string,
> extends MultipartAbortOptions {
  context?: TContexts;
}

/**
 * Storage manager that supports multiple storage providers (buckets/containers)
 * Allows developers to organize files across different storage contexts
 *
 * @example
 * ```typescript
 * const manager = new StorageManager({
 *   providers: {
 *     'user-uploads': new S3StorageProvider({ bucket: 'user-files', region: 'us-east-1' }),
 *     'public-assets': new S3StorageProvider({ bucket: 'public', region: 'us-east-1' }),
 *     'temp-files': new LocalStorageProvider({ basePath: './temp' }),
 *   },
 *   defaultContext: 'user-uploads'
 * });
 *
 * // Upload to specific context
 * await manager.upload({
 *   file: buffer,
 *   fileName: 'avatar.png',
 *   contentType: 'image/png',
 *   context: 'user-uploads'
 * });
 * ```
 */
export class StorageManager<TContexts extends string = string> {
  private config: StorageManagerConfig<TContexts>;

  constructor(config: StorageManagerConfig<TContexts>) {
    this.config = config;

    // Validate that default context exists
    if (!this.config.providers[this.config.defaultContext]) {
      throw new Error(
        `Default context '${this.config.defaultContext}' not found in providers`,
      );
    }
  }

  /**
   * Get provider for a specific context
   */
  private getProvider(context?: TContexts): StorageProvider {
    const ctx = context || this.config.defaultContext;
    const provider = this.config.providers[ctx];

    if (!provider) {
      throw new Error(`Storage provider not found for context: ${ctx}`);
    }

    return provider;
  }

  /**
   * Get all available context names
   */
  getAvailableContexts(): TContexts[] {
    return Object.keys(this.config.providers) as TContexts[];
  }

  /**
   * Get the manager's configured default context
   */
  getDefaultContext(): TContexts {
    return this.config.defaultContext;
  }

  /**
   * Check if a context exists
   */
  hasContext(context: TContexts): boolean {
    return context in this.config.providers;
  }

  /**
   * Upload a file to storage
   */
  async upload(options: ContextualUploadOptions<TContexts>): Promise<FileInfo> {
    const { context, ...uploadOptions } = options;
    const provider = this.getProvider(context);
    return provider.upload(uploadOptions);
  }

  /**
   * Download a file from storage
   */
  async download(
    options: ContextualDownloadOptions<TContexts>,
  ): Promise<Buffer> {
    const { context, ...downloadOptions } = options;
    const provider = this.getProvider(context);
    return provider.download(downloadOptions);
  }

  /**
   * Delete a file from storage
   */
  async delete(options: ContextualDeleteOptions<TContexts>): Promise<void> {
    const { context, ...deleteOptions } = options;
    const provider = this.getProvider(context);
    return provider.delete(deleteOptions);
  }

  /**
   * Check if a context supports presigned URLs
   */
  supportsPresignedUrls(context?: TContexts): boolean {
    const provider = this.getProvider(context);
    return provider.supportsPresignedUrls();
  }

  /**
   * Generate a presigned URL for uploading
   */
  async generatePresignedUploadUrl(
    options: ContextualPresignedUploadUrlOptions<TContexts>,
  ): Promise<PresignedUrlResponse> {
    const { context, ...urlOptions } = options;
    const provider = this.getProvider(context);

    if (!provider.generatePresignedUploadUrl) {
      throw new Error(
        `Provider for context '${
          context || this.config.defaultContext
        }' does not support presigned URLs`,
      );
    }

    return provider.generatePresignedUploadUrl(urlOptions);
  }

  /**
   * Generate a presigned URL for downloading
   */
  async generatePresignedDownloadUrl(
    options: ContextualPresignedDownloadUrlOptions<TContexts>,
  ): Promise<string> {
    const { context, ...urlOptions } = options;
    const provider = this.getProvider(context);

    if (!provider.generatePresignedDownloadUrl) {
      throw new Error(
        `Provider for context '${
          context || this.config.defaultContext
        }' does not support presigned URLs`,
      );
    }

    return provider.generatePresignedDownloadUrl(urlOptions);
  }

  /**
   * Check if a context supports multipart uploads
   */
  supportsMultipartUpload(context?: TContexts): boolean {
    const provider = this.getProvider(context);
    return provider.supportsMultipartUpload();
  }

  /**
   * Initiate a multipart upload
   */
  async initiateMultipartUpload(
    options: ContextualMultipartInitOptions<TContexts>,
  ): Promise<MultipartInitResponse> {
    const { context, ...initOptions } = options;
    const provider = this.getProvider(context);

    if (!provider.initiateMultipartUpload) {
      throw new Error(
        `Provider for context '${
          context || this.config.defaultContext
        }' does not support multipart upload`,
      );
    }

    return provider.initiateMultipartUpload(initOptions);
  }

  /**
   * Get presigned URLs for uploading parts
   */
  async getMultipartPartUrls(
    options: ContextualMultipartPartUrlsOptions<TContexts>,
  ): Promise<MultipartPartUrl[]> {
    const { context, ...urlOptions } = options;
    const provider = this.getProvider(context);

    if (!provider.getMultipartPartUrls) {
      throw new Error(
        `Provider for context '${
          context || this.config.defaultContext
        }' does not support multipart upload`,
      );
    }

    return provider.getMultipartPartUrls(urlOptions);
  }

  /**
   * Complete a multipart upload
   */
  async completeMultipartUpload(
    options: ContextualMultipartCompleteOptions<TContexts>,
  ): Promise<MultipartCompleteResponse> {
    const { context, ...completeOptions } = options;
    const provider = this.getProvider(context);

    if (!provider.completeMultipartUpload) {
      throw new Error(
        `Provider for context '${
          context || this.config.defaultContext
        }' does not support multipart upload`,
      );
    }

    return provider.completeMultipartUpload(completeOptions);
  }

  /**
   * Abort a multipart upload
   */
  async abortMultipartUpload(
    options: ContextualMultipartAbortOptions<TContexts>,
  ): Promise<void> {
    const { context, ...abortOptions } = options;
    const provider = this.getProvider(context);

    if (!provider.abortMultipartUpload) {
      throw new Error(
        `Provider for context '${
          context || this.config.defaultContext
        }' does not support multipart upload`,
      );
    }

    return provider.abortMultipartUpload(abortOptions);
  }

  /**
   * Batch upload multiple files
   */
  async uploadBatch(
    files: ContextualUploadOptions<TContexts>[],
  ): Promise<FileInfo[]> {
    return Promise.all(files.map((options) => this.upload(options)));
  }

  /**
   * Batch generate presigned upload URLs
   */
  async generatePresignedUploadUrlBatch(
    requests: ContextualPresignedUploadUrlOptions<TContexts>[],
  ): Promise<PresignedUrlResponse[]> {
    return Promise.all(
      requests.map((options) => this.generatePresignedUploadUrl(options)),
    );
  }
}
