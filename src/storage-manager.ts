import type { StorageProvider } from "./providers/base";
import {
  isMultipartUploadProvider,
  isPresignedUrlProvider,
} from "./providers/contracts";
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
} from "./types/core";
import { concurrentMap } from "./utils/concurrent-map";
import { UploadError } from "./utils/errors";

/**
 * Storage manager configuration with multiple named storage providers
 */
export type StorageProviderFactory = () => StorageProvider;

export type StorageManagerProviders<TContexts extends string = string> = Record<
  TContexts,
  StorageProvider | StorageProviderFactory
>;

export interface StorageManagerConfig<TContexts extends string = string> {
  /** Map of context names to storage providers or lazy factories */
  providers: StorageManagerProviders<TContexts>;
  /** Maximum concurrent provider operations in batch helpers (default: 8). */
  batchConcurrency?: number;
  /** Default provider context to use when none specified */
  defaultContext: NoInfer<TContexts>;
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
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(config: StorageManagerConfig<TContexts>) {
    this.config = { ...config, providers: { ...config.providers } };
    const concurrency = config.batchConcurrency ?? 8;
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 1000
    )
      throw new UploadError(
        "INVALID_INPUT",
        "batchConcurrency must be an integer between 1 and 1000",
      );

    // Validate that default context exists
    if (
      !Object.hasOwn(this.config.providers, this.config.defaultContext) ||
      !this.config.providers[this.config.defaultContext]
    ) {
      throw new Error(
        `Default context '${this.config.defaultContext}' not found in providers`,
      );
    }
  }

  /**
   * Get provider for a specific context
   */
  private getProvider(context?: TContexts): StorageProvider {
    if (this.closed)
      throw new UploadError(
        "PROVIDER_CLOSED",
        "Storage manager is closed",
        undefined,
        503,
      );
    const ctx = context ?? this.config.defaultContext;
    const providerOrFactory = this.config.providers[ctx];

    if (!Object.hasOwn(this.config.providers, ctx) || !providerOrFactory) {
      throw new Error(`Storage provider not found for context: ${ctx}`);
    }

    if (typeof providerOrFactory === "function") {
      const provider = providerOrFactory();
      this.config.providers[ctx] = provider;
      return provider;
    }

    return providerOrFactory;
  }

  /** Query metadata without buffering the object body. */
  async stat(
    options: ObjectStatOptions & { context?: TContexts },
  ): Promise<StoredObjectMetadata> {
    const { context, ...request } = options;
    const provider = this.getProvider(context);
    if (!provider.stat)
      throw new UploadError(
        "PROVIDER_UNSUPPORTED",
        "Provider does not support object metadata",
      );
    return provider.stat(request);
  }

  /** Close initialized providers once; unused lazy factories are never invoked. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const providers = [
      ...new Set(
        Object.values(this.config.providers).filter(
          (provider): provider is StorageProvider =>
            typeof provider !== "function",
        ),
      ),
    ];
    this.closePromise = Promise.allSettled(
      providers.map(async (provider) => provider.close?.()),
    ).then((results) => {
      const errors = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason);
      if (errors.length)
        throw new AggregateError(
          errors,
          "Could not close all storage providers",
        );
    });
    return this.closePromise;
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
    return Object.hasOwn(this.config.providers, context);
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
    return isPresignedUrlProvider(provider);
  }

  /**
   * Generate a presigned URL for uploading
   */
  async generatePresignedUploadUrl(
    options: ContextualPresignedUploadUrlOptions<TContexts>,
  ): Promise<PresignedUrlResponse> {
    const { context, ...urlOptions } = options;
    const provider = this.getProvider(context);

    if (!isPresignedUrlProvider(provider)) {
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

    if (!isPresignedUrlProvider(provider)) {
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
    return isMultipartUploadProvider(provider);
  }

  /**
   * Initiate a multipart upload
   */
  async initiateMultipartUpload(
    options: ContextualMultipartInitOptions<TContexts>,
  ): Promise<MultipartInitResponse> {
    const { context, ...initOptions } = options;
    const provider = this.getProvider(context);

    if (!isMultipartUploadProvider(provider)) {
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

    if (!isMultipartUploadProvider(provider)) {
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

    if (!isMultipartUploadProvider(provider)) {
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

    if (!isMultipartUploadProvider(provider)) {
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
    files: readonly ContextualUploadOptions<TContexts>[],
  ): Promise<FileInfo[]> {
    return concurrentMap(files, this.config.batchConcurrency ?? 8, (options) =>
      this.upload(options),
    );
  }

  /**
   * Batch generate presigned upload URLs
   */
  async generatePresignedUploadUrlBatch(
    requests: readonly ContextualPresignedUploadUrlOptions<TContexts>[],
  ): Promise<PresignedUrlResponse[]> {
    return concurrentMap(
      requests,
      this.config.batchConcurrency ?? 8,
      (options) => this.generatePresignedUploadUrl(options),
    );
  }
}

export type StorageManagerFactory<TContexts extends string = string> =
  () => StorageManager<TContexts>;
