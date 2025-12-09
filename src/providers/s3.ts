import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
  S3UploadPart,
  UploadOptions,
} from "../types/core";
import { BaseStorageProvider } from "./base";

/**
 * S3-compatible storage configuration
 */
export interface S3Config {
  /** S3 bucket name */
  bucket: string;
  /** AWS region */
  region: string;
  /** Custom endpoint (for S3-compatible services like MinIO, R2) */
  endpoint?: string;
  /** Force path-style URLs (required for MinIO and some S3-compatible services) */
  forcePathStyle?: boolean;
  /** AWS credentials (optional, will use default credential chain if not provided) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
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
  private client: S3Client;
  private config: S3Config;

  constructor(config: S3Config) {
    super();
    this.config = config;

    const clientConfig: S3ClientConfig = {
      region: config.region,
    };

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = config.forcePathStyle ?? true;
    } else if (config.forcePathStyle !== undefined) {
      clientConfig.forcePathStyle = config.forcePathStyle;
    }

    if (config.credentials) {
      clientConfig.credentials = config.credentials;
    }

    this.client = new S3Client(clientConfig);
  }

  /**
   * Get the full key including path prefix
   */
  private getFullKey(key: string): string {
    const prefix = this.config.pathPrefix?.replace(/\/$/, "");
    if (!prefix) return key;
    // Avoid double-prefixing when caller already includes the prefix
    if (key === prefix || key.startsWith(`${prefix}/`)) {
      return key;
    }
    return `${prefix}/${key}`;
  }

  /**
   * Get serve path for a file
   */
  private getServePath(key: string): string {
    return `/api/files/serve/${encodeURIComponent(key)}`;
  }

  async upload(options: UploadOptions): Promise<FileInfo> {
    const { file, fileName, contentType, preserveKey, customKey, metadata } =
      options;

    const key = this.getFullKey(
      customKey || this.generateKey(fileName, preserveKey),
    );

    const uploadMetadata: Record<string, string> = {
      originalName: encodeURIComponent(fileName),
      uploadedAt: new Date().toISOString(),
      ...metadata,
    };

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
        Metadata: this.sanitizeMetadata(uploadMetadata),
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

  async download(options: DownloadOptions): Promise<Buffer> {
    const { key } = options;
    const fullKey = this.getFullKey(key);

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: fullKey,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`File not found: ${key}`);
    }

    const stream = response.Body as unknown as NodeJS.ReadableStream;

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  async delete(options: DeleteOptions): Promise<void> {
    const { key } = options;
    const fullKey = this.getFullKey(key);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      }),
    );
  }

  supportsPresignedUrls(): boolean {
    return true;
  }

  async generatePresignedUploadUrl(
    options: PresignedUploadUrlOptions,
  ): Promise<PresignedUrlResponse> {
    const {
      fileName,
      contentType,
      fileSize,
      expirationSeconds = 3600,
      metadata,
    } = options;

    const key = this.getFullKey(this.generateKey(fileName));

    const uploadMetadata: Record<string, string> = {
      originalName: this.sanitizeFilename(fileName),
      uploadedAt: new Date().toISOString(),
      ...metadata,
    };

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: fileSize,
      Metadata: this.sanitizeMetadata(uploadMetadata),
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: expirationSeconds,
    });

    return {
      url,
      key,
    };
  }

  async generatePresignedDownloadUrl(
    options: PresignedDownloadUrlOptions,
  ): Promise<string> {
    const { key, expirationSeconds = 3600 } = options;
    const fullKey = this.getFullKey(key);

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: fullKey,
    });

    return getSignedUrl(this.client, command, { expiresIn: expirationSeconds });
  }

  supportsMultipartUpload(): boolean {
    return true;
  }

  async initiateMultipartUpload(
    options: MultipartInitOptions,
  ): Promise<MultipartInitResponse> {
    const { fileName, contentType, metadata } = options;

    const safeFileName = fileName
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9.-]/g, "_");

    const key = this.getFullKey(
      `${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 9)}-${safeFileName}`,
    );

    const uploadMetadata: Record<string, string> = {
      originalName: this.sanitizeFilename(fileName),
      uploadedAt: new Date().toISOString(),
      ...metadata,
    };

    const command = new CreateMultipartUploadCommand({
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

  async getMultipartPartUrls(
    options: MultipartPartUrlsOptions,
  ): Promise<MultipartPartUrl[]> {
    const { uploadId, key, partNumbers } = options;
    const fullKey = this.getFullKey(key);

    const urls = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const command = new UploadPartCommand({
          Bucket: this.config.bucket,
          Key: fullKey,
          PartNumber: partNumber,
          UploadId: uploadId,
        });

        const url = await getSignedUrl(this.client, command, {
          expiresIn: 3600,
        });

        return { partNumber, url };
      }),
    );

    return urls;
  }

  async completeMultipartUpload(
    options: MultipartCompleteOptions,
  ): Promise<MultipartCompleteResponse> {
    const { uploadId, key, parts } = options;
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

    const command = new CompleteMultipartUploadCommand({
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

  async abortMultipartUpload(options: MultipartAbortOptions): Promise<void> {
    const { uploadId, key } = options;
    const fullKey = this.getFullKey(key);

    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
        UploadId: uploadId,
      }),
    );
  }
}
