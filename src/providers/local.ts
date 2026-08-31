import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "fs/promises";
import { randomUUID } from "node:crypto";
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
  }

  /**
   * Get the full key including path prefix
   */
  private getFullKey(key: string): string {
    const normalizedKey = this.normalizeKey(key);
    if (!this.config.pathPrefix) {
      return normalizedKey;
    }
    const prefix = this.normalizeKey(this.config.pathPrefix.replace(/\/$/, ""));
    // StorageManager passes the provider's returned key back to download and
    // delete. Treat already-prefixed keys as canonical so context prefixes are
    // not duplicated (for example, `chat/chat/file.jpg`).
    if (normalizedKey === prefix || normalizedKey.startsWith(`${prefix}/`)) {
      return normalizedKey;
    }
    return this.normalizeKey(`${prefix}/${normalizedKey}`);
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
    return this.normalizeKey(key);
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

  private async validateRealPath(filePath: string): Promise<void> {
    const resolvedPath = await realpath(filePath);
    this.validatePath(resolvedPath);
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
    await this.validateRealPath(dirname(filePath));

    // Write to a unique private temporary file and atomically rename it. This
    // prevents partial files from being served after interrupted writes.
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, file, { flag: "wx", mode: 0o600 });
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

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
      await this.validateRealPath(filePath);
      if (options.maxBytes !== undefined) {
        const fileStats = await stat(filePath);
        if (fileStats.size > options.maxBytes) {
          throw new Error("File exceeds the configured download limit");
        }
      }
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
      await this.validateRealPath(filePath);
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
