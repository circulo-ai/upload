import type { StorageManager } from "../storage-manager";
import type {
  MultipartCompleteResponse,
  MultipartInitResponse,
} from "../types/core";
import { MAX_FILE_SIZE } from "../types/core";
import { UploadError } from "../utils/errors";
import { sanitizeFilename } from "../utils/security";
import { validateFileSize, validateFileType } from "../utils/validation";

export interface FileHandlerConfig {
  storageManager: StorageManager;
  maxFileSize?: number;
  /**
   * Callback to generate serve/download URL for a key.
   * Defaults to: "/api/files/serve/" + encodeURIComponent(key)
   */
  serveUrlBuilder?: (key: string, context: string) => string;
  hooks?: FileHandlerHooks;
}

export interface FileHandlerHooks {
  beforeUpload?: (file: UploadFile, context: string) => Promise<void> | void;
  afterUpload?: (
    upload: UploadResponse,
    context: string,
  ) => Promise<void> | void;
  onError?: (error: Error, context?: string) => Promise<void> | void;
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
  downloadUrl?: string;
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
  downloadUrl?: string;
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
  private hooks?: FileHandlerHooks;

  constructor(config: FileHandlerConfig) {
    this.storageManager = config.storageManager;
    this.maxFileSize = config.maxFileSize || MAX_FILE_SIZE;
    this.hooks = config.hooks;
    this.serveUrlBuilder =
      config.serveUrlBuilder ||
      ((key, context) =>
        `/api/files/serve/${encodeURIComponent(key)}${
          context ? `?context=${encodeURIComponent(context)}` : ""
        }`);
  }

  private async emitError(error: Error, context?: string): Promise<void> {
    if (!this.hooks?.onError) return;
    try {
      await this.hooks.onError(error, context);
    } catch {
      // Swallow hook errors to avoid masking primary failures
    }
  }

  private async runBeforeUpload(
    file: UploadFile,
    context: string,
  ): Promise<void> {
    if (this.hooks?.beforeUpload) {
      await this.hooks.beforeUpload(file, context);
    }
  }

  private async runAfterUpload(
    upload: UploadResponse,
    context: string,
  ): Promise<void> {
    if (this.hooks?.afterUpload) {
      await this.hooks.afterUpload(upload, context);
    }
  }

  private getContext(contextInput?: string): string {
    if (!contextInput) {
      return this.storageManager.getDefaultContext();
    }

    if (this.storageManager.hasContext(contextInput)) {
      return contextInput;
    }

    throw new UploadError(
      "UNKNOWN_CONTEXT",
      `Storage context '${contextInput}' is not configured`,
      { context: contextInput },
    );
  }

  async handleDelete(
    key: string,
    contextInput?: string,
  ): Promise<DeleteResponse> {
    if (!key) {
      throw new UploadError("MISSING_KEY", "File key is required");
    }

    const context = this.getContext(contextInput);
    try {
      await this.storageManager.delete({ key, context });
    } catch (error) {
      await this.emitError(error as Error, context);
      throw error;
    }

    return { success: true, message: "File deleted successfully" };
  }

  async handleDownload(
    key: string,
    name?: string,
    contextInput?: string,
  ): Promise<DownloadResponse> {
    const context = this.getContext(contextInput);
    const rawName = name || key.split("/").pop() || "download";
    const fileName = sanitizeFilename(rawName);

    try {
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Download failed";
      const status =
        message.toLowerCase().includes("not found") ||
        message.toLowerCase().includes("missing")
          ? 404
          : 500;
      const uploadError =
        error instanceof UploadError
          ? error
          : new UploadError(
              "DOWNLOAD_FAILED",
              message,
              { key, context },
              status,
            );
      await this.emitError(uploadError, context);
      throw uploadError;
    }
  }

