import {
  BlobSASPermissions,
  BlobServiceClient,
  type BlockBlobClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import type {
  AzureUploadPart,
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
} from "../types/core";
import { BaseStorageProvider } from "./base";

/**
 * Azure Blob Storage configuration
 */
export interface AzureBlobConfig {
  /** Container name */
  containerName: string;
  /** Storage account name */
  accountName: string;
  /** Storage account key (required for SAS generation) */
  accountKey?: string;
  /** Connection string (alternative to accountName + accountKey) */
  connectionString?: string;
  /** Optional path prefix within container */
  pathPrefix?: string;
}

/**
 * Type guard to check if parts are AzureUploadPart
 */
function isAzureUploadPart(part: unknown): part is AzureUploadPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "blockId" in part &&
    "partNumber" in part
  );
}

/**
 * Azure Blob Storage provider
 */
export class AzureBlobStorageProvider extends BaseStorageProvider {
  private client: BlobServiceClient;
  private config: AzureBlobConfig;

  constructor(config: AzureBlobConfig) {
    super();
    if (!config.containerName.trim()) {
      throw new Error("Azure container name is required");
    }
    if (!config.accountName.trim()) {
      throw new Error("Azure account name is required");
    }
    if (config.pathPrefix) {
      this.normalizeKey(config.pathPrefix.replace(/^\/+|\/+$/g, ""));
    }
    this.config = config;

    if (config.connectionString) {
      this.client = BlobServiceClient.fromConnectionString(
        config.connectionString,
      );
    } else if (config.accountName && config.accountKey) {
      const credential = new StorageSharedKeyCredential(
        config.accountName,
        config.accountKey,
      );
      this.client = new BlobServiceClient(
        `https://${config.accountName}.blob.core.windows.net`,
        credential,
      );
    } else {
      throw new Error(
        "Azure Blob config must include either connectionString or accountName + accountKey",
      );
    }
  }

  /**
   * Get the full key including path prefix
   */
  private getFullKey(key: string): string {
    const normalizedKey = this.normalizeKey(key);
    if (!this.config.pathPrefix) {
      return normalizedKey;
    }
    const prefix = this.normalizeKey(
      this.config.pathPrefix.replace(/^\/+|\/+$/g, ""),
    );
    if (normalizedKey === prefix || normalizedKey.startsWith(`${prefix}/`)) {
      return normalizedKey;
    }
    return this.normalizeKey(`${prefix}/${normalizedKey}`);
  }

  /**
   * Get serve path for a file
   */
  private getServePath(key: string): string {
    return `/api/files/serve/blob/${encodeURIComponent(key)}`;
  }

  /**
   * Get blob client for a key
   */
  private getBlobClient(key: string): BlockBlobClient {
    const containerClient = this.client.getContainerClient(
      this.config.containerName,
    );
    return containerClient.getBlockBlobClient(key);
  }

  async upload(options: UploadOptions): Promise<FileInfo> {
    const { file, fileName, contentType, preserveKey, customKey, metadata } =
      options;

    const key = this.getFullKey(
      customKey || this.generateKey(fileName, preserveKey),
    );

    const blobClient = this.getBlobClient(key);

    const uploadMetadata: Record<string, string> = {
      ...metadata,
      originalName: encodeURIComponent(fileName),
      uploadedAt: new Date().toISOString(),
    };

    await blobClient.upload(file, file.length, {
      blobHTTPHeaders: {
        blobContentType: contentType,
      },
      metadata: this.sanitizeMetadata(uploadMetadata, 8000), // Azure limit
    });

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

    const blobClient = this.getBlobClient(fullKey);
    const downloadResponse = await blobClient.download();

    if (!downloadResponse.readableStreamBody) {
      throw new Error("Failed to get readable stream from blob");
    }

    return this.streamToBuffer(
      downloadResponse.readableStreamBody,
      options.maxBytes,
    );
  }

  async delete(options: DeleteOptions): Promise<void> {
    const { key } = options;
    const fullKey = this.getFullKey(key);

    const blobClient = this.getBlobClient(fullKey);
    await blobClient.delete();
  }

  supportsPresignedUrls(): boolean {
    return !!this.config.accountKey;
  }

