import type { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
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
  S3UploadPart,
  StoredObjectMetadata,
  UploadOptions,
} from "../types/core";
import { MAX_FILE_SIZE } from "../types/core";
import { bufferStream } from "../utils/bounded-stream";
import { UploadError } from "../utils/errors";
import { optionalDependency } from "../utils/optional-dependency";
import {
  assertByteSize,
  assertContentType,
  assertPartNumbers,
  assertWriteMode,
} from "../utils/storage-validation";
import { BaseStorageProvider } from "./base";

/**
 * S3-compatible storage configuration
 */
export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface S3Config {
  /** S3 bucket name */
  bucket: string;
  /** AWS region */
  region: string;
  /** Custom endpoint (for S3-compatible services like MinIO, R2) */
  endpoint?: string;
  /** Public endpoint used only for signing browser-facing URLs. */
  publicEndpoint?: string;
  /** Encryption applied to writes and required by presigned uploads. */
  serverSideEncryption?: "AES256" | "aws:kms";
  kmsKeyId?: string;
  /** Bounded retries and network timeouts. */
  maxAttempts?: number;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Default maximum size for buffered reads (100 MiB). */
  maxDownloadBytes?: number;
  /** Force path-style URLs (required for MinIO and some S3-compatible services) */
  forcePathStyle?: boolean;
  /** AWS credentials (optional, will use default credential chain if not provided) */
  credentials?: S3Credentials | (() => Promise<S3Credentials>);
  /** Optional path prefix within bucket */
  pathPrefix?: string;
}

/**
 * Type guard to check if parts are S3UploadPart
 */
function isS3UploadPart(part: unknown): part is S3UploadPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "PartNumber" in part &&
    "ETag" in part
  );
}

/**
 * S3-compatible storage provider
 * Works with AWS S3, Cloudflare R2, MinIO, and other S3-compatible services
 */
export class S3StorageProvider extends BaseStorageProvider {
  private readonly sdk =
    optionalDependency<typeof import("@aws-sdk/client-s3")>(
      "@aws-sdk/client-s3",
    );
  private client: S3Client;
  private signingClient: S3Client;
  private closed = false;
  private config: S3Config;

  constructor(config: S3Config) {
    super();
    if (!config.bucket.trim()) throw new Error("S3 bucket is required");
    if (!config.region.trim()) throw new Error("S3 region is required");
    if (config.pathPrefix)
      this.normalizeKey(config.pathPrefix.replace(/^\/+|\/+$/g, ""));
    for (const endpointValue of [config.endpoint, config.publicEndpoint].filter(
      (value): value is string => value !== undefined,
    )) {
      const endpoint = new URL(endpointValue);
      if (!["http:", "https:"].includes(endpoint.protocol)) {
        throw new Error("S3 endpoint must use http or https");
      }
    }
    if (config.kmsKeyId && config.serverSideEncryption !== "aws:kms") {
      throw new UploadError(
        "INVALID_INPUT",
        "kmsKeyId requires aws:kms encryption",
      );
    }
    for (const [name, value] of Object.entries({
      maxAttempts: config.maxAttempts ?? 3,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 10_000,
      requestTimeoutMs: config.requestTimeoutMs ?? 30_000,
    })) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new UploadError(
          "INVALID_INPUT",
          `${name} must be a positive integer`,
        );
    }
    assertByteSize(config.maxDownloadBytes ?? MAX_FILE_SIZE, "Download limit");
    this.config = {
      ...config,
      credentials:
        typeof config.credentials === "function"
          ? config.credentials
          : config.credentials
            ? { ...config.credentials }
            : undefined,
    };

