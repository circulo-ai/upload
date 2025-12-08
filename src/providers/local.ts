import { access, mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";
import type {
  DeleteOptions,
  DownloadOptions,
  FileInfo,
  UploadOptions,
} from "../types/core";
import { BaseStorageProvider } from "./base";

/**
 * Local file system storage configuration
 */
export interface LocalStorageConfig {
  /** Base directory for file storage */
  basePath: string;
  /** Optional path prefix within base directory */
  pathPrefix?: string;
  /** Base URL for serving files (e.g., '/api/files/serve') */
  serveBaseUrl?: string;
}

/**
 * Local file system storage provider
 */
export class LocalStorageProvider extends BaseStorageProvider {
  private config: LocalStorageConfig;
  private fullBasePath: string;

  constructor(config: LocalStorageConfig) {
    super();
    this.config = config;

    // Resolve to absolute path
    this.fullBasePath = resolve(config.basePath);

    // Ensure base directory exists
    this.ensureDirectory(this.fullBasePath).catch((error) => {
      console.error("Failed to create base directory:", error);
    });
  }

  /**
   * Get the full key including path prefix
   */
  private getFullKey(key: string): string {
    if (!this.config.pathPrefix) {
      return key;
    }
    const prefix = this.config.pathPrefix.replace(/\/$/, "");
    return `${prefix}/${key}`;
  }

  /**
   * Get absolute file path for a key
   */
  private getFilePath(key: string): string {
    const sanitizedKey = this.sanitizeKey(key);
    return join(this.fullBasePath, sanitizedKey);
  }

  /**
   * Sanitize key to prevent path traversal
   */
  private sanitizeKey(key: string): string {
    // Remove path traversal attempts
    const sanitized = key
      .replace(/\.\./g, "")
      .replace(/^\/+/, "")
      .replace(/[<>:"|?*\x00-\x1F]/g, "_");

    if (!sanitized || sanitized.trim().length === 0) {
      throw new Error("Invalid or empty key after sanitization");
    }

    return sanitized;
  }

  /**
   * Validate that a path is within the allowed base directory
   */
  private validatePath(filePath: string): void {
    const resolvedPath = resolve(filePath);

    if (
      !resolvedPath.startsWith(this.fullBasePath + sep) &&
      resolvedPath !== this.fullBasePath
    ) {
      throw new Error("Access denied: path outside allowed directory");
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await access(dirPath);
    } catch {
      await mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Get serve URL for a file
   */
  private getServePath(key: string): string {
    const baseUrl = this.config.serveBaseUrl || "/api/files/serve";
    return `${baseUrl}/${encodeURIComponent(key)}`;
  }

  async upload(options: UploadOptions): Promise<FileInfo> {
    const { file, fileName, contentType, preserveKey, customKey } = options;

    const key = this.getFullKey(
      customKey || this.generateKey(fileName, preserveKey),
    );

    const filePath = this.getFilePath(key);
    this.validatePath(filePath);

    // Ensure parent directory exists
    await this.ensureDirectory(dirname(filePath));

    // Write file
    await writeFile(filePath, file);

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
    const filePath = this.getFilePath(fullKey);

    this.validatePath(filePath);

    try {
      return await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`File not found: ${key}`);
      }
      throw error;
    }
  }

  async delete(options: DeleteOptions): Promise<void> {
    const { key } = options;
    const fullKey = this.getFullKey(key);
    const filePath = this.getFilePath(fullKey);

    this.validatePath(filePath);

    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist, consider it deleted
        return;
      }
      throw error;
    }
  }

  supportsPresignedUrls(): boolean {
    return false;
  }

  supportsMultipartUpload(): boolean {
    return false;
  }
}
