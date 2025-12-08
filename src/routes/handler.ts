import type { StorageManager } from "../storage-manager";
import type {
  MultipartCompleteResponse,
  MultipartInitResponse,
} from "../types/core";
import { MAX_FILE_SIZE } from "../types/core";
import { validateFileSize, validateFileType } from "../utils/validation";

export interface FileHandlerConfig {
  storageManager: StorageManager;
  maxFileSize?: number;
  /**
   * Callback to generate serve/download URL for a key.
   * Defaults to: "/api/files/serve/" + encodeURIComponent(key)
   */
  serveUrlBuilder?: (key: string, context: string) => string;
}

export interface DeleteRequest {
  key: string;
  context?: string;
}

export interface DeleteResponse {
  success: boolean;
  message: string;
}

export interface DownloadRequest {
  key: string;
  name?: string;
  context?: string;
}

export interface DownloadResponse {
  downloadUrl: string;
  expiresIn: number | null;
  fileName: string;
}

export interface PresignedRequest {
  fileName: string;
  contentType: string;
  fileSize: number;
  context?: string;
}

export interface PresignedResponse {
  fileName: string;
  presignedUrl: string;
  fileInfo: {
    path: string;
    key: string;
    name: string;
    size: number;
    type: string;
  };
  uploadHeaders?: Record<string, string>;
  directUploadSupported: boolean;
}

export interface BatchPresignedRequest {
  files: Array<{
    fileName: string;
    contentType: string;
    fileSize: number;
  }>;
  type?: string;
}

export interface BatchPresignedResponse {
  files: PresignedResponse[];
  directUploadSupported: boolean;
}

export interface MultipartInitiateData {
  fileName: string;
  contentType: string;
  fileSize: number;
  context?: string;
  metadata?: Record<string, string>;
}

export interface MultipartGetPartUrlsData {
  uploadId: string;
  key: string;
  partNumbers: number[];
  context?: string;
}

export interface MultipartGetPartUrlsResponse {
  presignedUrls: Array<{
    partNumber: number;
    url: string;
    blockId?: string;
  }>;
}

export interface MultipartCompleteData {
  uploadId: string;
  key: string;
  parts: Array<
    | { PartNumber: number; ETag: string }
    | { blockId: string; partNumber: number }
  >;
  context?: string;
}

export interface MultipartAbortData {
  uploadId: string;
  key: string;
  context?: string;
}

export interface MultipartAbortResponse {
  success: boolean;
}

export type MultipartResponse =
  | MultipartInitResponse
  | MultipartGetPartUrlsResponse
  | MultipartCompleteResponse
  | MultipartAbortResponse;

export interface UploadFile {
  buffer: Buffer;
  name: string;
  type: string;
  size: number;
}

export interface UploadResponse {
  id: string;
  name: string;
  size: number;
  type: string;
  key: string;
  path: string;
  url: string;
  uploadedAt: string;
  expiresAt: string;
  context: string;
}

export interface ServeResponse {
  fileBuffer: Buffer;
  filename: string;
  context: string;
}

export class FileRouteHandler {
  private storageManager: StorageManager;
  private maxFileSize: number;
  private serveUrlBuilder: (key: string, context: string) => string;

  constructor(config: FileHandlerConfig) {
    this.storageManager = config.storageManager;
    this.maxFileSize = config.maxFileSize || MAX_FILE_SIZE;
    this.serveUrlBuilder =
      config.serveUrlBuilder ||
      ((key) => "/api/files/serve/" + encodeURIComponent(key));
  }

  private getContext(contextInput?: string): string {
    return contextInput && this.storageManager.hasContext(contextInput)
      ? contextInput
      : "general";
  }

  async handleDelete(
    key: string,
    contextInput?: string,
  ): Promise<DeleteResponse> {
    if (!key) {
      throw new Error("File key is required");
    }

    const context = this.getContext(contextInput);
    await this.storageManager.delete({ key, context });

    return { success: true, message: "File deleted successfully" };
  }

