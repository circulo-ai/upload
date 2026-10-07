import {
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { dirname, join, resolve, sep } from "path";
import type {
  DeleteOptions,
  DownloadOptions,
  FileInfo,
  ObjectStatOptions,
  StoredObjectMetadata,
  UploadOptions,
} from "../types/core";
import { MAX_FILE_SIZE } from "../types/core";
import { bufferStream } from "../utils/bounded-stream";
import { UploadError } from "../utils/errors";
import {
  assertByteSize,
  assertContentType,
  assertWriteMode,
} from "../utils/storage-validation";
import { BaseStorageProvider } from "./base";

/**
 * Local file system storage configuration
 */
export interface LocalStorageConfig {
  /** Base directory for file storage */
  basePath: string;
  /** Maximum buffered download size; defaults to 100 MiB. */
  maxDownloadBytes?: number;
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
    if (!config.basePath.trim())
      throw new UploadError("INVALID_INPUT", "Local basePath is required");
    assertByteSize(config.maxDownloadBytes ?? MAX_FILE_SIZE, "Download limit");
    this.config = { ...config };

    // Resolve to absolute path
    this.fullBasePath = resolve(config.basePath);
  }

  /**
   * Get the full key including path prefix
   */
  protected getFullKey(key: string): string {
    const normalizedKey = this.normalizeKey(key);
    if (normalizedKey.split("/").includes(".circulo-upload"))
      throw new UploadError("INVALID_INPUT", "Reserved storage namespace");
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
    // Check the nearest existing ancestor BEFORE mkdir, which may follow links.
    let ancestor = dirPath;
    while (true) {
      try {
        await this.validateRealPath(ancestor);
        break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw cause;
        // A nonexistent configured root may have ancestors outside it.
        if (!ancestor.startsWith(this.fullBasePath)) break;
        ancestor = parent;
        if (!ancestor.startsWith(this.fullBasePath)) break;
      }
    }
    await mkdir(dirPath, { recursive: true });
    await this.validateRealPath(dirPath);
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

  override async upload(options: UploadOptions): Promise<FileInfo> {
    assertWriteMode(options.writeMode);
    assertContentType(options.contentType);
    const { file, fileName, contentType, preserveKey, customKey } = options;

    const key = this.getFullKey(
      customKey ?? this.generateKey(fileName, preserveKey),
    );

    const filePath = this.getFilePath(key);
    this.validatePath(filePath);

    // Ensure parent directory exists
    await this.ensureDirectory(dirname(filePath));
    await this.validateRealPath(dirname(filePath));

    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    let published = false;
    try {
      await writeFile(temporaryPath, file, { flag: "wx", mode: 0o600 });
      if (options.writeMode === "create-only") {
        // link is atomic and fails with EEXIST; rename would replace the target.
        await link(temporaryPath, filePath);
      } else {
        await rename(temporaryPath, filePath);
      }
      published = true;
      const metadataPath = this.metadataPath(key);
      await this.ensureDirectory(dirname(metadataPath));
      const temporaryMetadata = `${metadataPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryMetadata, JSON.stringify({ contentType }), {
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporaryMetadata, metadataPath);
      } finally {
        await unlink(temporaryMetadata).catch(
          (cause: NodeJS.ErrnoException) => {
            if (cause.code !== "ENOENT") throw cause;
          },
        );
      }
    } catch (cause) {
      if (published && options.writeMode === "create-only")
        await unlink(filePath);
      if ((cause as NodeJS.ErrnoException).code === "EEXIST")
        throw new UploadError(
          "ALREADY_EXISTS",
          "Object already exists",
          undefined,
          409,
          { cause },
        );
      throw cause;
    } finally {
      await unlink(temporaryPath).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== "ENOENT") throw cause;
      });
    }

    return {
      path: this.getServePath(key),
      key,
      name: fileName,
      size: file.length,
      type: contentType,
    };
  }

  private metadataPath(key: string): string {
    return join(
      this.fullBasePath,
      ".circulo-upload",
      `${createHash("sha256").update(key).digest("hex")}.json`,
    );
  }

  async stat(options: ObjectStatOptions): Promise<StoredObjectMetadata> {
    const key = this.getFullKey(options.key);
    const filePath = this.getFilePath(key);
    await this.validateRealPath(filePath);
    const info = await stat(filePath);
    let contentType: string | null = null;
    const metadataPath = this.metadataPath(key);
    try {
      await this.validateRealPath(metadataPath);
      const metadata: unknown = JSON.parse(
        await readFile(metadataPath, "utf8"),
      );
      if (
        typeof metadata === "object" &&
        metadata !== null &&
        "contentType" in metadata &&
        typeof metadata.contentType === "string"
      )
        contentType = metadata.contentType;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    return { byteSize: info.size, contentType, etag: null };
  }

  override async download(options: DownloadOptions): Promise<Buffer> {
    const filePath = this.getFilePath(this.getFullKey(options.key));
    this.validatePath(filePath);
    const limit =
      options.maxBytes ?? this.config.maxDownloadBytes ?? MAX_FILE_SIZE;
    assertByteSize(limit, "Download limit");
    if (options.range) {
      assertByteSize(options.range.start, "Range start");
      assertByteSize(options.range.end, "Range end");
      if (
        options.range.end < options.range.start ||
        options.range.end - options.range.start + 1 > limit
      )
        throw new UploadError(
          "INVALID_INPUT",
          "Invalid or oversized byte range",
        );
    }
    await this.validateRealPath(filePath);
    const handle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const info = await handle.stat();
      if (!info.isFile())
        throw new UploadError("INVALID_INPUT", "Object must be a regular file");
      if (!options.range && info.size > limit)
        throw new UploadError(
          "FILE_TOO_LARGE",
          "File exceeds the configured download limit",
          undefined,
          413,
        );
      return await bufferStream(
        handle.createReadStream({ autoClose: false, ...options.range }),
        limit,
      );
    } finally {
      await handle.close();
    }
  }

  override async delete(options: DeleteOptions): Promise<void> {
    const { key } = options;
    const fullKey = this.getFullKey(key);
    const filePath = this.getFilePath(fullKey);

    this.validatePath(filePath);

    try {
      await this.validateRealPath(filePath);
      await unlink(filePath);
      const metadataPath = this.metadataPath(fullKey);
      try {
        await this.validateRealPath(metadataPath);
        await unlink(metadataPath);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist, consider it deleted
        return;
      }
      throw error;
    }
  }

  override supportsPresignedUrls(): boolean {
    return false;
  }

  override supportsMultipartUpload(): boolean {
    return false;
  }
}
