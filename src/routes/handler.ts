import type {
  StorageManager,
  StorageManagerFactory,
} from "../storage-manager";
import type {
  FileValidationError,
  MultipartCompleteResponse,
  MultipartInitResponse,
} from "../types/core";
import { MAX_FILE_SIZE } from "../types/core";
import { UploadError } from "../utils/errors";
import { sanitizeFilename } from "../utils/security";
import { validateFileSize } from "../utils/validation";

export interface FileHandlerConfig {
  /**
   * Pass a factory to defer initialization until the first request.
   */
  storageManager: StorageManager | StorageManagerFactory;
  maxFileSize?: number;
  /**
   * Optional type/MIME validation hook.
   * Return a FileValidationError or UploadError to block the request, or null to allow.
   */
  validateFile?: (
    input: FileValidationInput,
  ) => FileValidationError | UploadError | null;
  /**
   * Callback to generate serve/download URL for a key.
   * Defaults to: "/api/files/serve/" + encodeURIComponent(key)
   */
  serveUrlBuilder?: (key: string, context: string) => string;
  hooks?: FileHandlerHooks;
}

export interface FileValidationInput {
  fileName: string;
  contentType: string;
  fileSize: number;
  context: string;
  phase: "presign" | "batch-presign" | "multipart-init" | "upload";
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
  private storageManager: StorageManager | StorageManagerFactory;
  private maxFileSize: number;
  private validateFileFn?: FileHandlerConfig["validateFile"];
  private serveUrlBuilder: (key: string, context: string) => string;
  private hooks?: FileHandlerHooks;

  constructor(config: FileHandlerConfig) {
    this.storageManager = config.storageManager;
    this.maxFileSize = config.maxFileSize || MAX_FILE_SIZE;
    this.validateFileFn = config.validateFile;
    this.hooks = config.hooks;
    this.serveUrlBuilder =
      config.serveUrlBuilder ||
      ((key, context) =>
        `/api/files/serve/${encodeURIComponent(key)}${
          context ? `?context=${encodeURIComponent(context)}` : ""
        }`);
  }

  private resolveStorageManager(): StorageManager {
    if (typeof this.storageManager === "function") {
      const manager = this.storageManager();
      this.storageManager = manager;
      return manager;
    }

    return this.storageManager;
  }

  private async emitError(error: Error, context?: string): Promise<void> {
    if (!this.hooks?.onError) return;
    try {
      await this.hooks.onError(error, context);
    } catch {
      // Swallow hook errors to avoid masking primary failures
    }
  }

  private runTypeValidation(input: FileValidationInput): void {
    if (!this.validateFileFn) return;
    const result = this.validateFileFn(input);
    if (!result) return;
    if (result instanceof UploadError) {
      throw result;
    }
    throw new UploadError(result.code, result.message, {
      supportedTypes: result.supportedTypes,
    });
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

  private getContext(
    contextInput?: string,
    storageManager: StorageManager = this.resolveStorageManager(),
  ): string {
    if (!contextInput) {
      return storageManager.getDefaultContext();
    }

    if (storageManager.hasContext(contextInput)) {
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

    const storageManager = this.resolveStorageManager();
    const context = this.getContext(contextInput, storageManager);
    try {
      await storageManager.delete({ key, context });
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
    const storageManager = this.resolveStorageManager();
    const context = this.getContext(contextInput, storageManager);
    const rawName = name || key.split("/").pop() || "download";
    const fileName = sanitizeFilename(rawName);

    try {
      if (storageManager.supportsPresignedUrls(context)) {
        const downloadUrl =
          await storageManager.generatePresignedDownloadUrl({
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
    const storageManager = this.resolveStorageManager();
    const context = this.getContext(contextInput, storageManager);

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

      this.runTypeValidation({
        fileName,
        contentType,
        fileSize,
        context,
        phase: "presign",
      });

      if (!storageManager.supportsPresignedUrls(context)) {
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

      const result = await storageManager.generatePresignedUploadUrl({
        fileName,
        contentType,
        fileSize,
        context,
        expirationSeconds: 3600,
        metadata,
      });

      let downloadUrl: string | undefined;
      try {
        downloadUrl = await storageManager.generatePresignedDownloadUrl({
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
    const storageManager = this.resolveStorageManager();
    const context = this.getContext(type, storageManager);

    try {
      for (const file of files) {
        if (file.fileSize > this.maxFileSize) {
          throw new UploadError(
            "FILE_TOO_LARGE",
            `File ${file.fileName} exceeds maximum size`,
            { maxSize: this.maxFileSize, size: file.fileSize },
          );
        }
        this.runTypeValidation({
          fileName: file.fileName,
          contentType: file.contentType,
          fileSize: file.fileSize,
          context,
          phase: "batch-presign",
        });
      }

      if (!storageManager.supportsPresignedUrls(context)) {
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
          storageManager.generatePresignedUploadUrl({
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
    const storageManager = this.resolveStorageManager();
    const context = this.getContext(data.context, storageManager);

    try {
      if (!storageManager.supportsMultipartUpload(context)) {
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
            throw new UploadError(sizeError.code, sizeError.message, {
              maxSize: this.maxFileSize,
              size: fileSize,
            });
          }
          this.runTypeValidation({
            fileName,
            contentType,
            fileSize,
            context,
            phase: "multipart-init",
          });

          return storageManager.initiateMultipartUpload({
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

          const urls = await storageManager.getMultipartPartUrls({
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

          return storageManager.completeMultipartUpload({
            uploadId,
            key,
            parts,
            context,
          });
        }
        case "abort": {
          const abortData = data as MultipartAbortData;
          const { uploadId, key } = abortData;

          await storageManager.abortMultipartUpload({
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

    const storageManager = this.resolveStorageManager();
    const context = this.getContext(contextInput, storageManager);
    const uploadResults: UploadResponse[] = [];

    try {
      for (const file of files) {
        const sizeError = validateFileSize(file.size, this.maxFileSize);
        if (sizeError) {
          throw new UploadError(sizeError.code, sizeError.message, {
            maxSize: this.maxFileSize,
            size: file.size,
            file: file.name,
          });
        }

        this.runTypeValidation({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
          context,
          phase: "upload",
        });

        await this.runBeforeUpload(file, context);

        const fileInfo = await storageManager.upload({
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
        if (storageManager.supportsPresignedUrls(context)) {
          try {
            downloadUrl =
              await storageManager.generatePresignedDownloadUrl({
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
    const storageManager = this.resolveStorageManager();
    const context = this.getContext(contextInput, storageManager);

    try {
      const fileBuffer = await storageManager.download({ key, context });
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