  async handleDownload(
    key: string,
    name?: string,
    contextInput?: string,
  ): Promise<DownloadResponse> {
    const context = this.getContext(contextInput);
    const fileName = name || key.split("/").pop() || "download";

    if (this.storageManager.supportsPresignedUrls(context)) {
      const downloadUrl =
        await this.storageManager.generatePresignedDownloadUrl({
          key,
          context,
          expirationSeconds: 5 * 60,
        });

      return {
        downloadUrl,
        expiresIn: 300,
        fileName,
      };
    }

    // Local/Server fallback
    const downloadUrl = this.serveUrlBuilder(key, context);
    return {
      downloadUrl,
      expiresIn: null,
      fileName,
    };
  }

  async handlePresigned(
    input: PresignedRequest,
    metadata?: Record<string, string>,
  ): Promise<PresignedResponse> {
    const { fileName, contentType, fileSize, context: contextInput } = input;
    const context = this.getContext(contextInput);

    // Validate size
    const sizeError = validateFileSize(fileSize, this.maxFileSize);
    if (sizeError) {
      throw new Error(sizeError.message);
    }

    // Validate type for specific contexts
    if (context === "knowledge-base") {
      const typeError = validateFileType(fileName, contentType);
      if (typeError) {
        throw new Error(typeError.message);
      }
    }

    if (!this.storageManager.supportsPresignedUrls(context)) {
      return {
        fileName,
        presignedUrl: "",
        fileInfo: {
          path: "",
          key: "",
          name: fileName,
          size: fileSize,
          type: contentType,
        },
        directUploadSupported: false,
      };
    }

    const result = await this.storageManager.generatePresignedUploadUrl({
      fileName,
      contentType,
      fileSize,
      context,
      expirationSeconds: 3600,
      metadata,
    });

    let downloadUrl: string | undefined;
    try {
      downloadUrl = await this.storageManager.generatePresignedDownloadUrl({
        key: result.key,
        context,
        expirationSeconds: 24 * 60 * 60,
      });
    } catch {
      // Ignore download URL generation errors
    }

    const finalPath = downloadUrl || this.serveUrlBuilder(result.key, context);

    return {
      fileName,
      presignedUrl: result.url,
      fileInfo: {
        path: finalPath,
        key: result.key,
        name: fileName,
        size: fileSize,
        type: contentType,
      },
      uploadHeaders: result.uploadHeaders,
      directUploadSupported: true,
    };
  }

  async handleBatchPresigned(
    input: BatchPresignedRequest,
    metadata?: Record<string, string>,
  ): Promise<BatchPresignedResponse> {
    const { files, type } = input;
    const context = this.getContext(type);

    // Validate all files first
    for (const file of files) {
      if (file.fileSize > this.maxFileSize) {
        throw new Error(`File ${file.fileName} exceeds maximum size`);
      }
      if (context === "knowledge-base") {
        const typeError = validateFileType(file.fileName, file.contentType);
        if (typeError) {
          throw new Error(typeError.message);
        }
      }
    }

    if (!this.storageManager.supportsPresignedUrls(context)) {
      return {
        files: files.map((file) => ({
          fileName: file.fileName,
          presignedUrl: "",
          fileInfo: {
            path: "",
            key: "",
            name: file.fileName,
            size: file.fileSize,
            type: file.contentType,
          },
          directUploadSupported: false,
        })),
        directUploadSupported: false,
      };
    }

    const results = await Promise.all(
      files.map((file) =>
        this.storageManager.generatePresignedUploadUrl({
          fileName: file.fileName,
          contentType: file.contentType,
          fileSize: file.fileSize,
          context,
          expirationSeconds: 3600,
          metadata,
        }),
      ),
    );

    return {
      files: results.map((result, index) => {
        const file = files[index];
        if (!file) {
          throw new Error("File index mismatch");
        }

        const finalPath = this.serveUrlBuilder(result.key, context);

        return {
          fileName: file.fileName,
          presignedUrl: result.url,
          fileInfo: {
            path: finalPath,
            key: result.key,
            name: file.fileName,
            size: file.fileSize,
            type: file.contentType,
          },
          uploadHeaders: result.uploadHeaders,
          directUploadSupported: true,
        };
      }),
      directUploadSupported: true,
    };
  }

