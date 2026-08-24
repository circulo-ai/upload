import { Client, type AccessOptions } from "basic-ftp";
import { PassThrough, Readable, type Writable } from "node:stream";
import type {
  DeleteOptions,
  DownloadOptions,
  FileInfo,
  UploadOptions,
} from "../types/core";
import { BaseStorageProvider } from "./base";

/**
 * Connection options understood by the FTP adapter.
 *
 * The type intentionally mirrors the small part of basic-ftp's access
 * options that is useful to a storage provider, keeping the public provider
 * contract independent from the concrete FTP client implementation.
 */
export interface FtpAccessOptions {
  host: string;
  port?: number;
  user: string;
  password: string;
  secure?: boolean | "implicit";
  secureOptions?: AccessOptions["secureOptions"];
}

/**
 * Minimal FTP client port used by the provider adapter.
 *
 * Applications can inject an implementation for testing or to wrap another
 * FTP client without changing the storage provider API.
 */
export interface FtpClient {
  access(options: FtpAccessOptions): Promise<unknown>;
  ensureDir(remotePath: string): Promise<unknown>;
  uploadFrom(source: Readable, remotePath: string): Promise<unknown>;
  downloadTo(destination: Writable, remotePath: string): Promise<unknown>;
  remove(remotePath: string): Promise<unknown>;
  close(): void;
}

export interface FtpClientFactoryOptions {
  timeout: number;
  verbose: boolean;
}

/** Factory seam for the FTP client adapter. */
export type FtpClientFactory = (options: FtpClientFactoryOptions) => FtpClient;

/** FTP/FTPS storage configuration. */
export interface FtpConfig {
  /** FTP server hostname or IP address. */
  host: string;
  /** FTP server port. Defaults to 21. */
  port?: number;
  /** FTP username. Defaults to anonymous. */
  user?: string;
  /** FTP password. Defaults to guest. */
  password?: string;
  /** Enable explicit FTPS or use implicit FTPS. */
  secure?: boolean | "implicit";
  /** TLS options used when secure mode is enabled. */
  secureOptions?: AccessOptions["secureOptions"];
  /** Root directory used for all files stored by this provider. */
  rootDirectory?: string;
  /** Optional path prefix within the root directory. */
  pathPrefix?: string;
  /** Base URL used by FileInfo.path and server-side serve routes. */
  serveBaseUrl?: string;
  /** Connection timeout in milliseconds. Defaults to 30 seconds. */
  timeout?: number;
  /** Enable basic-ftp protocol logging. */
  verbose?: boolean;
  /** Injectable client factory for tests and custom FTP client adapters. */
  clientFactory?: FtpClientFactory;
}

const DEFAULT_TIMEOUT = 30_000;

function createBasicFtpClient({
  timeout,
  verbose,
}: FtpClientFactoryOptions): FtpClient {
  const client = new Client(timeout);
  client.ftp.verbose = verbose;

  return {
    access: (options) => client.access(options),
    ensureDir: (remotePath) => client.ensureDir(remotePath),
    uploadFrom: (source, remotePath) => client.uploadFrom(source, remotePath),
    downloadTo: (destination, remotePath) =>
      client.downloadTo(destination, remotePath),
    remove: (remotePath) => client.remove(remotePath),
    close: () => client.close(),
  };
}

function normalizeRemotePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  const isAbsolute = normalized.startsWith("/");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.some((segment) => segment === "..")) {
    throw new Error("FTP paths must not contain parent-directory segments");
  }

  const result = segments.filter((segment) => segment !== ".").join("/");
  return isAbsolute && result ? `/${result}` : result;
}

/**
 * FTP storage provider.
 *
 * This is an adapter around a small FTP client port. It deliberately exposes
 * the common storage operations only; FTP does not provide presigned URL or
 * cloud-style multipart semantics, so those capabilities remain disabled via
 * BaseStorageProvider.
 */
export class FtpStorageProvider extends BaseStorageProvider {
  private readonly config: FtpConfig;
  private readonly clientFactory: FtpClientFactory;

  constructor(config: FtpConfig) {
    super();
    if (!config.host.trim()) {
      throw new Error("FTP host is required");
    }

    this.config = config;
    this.clientFactory = config.clientFactory ?? createBasicFtpClient;
  }

  private getFullKey(key: string): string {
    const normalizedKey = normalizeRemotePath(key).replace(/^\/+/, "");
    const prefix = normalizeRemotePath(this.config.pathPrefix ?? "").replace(
      /^\/+|\/+$/g,
      "",
    );

    if (
      !prefix ||
      normalizedKey === prefix ||
      normalizedKey.startsWith(`${prefix}/`)
    ) {
      return normalizedKey;
    }

    return `${prefix}/${normalizedKey}`;
  }

  private getRemotePath(key: string): string {
    const root = normalizeRemotePath(this.config.rootDirectory ?? "");
    const fullKey = this.getFullKey(key);
    return normalizeRemotePath([root, fullKey].filter(Boolean).join("/"));
  }

  private getServePath(key: string): string {
    const baseUrl = this.config.serveBaseUrl || "/api/files/serve";
    return `${baseUrl}/${encodeURIComponent(key)}`;
  }

  private async withClient<T>(
    operation: (client: FtpClient) => Promise<T>,
  ): Promise<T> {
    const client = this.clientFactory({
      timeout: this.config.timeout ?? DEFAULT_TIMEOUT,
      verbose: this.config.verbose ?? false,
    });

    try {
      await client.access({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user ?? "anonymous",
        password: this.config.password ?? "guest",
        secure: this.config.secure,
        secureOptions: this.config.secureOptions,
      });
      return await operation(client);
    } finally {
      client.close();
    }
  }

  async upload(options: UploadOptions): Promise<FileInfo> {
    const { file, fileName, contentType, preserveKey, customKey } = options;
    const key = this.getFullKey(
      customKey || this.generateKey(fileName, preserveKey),
    );
    const remotePath = this.getRemotePath(key);

    await this.withClient(async (client) => {
      const directory = remotePath.slice(0, remotePath.lastIndexOf("/"));
      if (directory) {
        await client.ensureDir(directory);
      }
      await client.uploadFrom(Readable.from(file), remotePath);
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
    const remotePath = this.getRemotePath(options.key);
    const destination = new PassThrough();
    const chunks: Buffer[] = [];
    const downloadComplete = new Promise<Buffer>((resolve, reject) => {
      destination.on("data", (chunk: Buffer | Uint8Array | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      destination.once("end", () => resolve(Buffer.concat(chunks)));
      destination.once("error", reject);
    });

    try {
      await this.withClient(async (client) => {
        await client.downloadTo(destination, remotePath);
        destination.end();
      });
      return await downloadComplete;
    } catch (error) {
      destination.destroy(error as Error);
      throw error;
    }
  }

  async delete(options: DeleteOptions): Promise<void> {
    await this.withClient((client) =>
      client.remove(this.getRemotePath(options.key)).then(() => undefined),
    );
  }
}