    const clientConfig: S3ClientConfig = {
      region: config.region,
      maxAttempts: config.maxAttempts ?? 3,
      requestHandler: {
        connectionTimeout: config.connectionTimeoutMs ?? 10_000,
        requestTimeout: config.requestTimeoutMs ?? 30_000,
        socketTimeout: config.requestTimeoutMs ?? 30_000,
        throwOnRequestTimeout: true,
      },
    };

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = config.forcePathStyle ?? true;
    } else if (config.forcePathStyle !== undefined) {
      clientConfig.forcePathStyle = config.forcePathStyle;
    }

    if (config.credentials) {
      clientConfig.credentials = this.config.credentials;
    }

    this.client = new this.sdk.S3Client(clientConfig);
    this.signingClient = config.publicEndpoint
      ? new this.sdk.S3Client({
          ...clientConfig,
          endpoint: config.publicEndpoint,
          forcePathStyle: config.forcePathStyle ?? true,
        })
      : this.client;
  }

  /**
   * Get the full key including path prefix
   */
  private getFullKey(key: string): string {
    if (this.closed)
      throw new UploadError(
        "PROVIDER_CLOSED",
        "Storage provider is closed",
        undefined,
        503,
      );
    const normalizedKey = this.normalizeKey(key);
    const prefix = this.config.pathPrefix?.replace(/\/$/, "");
    if (!prefix) return normalizedKey;
    const normalizedPrefix = this.normalizeKey(prefix);
    // Avoid double-prefixing when caller already includes the prefix
    if (
      normalizedKey === normalizedPrefix ||
      normalizedKey.startsWith(`${normalizedPrefix}/`)
    ) {
      return normalizedKey;
    }
    return this.normalizeKey(`${normalizedPrefix}/${normalizedKey}`);
  }

  /**
   * Get serve path for a file
   */
  private getServePath(key: string): string {
    return `/api/files/serve/${encodeURIComponent(key)}`;
  }

  override async upload(options: UploadOptions): Promise<FileInfo> {
    assertWriteMode(options.writeMode);
    assertContentType(options.contentType);
    assertByteSize(options.file.byteLength);
    const { file, fileName, contentType, preserveKey, customKey, metadata } =
      options;

    const key = this.getFullKey(
      customKey ?? this.generateKey(fileName, preserveKey),
    );

    const uploadMetadata: Record<string, string> = {
      ...metadata,
      originalName: encodeURIComponent(fileName),
      uploadedAt: new Date().toISOString(),
    };

    await this.client.send(
      new this.sdk.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
        Metadata: this.sanitizeMetadata(uploadMetadata),
        ...this.encryption(),
        ...(options.cacheControl ? { CacheControl: options.cacheControl } : {}),
        ...(options.writeMode === "create-only" ? { IfNoneMatch: "*" } : {}),
      }),
    );

    return {
      path: this.getServePath(key),
      key,
      name: fileName,
      size: file.length,
      type: contentType,
    };
  }

  async stat(options: ObjectStatOptions): Promise<StoredObjectMetadata> {
    const result = await this.client.send(
      new this.sdk.HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getFullKey(options.key),
      }),
    );
    return {
      byteSize: result.ContentLength ?? null,
      contentType: result.ContentType ?? null,
      etag: result.ETag ?? null,
    };
  }

  override async download(options: DownloadOptions): Promise<Buffer> {
    const fullKey = this.getFullKey(options.key);
    const limit =
      options.maxBytes ?? this.config.maxDownloadBytes ?? MAX_FILE_SIZE;
    assertByteSize(limit, "Download limit");
    const range = options.range;
    if (range) {
      assertByteSize(range.start, "Range start");
      assertByteSize(range.end, "Range end");
      if (range.end < range.start || range.end - range.start + 1 > limit) {
        throw new UploadError(
          "INVALID_INPUT",
          "Invalid or oversized byte range",
        );
      }
    }
    const response = await this.client.send(
      new this.sdk.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    if (!response.Body)
      throw new UploadError(
        "NOT_FOUND",
        "Object has no readable body",
        undefined,
        404,
      );
    const stream = response.Body as Readable;
    if (
      response.ContentLength !== undefined &&
      response.ContentLength > limit
    ) {
      stream.destroy();
      throw new UploadError(
        "FILE_TOO_LARGE",
        "File exceeds the configured download limit",
        undefined,
        413,
      );
    }
    return bufferStream(stream, limit);
  }

  /** Close both internal and public signing clients exactly once. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.client.destroy();
    if (this.signingClient !== this.client) this.signingClient.destroy();
  }

  private encryption() {
    return {
      ...(this.config.serverSideEncryption
        ? { ServerSideEncryption: this.config.serverSideEncryption }
        : {}),
      ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
    };
  }

  override async delete(options: DeleteOptions): Promise<void> {
    const { key } = options;
    const fullKey = this.getFullKey(key);

    await this.client.send(
      new this.sdk.DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      }),
    );
  }

  override supportsPresignedUrls(): boolean {
    return true;
  }

  override async generatePresignedUploadUrl(
    options: PresignedUploadUrlOptions,
  ): Promise<PresignedUrlResponse> {
    const { fileName, contentType, fileSize, expirationSeconds, metadata } =
      options;

    assertWriteMode("writeMode" in options ? options.writeMode : undefined);
    assertContentType(contentType);
    assertByteSize(options.fileSize);
    const key = this.getFullKey(
      options.customKey ?? this.generateKey(fileName),
    );

    const uploadMetadata: Record<string, string> = {
      ...metadata,
      originalName: this.sanitizeFilename(fileName),
      uploadedAt: new Date().toISOString(),
    };

    const command = new this.sdk.PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: fileSize,
      ...this.encryption(),
      ...(options.writeMode === "create-only" ? { IfNoneMatch: "*" } : {}),
      Metadata: this.sanitizeMetadata(uploadMetadata),
    });

    const { getSignedUrl } = optionalDependency<
      typeof import("@aws-sdk/s3-request-presigner")
    >("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(this.signingClient, command, {
      expiresIn: this.normalizeExpirationSeconds(expirationSeconds),
      signableHeaders: new Set(["content-type", "if-none-match"]),
    });

    return {
      url,
      key,
      uploadHeaders: {
        "Content-Type": contentType,
        ...(options.writeMode === "create-only"
          ? { "If-None-Match": "*" }
          : {}),
        ...(this.config.serverSideEncryption
          ? { "x-amz-server-side-encryption": this.config.serverSideEncryption }
          : {}),
        ...(this.config.kmsKeyId
          ? {
              "x-amz-server-side-encryption-aws-kms-key-id":
                this.config.kmsKeyId,
            }
          : {}),
      },
    };
  }

  override async generatePresignedDownloadUrl(
    options: PresignedDownloadUrlOptions,
  ): Promise<string> {
    const { key, expirationSeconds } = options;
    const fullKey = this.getFullKey(key);

    const command = new this.sdk.GetObjectCommand({
      Bucket: this.config.bucket,
      Key: fullKey,
    });

    const { getSignedUrl } = optionalDependency<
      typeof import("@aws-sdk/s3-request-presigner")
    >("@aws-sdk/s3-request-presigner");
    return getSignedUrl(this.signingClient, command, {
      expiresIn: this.normalizeExpirationSeconds(expirationSeconds),
    });
  }

  override supportsMultipartUpload(): boolean {
    return true;
  }

  override async initiateMultipartUpload(
    options: MultipartInitOptions,
  ): Promise<MultipartInitResponse> {
    const { fileName, contentType, metadata } = options;

    assertWriteMode("writeMode" in options ? options.writeMode : undefined);
    assertContentType(contentType);
    assertByteSize(options.fileSize);
    const key = this.getFullKey(this.generateKey(fileName));

    const uploadMetadata: Record<string, string> = {
      ...metadata,
      originalName: this.sanitizeFilename(fileName),
      uploadedAt: new Date().toISOString(),
    };

    const command = new this.sdk.CreateMultipartUploadCommand({
      ...this.encryption(),
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType,
      Metadata: this.sanitizeMetadata(uploadMetadata),
    });

    const response = await this.client.send(command);

    if (!response.UploadId) {
      throw new Error("Failed to initiate multipart upload");
    }

    return {
      uploadId: response.UploadId,
      key,
    };
  }

  override async getMultipartPartUrls(
    options: MultipartPartUrlsOptions,
  ): Promise<MultipartPartUrl[]> {
    const { uploadId, key, partNumbers } = options;
    assertPartNumbers(partNumbers);
    if (!uploadId?.trim())
      throw new UploadError("INVALID_INPUT", "Upload ID is required");
    const { getSignedUrl } = optionalDependency<
      typeof import("@aws-sdk/s3-request-presigner")
    >("@aws-sdk/s3-request-presigner");
    const fullKey = this.getFullKey(key);

    const urls = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const command = new this.sdk.UploadPartCommand({
          Bucket: this.config.bucket,
          Key: fullKey,
          PartNumber: partNumber,
          UploadId: uploadId,
        });

        const url = await getSignedUrl(this.signingClient, command, {
          expiresIn: 3600,
        });

        return { partNumber, url };
      }),
    );

    return urls;
  }

  override async completeMultipartUpload(
    options: MultipartCompleteOptions,
  ): Promise<MultipartCompleteResponse> {
    const { uploadId, key, parts } = options;
    if (!uploadId?.trim())
      throw new UploadError("INVALID_INPUT", "Upload ID is required");
    const fullKey = this.getFullKey(key);

    // Validate and convert parts to S3 format
    const s3Parts: S3UploadPart[] = parts.map((part) => {
      if (!isS3UploadPart(part)) {
        throw new Error(
          "Invalid part format for S3. Expected { PartNumber: number, ETag: string }",
        );
      }
      return part;
    });

    assertPartNumbers(s3Parts.map((part) => part.PartNumber));
    if (
      s3Parts.some((part) => typeof part.ETag !== "string" || !part.ETag.trim())
    )
      throw new UploadError("INVALID_INPUT", "Part ETags are required");
    const command = new this.sdk.CompleteMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: fullKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: s3Parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    });

    const response = await this.client.send(command);

    const location =
      response.Location ||
      (this.config.endpoint
        ? `${this.config.endpoint.replace(/\/$/, "")}/${
            this.config.bucket
          }/${fullKey}`
        : `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${fullKey}`);

    return {
      location,
      path: this.getServePath(key),
      key,
    };
  }

  override async abortMultipartUpload(
    options: MultipartAbortOptions,
  ): Promise<void> {
    const { uploadId, key } = options;
    if (!uploadId?.trim())
      throw new UploadError("INVALID_INPUT", "Upload ID is required");
    const fullKey = this.getFullKey(key);

    await this.client.send(
      new this.sdk.AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
        UploadId: uploadId,
      }),
    );
  }
}