  async handleMultipart(
    action: "initiate" | "get-part-urls" | "complete" | "abort",
    data:
      | MultipartInitiateData
      | MultipartGetPartUrlsData
      | MultipartCompleteData
      | MultipartAbortData,
    metadata?: Record<string, string>,
  ): Promise<MultipartResponse> {
    const context = this.getContext(data.context);

    if (!this.storageManager.supportsMultipartUpload(context)) {
      throw new Error(
        `Provider for ${context} doesn't support multipart upload`,
      );
    }

    switch (action) {
      case "initiate": {
        const initiateData = data as MultipartInitiateData;
        const {
          fileName,
          contentType,
          fileSize,
          metadata: clientMetadata,
        } = initiateData;

        return this.storageManager.initiateMultipartUpload({
          fileName,
          contentType,
          fileSize,
          context,
          metadata: { ...clientMetadata, ...metadata },
        });
      }
      case "get-part-urls": {
        const urlData = data as MultipartGetPartUrlsData;
        const { uploadId, key, partNumbers } = urlData;

        const urls = await this.storageManager.getMultipartPartUrls({
          uploadId,
          key,
          partNumbers,
          context,
        });

        return { presignedUrls: urls };
      }
      case "complete": {
        const completeData = data as MultipartCompleteData;
        const { uploadId, key, parts } = completeData;

        return this.storageManager.completeMultipartUpload({
          uploadId,
          key,
          parts,
          context,
        });
      }
      case "abort": {
        const abortData = data as MultipartAbortData;
        const { uploadId, key } = abortData;

        await this.storageManager.abortMultipartUpload({
          uploadId,
          key,
          context,
        });

        return { success: true };
      }
      default: {
        const exhaustiveCheck: never = action;
        throw new Error(`Invalid multipart action: ${exhaustiveCheck}`);
      }
    }
  }

  async handleUpload(
    files: UploadFile[],
    contextInput: string | undefined,
    metadata?: Record<string, string>,
  ): Promise<UploadResponse | { files: UploadResponse[] }> {
    if (!files || files.length === 0) {
      throw new Error("No files provided");
    }

    const context = this.getContext(contextInput);
    const uploadResults: UploadResponse[] = [];

    for (const file of files) {
      // Validate size
      const sizeError = validateFileSize(file.size, this.maxFileSize);
      if (sizeError) {
        throw new Error(sizeError.message);
      }

      // Validate type
      if (context === "knowledge-base") {
        const typeError = validateFileType(file.name, file.type);
        if (typeError) {
          throw new Error(typeError.message);
        }
      }

      const fileInfo = await this.storageManager.upload({
        file: file.buffer,
        fileName: file.name,
        contentType: file.type,
        context,
        metadata: {
          uploadSource: "web",
          ...metadata,
        },
      });

      // Generate download URL if supported
      let downloadUrl: string | undefined;
      if (this.storageManager.supportsPresignedUrls(context)) {
        try {
          downloadUrl = await this.storageManager.generatePresignedDownloadUrl({
            key: fileInfo.key,
            context,
            expirationSeconds: 24 * 60 * 60,
          });
        } catch {
          // Ignore download URL generation errors
        }
      }

      uploadResults.push({
        id: fileInfo.key,
        name: file.name,
        size: file.buffer.length,
        type: file.type,
        key: fileInfo.key,
        path: fileInfo.path,
        url: downloadUrl || fileInfo.path,
        uploadedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        context,
      });
    }

    return uploadResults.length === 1
      ? uploadResults[0]
      : { files: uploadResults };
  }

  async handleServe(
    key: string,
    contextInput?: string,
  ): Promise<ServeResponse> {
    if (!key) {
      throw new Error("No file key provided");
    }
    const context = this.getContext(contextInput);

    const fileBuffer = await this.storageManager.download({ key, context });
    const filename = key.split("/").pop() || "download";

    return {
      fileBuffer,
      filename,
      context,
    };
  }
}