  async handlePresigned(
    input: PresignedRequest,
    metadata?: Record<string, string>,
  ): Promise<PresignedResponse> {
    const { fileName, contentType, fileSize, context: contextInput } = input;
    const context = this.getContext(contextInput);

    try {
      const sizeError = validateFileSize(fileSize, this.maxFileSize);
      if (sizeError) {
        throw new UploadError(
          sizeError.code,
          sizeError.message,
          { maxSize: this.maxFileSize, size: fileSize },
          400,
        );
      }

      if (context === "knowledge-base") {
        const typeError = validateFileType(fileName, contentType);
        if (typeError) {
          throw new UploadError(
            typeError.code,
            typeError.message,
            { supportedTypes: typeError.supportedTypes },
            400,
          );
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

      const servePath = this.serveUrlBuilder(result.key, context);

      return {
        fileName,
        presignedUrl: result.url,
        downloadUrl,
        fileInfo: {
          path: servePath,
          key: result.key,
          name: fileName,
          size: fileSize,
          type: contentType,
        },
        uploadHeaders: result.uploadHeaders,
        directUploadSupported: true,
      };
    } catch (error) {
      await this.emitError(error as Error, context);
      throw error;
    }
  }

  async handleBatchPresigned(
    input: BatchPresignedRequest,
    metadata?: Record<string, string>,
  ): Promise<BatchPresignedResponse> {
    const { files, type } = input;
    const context = this.getContext(type);

    try {
      for (const file of files) {
        if (file.fileSize > this.maxFileSize) {
          throw new UploadError(
            "FILE_TOO_LARGE",
            `File ${file.fileName} exceeds maximum size`,
            { maxSize: this.maxFileSize, size: file.fileSize },
          );
        }
        if (context === "knowledge-base") {
          const typeError = validateFileType(file.fileName, file.contentType);
          if (typeError) {
            throw new UploadError(
              typeError.code,
              typeError.message,
              { supportedTypes: typeError.supportedTypes },
            );
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
            throw new UploadError(
              "INTERNAL_ERROR",
              "File index mismatch during batch presign",
            );
          }

          const servePath = this.serveUrlBuilder(result.key, context);

          return {
            fileName: file.fileName,
            presignedUrl: result.url,
            downloadUrl: undefined,
            fileInfo: {
              path: servePath,
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
    } catch (error) {
      await this.emitError(error as Error, context);
      throw error;
    }
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

    try {
      if (!this.storageManager.supportsMultipartUpload(context)) {
        throw new UploadError(
          "PROVIDER_UNSUPPORTED_MULTIPART",
          `Provider for ${context} doesn't support multipart upload`,
          { context },
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

          const sizeError = validateFileSize(fileSize, this.maxFileSize);
          if (sizeError) {
            throw new UploadError(
              sizeError.code,
              sizeError.message,
              { maxSize: this.maxFileSize, size: fileSize },
            );
          }
          if (context === "knowledge-base") {
            const typeError = validateFileType(fileName, contentType);
            if (typeError) {
              throw new UploadError(
                typeError.code,
                typeError.message,
                { supportedTypes: typeError.supportedTypes },
              );
            }
          }

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
          throw new UploadError(
            "INTERNAL_ERROR",
            `Invalid multipart action: ${exhaustiveCheck}`,
          );
        }
      }
    } catch (error) {
      await this.emitError(error as Error, context);
      throw error;
    }
  }

  async handleUpload(
    files: UploadFile[],
    contextInput: string | undefined,
    metadata?: Record<string, string>,
  ): Promise<UploadResponse | { files: UploadResponse[] }> {
    if (!files || files.length === 0) {
      throw new UploadError("NO_FILES", "No files provided");
    }

    const context = this.getContext(contextInput);
    const uploadResults: UploadResponse[] = [];

    try {
      for (const file of files) {
        const sizeError = validateFileSize(file.size, this.maxFileSize);
        if (sizeError) {
          throw new UploadError(
            sizeError.code,
            sizeError.message,
            { maxSize: this.maxFileSize, size: file.size, file: file.name },
          );
        }

        if (context === "knowledge-base") {
          const typeError = validateFileType(file.name, file.type);
          if (typeError) {
            throw new UploadError(
              typeError.code,
              typeError.message,
              { supportedTypes: typeError.supportedTypes, file: file.name },
            );
          }
        }

        await this.runBeforeUpload(file, context);

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

        const servePath = this.serveUrlBuilder(fileInfo.key, context);

        const uploadResult: UploadResponse = {
          id: fileInfo.key,
          name: file.name,
          size: file.buffer.length,
          type: file.type,
          key: fileInfo.key,
          path: servePath,
          url: downloadUrl || servePath,
          downloadUrl,
          uploadedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          context,
        };

        uploadResults.push(uploadResult);
        await this.runAfterUpload(uploadResult, context);
      }

      return uploadResults.length === 1
        ? uploadResults[0]
        : { files: uploadResults };
    } catch (error) {
      await this.emitError(error as Error, context);
      throw error;
    }
  }

  async handleServe(
    key: string,
    contextInput?: string,
  ): Promise<ServeResponse> {
    if (!key) {
      throw new UploadError("MISSING_KEY", "No file key provided");
    }
    const context = this.getContext(contextInput);

    try {
      const fileBuffer = await this.storageManager.download({ key, context });
      const filename = sanitizeFilename(key.split("/").pop() || "download");

      return {
        fileBuffer,
        filename,
        context,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "File could not be served";
      const status =
        message.toLowerCase().includes("not found") ||
        message.toLowerCase().includes("missing")
          ? 404
          : 500;
      const uploadError =
        error instanceof UploadError
          ? error
          : new UploadError(
              status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
              message,
              { key, context },
              status,
            );
      await this.emitError(uploadError, context);
      throw uploadError;
    }
  }
}
