import type { StorageManager, StorageManagerFactory } from "../storage-manager";
import { MAX_FILE_SIZE } from "../types/core";
import type {
  BatchPresignedRequest,
  BatchPresignedResponse,
  DeleteResponse,
  DownloadResponse,
  FileHandlerConfig,
  FileHandlerHooks,
  FileValidationInput,
  MultipartAbortData,
  MultipartCompleteData,
  MultipartGetPartUrlsData,
  MultipartInitiateData,
  MultipartResponse,
  PresignedRequest,
  PresignedResponse,
  ServeResponse,
  UploadFile,
  UploadResponse,
} from "../types/routes";
import { UploadError } from "../utils/errors";
import { sanitizeFilename } from "../utils/security";
import { validateFileSize } from "../utils/validation";

export type * from "../types/routes";

export class FileRouteHandler {
  private storageManager: StorageManager | StorageManagerFactory;
  private maxFileSize: number;
  private maxDownloadSize: number;
  private maxFileCount: number;
  private validateFileFn?: FileHandlerConfig["validateFile"];
  private serveUrlBuilder: (key: string, context: string) => string;
  private hooks?: FileHandlerHooks;

  constructor(config: FileHandlerConfig) {
    this.storageManager = config.storageManager;
    this.maxFileSize = config.maxFileSize ?? MAX_FILE_SIZE;
    if (!Number.isSafeInteger(this.maxFileSize) || this.maxFileSize <= 0) {
      throw new Error("maxFileSize must be a positive safe integer");
    }
    this.maxDownloadSize = config.maxDownloadSize ?? this.maxFileSize;
    if (
      !Number.isSafeInteger(this.maxDownloadSize) ||
      this.maxDownloadSize <= 0
    ) {
      throw new Error("maxDownloadSize must be a positive safe integer");
    }
    this.maxFileCount = config.maxFileCount ?? 100;
    if (!Number.isSafeInteger(this.maxFileCount) || this.maxFileCount <= 0) {
      throw new Error("maxFileCount must be a positive safe integer");
    }
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

  private validateFileInput(
    fileName: string,
    contentType: string,
    fileSize: number,
  ): void {
    if (
      typeof fileName !== "string" ||
      fileName.trim().length === 0 ||
      fileName.length > 1_024 ||
      /[\x00-\x1F\x7F]/.test(fileName)
    ) {
      throw new UploadError("INVALID_INPUT", "A valid file name is required");
    }
    if (
      typeof contentType !== "string" ||
      contentType.length === 0 ||
      contentType.length > 255 ||
      /[\r\n]/.test(contentType)
    ) {
      throw new UploadError(
        "INVALID_INPUT",
        "A valid content type is required",
      );
    }
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
      throw new UploadError(
        "INVALID_INPUT",
        "File size must be a positive safe integer",
      );
    }
  }

  private validatePartNumbers(partNumbers: number[]): void {
    if (
      partNumbers.length === 0 ||
      partNumbers.length > 10_000 ||
      partNumbers.some(
        (partNumber) =>
          !Number.isSafeInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > 10_000,
      ) ||
      new Set(partNumbers).size !== partNumbers.length
    ) {
      throw new UploadError(
        "INVALID_INPUT",
        "Multipart part numbers must be unique integers from 1 through 10000",
      );
    }
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
    if (!key) {
      throw new UploadError("MISSING_KEY", "File key is required");
    }
    const storageManager = this.resolveStorageManager();
    const context = this.getContext(contextInput, storageManager);
    const rawName = name || key.split("/").pop() || "download";
    const fileName = sanitizeFilename(rawName);

    try {
      if (storageManager.supportsPresignedUrls(context)) {
        const downloadUrl = await storageManager.generatePresignedDownloadUrl({
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
      const message = "Download failed";
      const internalMessage =
        error instanceof Error ? error.message.toLowerCase() : "";
      const status =
        internalMessage.includes("not found") ||
        internalMessage.includes("missing")
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
      this.validateFileInput(fileName, contentType, fileSize);
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
      if (!Array.isArray(files) || files.length === 0) {
        throw new UploadError("NO_FILES", "No files provided");
      }
      if (files.length > this.maxFileCount) {
        throw new UploadError(
          "TOO_MANY_FILES",
          `At most ${this.maxFileCount} files are allowed`,
        );
      }
      for (const file of files) {
        this.validateFileInput(file.fileName, file.contentType, file.fileSize);
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

          this.validateFileInput(fileName, contentType, fileSize);
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

          if (!uploadId || !key) {
            throw new UploadError(
              "INVALID_INPUT",
              "Multipart uploadId and key are required",
            );
          }
          this.validatePartNumbers(partNumbers);

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

          if (!uploadId || !key || parts.length === 0) {
            throw new UploadError(
              "INVALID_INPUT",
              "Multipart uploadId, key, and parts are required",
            );
          }
          const completePartNumbers = parts.map((part) =>
            "PartNumber" in part ? part.PartNumber : part.partNumber,
          );
          this.validatePartNumbers(completePartNumbers);

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

          if (!uploadId || !key) {
            throw new UploadError(
              "INVALID_INPUT",
              "Multipart uploadId and key are required",
            );
          }

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
      if (files.length > this.maxFileCount) {
        throw new UploadError(
          "TOO_MANY_FILES",
          `At most ${this.maxFileCount} files are allowed`,
        );
      }
      for (const file of files) {
        if (!Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length) {
          throw new UploadError(
            "INVALID_FILE",
            "File data is invalid or its declared size does not match its contents",
          );
        }
        this.validateFileInput(file.name, file.type, file.buffer.length);
        const sizeError = validateFileSize(
          file.buffer.length,
          this.maxFileSize,
        );
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
            downloadUrl = await storageManager.generatePresignedDownloadUrl({
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

      const firstResult = uploadResults[0];
      return uploadResults.length === 1 && firstResult
        ? firstResult
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
      const fileBuffer = await storageManager.download({
        key,
        context,
        maxBytes: this.maxDownloadSize,
      });
      const filename = sanitizeFilename(key.split("/").pop() || "download");

      return {
        fileBuffer,
        filename,
        context,
      };
    } catch (error) {
      const message = "File could not be served";
      const internalMessage =
        error instanceof Error ? error.message.toLowerCase() : "";
      const status =
        internalMessage.includes("not found") ||
        internalMessage.includes("missing")
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