  async generatePresignedUploadUrl(
    options: PresignedUploadUrlOptions,
  ): Promise<PresignedUrlResponse> {
    if (!this.config.accountName || !this.config.accountKey) {
      throw new Error("Account name and key required for SAS generation");
    }

    const { fileName, contentType, expirationSeconds, metadata } = options;

    const key = this.getFullKey(this.generateKey(fileName));
    const blobClient = this.getBlobClient(key);

    const startsOn = new Date();
    const expiresOn = new Date(
      startsOn.getTime() +
        this.normalizeExpirationSeconds(expirationSeconds) * 1000,
    );

    const credential = new StorageSharedKeyCredential(
      this.config.accountName,
      this.config.accountKey,
    );

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: this.config.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse("w"), // Write permission
        startsOn,
        expiresOn,
      },
      credential,
    ).toString();

    // Build upload headers with metadata
    const uploadHeaders: Record<string, string> = {
      "x-ms-blob-type": "BlockBlob",
      "x-ms-blob-content-type": contentType,
    };

    const sanitizedMetadata = metadata
      ? this.sanitizeMetadata(metadata, 8000)
      : undefined;

    if (sanitizedMetadata) {
      for (const [k, v] of Object.entries(sanitizedMetadata)) {
        uploadHeaders[`x-ms-meta-${k}`] = v;
      }
    }

    return {
      url: `${blobClient.url}?${sasToken}`,
      key,
      uploadHeaders,
    };
  }

  async generatePresignedDownloadUrl(
    options: PresignedDownloadUrlOptions,
  ): Promise<string> {
    if (!this.config.accountName || !this.config.accountKey) {
      throw new Error("Account name and key required for SAS generation");
    }

    const { key, expirationSeconds } = options;
    const fullKey = this.getFullKey(key);

    const blobClient = this.getBlobClient(fullKey);

    const startsOn = new Date();
    const expiresOn = new Date(
      startsOn.getTime() +
        this.normalizeExpirationSeconds(expirationSeconds) * 1000,
    );

    const credential = new StorageSharedKeyCredential(
      this.config.accountName,
      this.config.accountKey,
    );

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: this.config.containerName,
        blobName: fullKey,
        permissions: BlobSASPermissions.parse("r"), // Read permission
        startsOn,
        expiresOn,
      },
      credential,
    ).toString();

    return `${blobClient.url}?${sasToken}`;
  }

  supportsMultipartUpload(): boolean {
    return true;
  }

  async initiateMultipartUpload(
    options: MultipartInitOptions,
  ): Promise<MultipartInitResponse> {
    const { fileName, contentType, metadata } = options;

    const key = this.getFullKey(this.generateKey(fileName));

    // This ID is metadata only; use a cryptographically random value so it
    // cannot be guessed when it appears in logs or client state.
    const uploadId = this.generateKey("upload");

    const blobClient = this.getBlobClient(key);

    // Set metadata to track the multipart upload
    const uploadMetadata: Record<string, string> = {
      ...metadata,
      uploadId,
      fileName: encodeURIComponent(fileName),
      contentType,
      uploadStarted: new Date().toISOString(),
      multipartUpload: "true",
    };

    await blobClient.setMetadata(this.sanitizeMetadata(uploadMetadata, 8000));

    return {
      uploadId,
      key,
    };
  }

  async getMultipartPartUrls(
    options: MultipartPartUrlsOptions,
  ): Promise<MultipartPartUrl[]> {
    if (!this.config.accountName || !this.config.accountKey) {
      throw new Error("Account name and key required for SAS generation");
    }

    const { key, partNumbers } = options;
    const fullKey = this.getFullKey(key);

    const blobClient = this.getBlobClient(fullKey);

    const credential = new StorageSharedKeyCredential(
      this.config.accountName,
      this.config.accountKey,
    );

    return partNumbers.map((partNumber) => {
      // Azure uses block IDs (base64 encoded, same length)
      const blockId = Buffer.from(
        `block-${partNumber.toString().padStart(6, "0")}`,
      ).toString("base64");

      const startsOn = new Date();
      const expiresOn = new Date(startsOn.getTime() + 3600 * 1000);

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: this.config.containerName,
          blobName: fullKey,
          permissions: BlobSASPermissions.parse("w"),
          startsOn,
          expiresOn,
        },
        credential,
      ).toString();

      return {
        partNumber,
        blockId,
        url: `${blobClient.url}?comp=block&blockid=${encodeURIComponent(
          blockId,
        )}&${sasToken}`,
      };
    });
  }

  async completeMultipartUpload(
    options: MultipartCompleteOptions,
  ): Promise<MultipartCompleteResponse> {
    const { key, parts } = options;
    const fullKey = this.getFullKey(key);

    const blobClient = this.getBlobClient(fullKey);

    // Validate and convert parts to Azure format
    const azureParts: AzureUploadPart[] = parts.map((part) => {
      if (!isAzureUploadPart(part)) {
        throw new Error(
          "Invalid part format for Azure Blob. Expected { blockId: string, partNumber: number }",
        );
      }
      return part;
    });

    // Sort parts and extract block IDs
    const blockIds = azureParts
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => part.blockId);

    // Commit the block list
    await blobClient.commitBlockList(blockIds, {
      metadata: {
        multipartUpload: "completed",
        uploadCompletedAt: new Date().toISOString(),
      },
    });

    return {
      location: blobClient.url,
      path: this.getServePath(key),
      key,
    };
  }

  async abortMultipartUpload(options: MultipartAbortOptions): Promise<void> {
    const { key } = options;
    const fullKey = this.getFullKey(key);

    const blobClient = this.getBlobClient(fullKey);

    try {
      await blobClient.deleteIfExists();
    } catch (error) {
      // Ignore errors during cleanup
      console.warn("Error aborting multipart upload:", error);
    }
  }

  /**
   * Convert readable stream to buffer
   */
  private streamToBuffer(
    readableStream: NodeJS.ReadableStream,
    maxBytes?: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;
      readableStream.on("data", (data) => {
        const buffer = data instanceof Buffer ? data : Buffer.from(data);
        totalBytes += buffer.length;
        if (maxBytes !== undefined && totalBytes > maxBytes) {
          settled = true;
          (
            readableStream as NodeJS.ReadableStream & {
              destroy?: (error?: Error) => void;
            }
          ).destroy?.(new Error("File exceeds the configured download limit"));
          reject(new Error("File exceeds the configured download limit"));
          return;
        }
        chunks.push(buffer);
      });
      readableStream.on("end", () => {
        if (!settled) resolve(Buffer.concat(chunks));
      });
      readableStream.on("error", (error) => {
        if (!settled) reject(error);
      });
    });
  }
}
