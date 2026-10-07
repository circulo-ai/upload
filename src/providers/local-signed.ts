import { createHmac, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import type {
  PresignedDownloadUrlOptions,
  PresignedUploadUrlOptions,
  PresignedUrlResponse,
} from "../types/core";
import { MAX_FILE_SIZE } from "../types/core";
import { bufferStream } from "../utils/bounded-stream";
import { UploadError } from "../utils/errors";
import {
  assertByteSize,
  assertContentType,
  assertWriteMode,
} from "../utils/storage-validation";
import { LocalStorageProvider, type LocalStorageConfig } from "./local";

export interface SignedLocalStorageConfig extends LocalStorageConfig {
  /** Absolute HTTP(S) URL of your application server. */
  baseUrl: string;
  /** Dedicated signing secret containing at least 32 bytes of entropy. */
  signingSecret: string;
  uploadPath?: string;
  downloadPath?: string;
  maxUploadBytes?: number;
}

interface TransferClaims {
  version: 1;
  purpose: "upload" | "download";
  key: string;
  expiresAt: number;
  contentType?: string;
  size?: number;
}

/** Signed local transfers. Mount the returned URLs in your own authenticated application. */
export class SignedLocalStorageProvider extends LocalStorageProvider {
  private readonly signing: SignedLocalStorageConfig;

  constructor(config: SignedLocalStorageConfig) {
    super(config);
    const baseUrl = new URL(config.baseUrl);
    if (
      !["http:", "https:"].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new UploadError(
        "INVALID_INPUT",
        "baseUrl must be an HTTP(S) URL without credentials, query, or fragment",
      );
    }
    if (Buffer.byteLength(config.signingSecret) < 32)
      throw new UploadError(
        "INVALID_INPUT",
        "A signing secret of at least 32 bytes is required",
      );
    assertByteSize(config.maxUploadBytes ?? MAX_FILE_SIZE, "Upload limit");
    for (const path of [
      config.uploadPath ?? "/upload-local",
      config.downloadPath ?? "/download-local",
    ]) {
      if (
        !path.startsWith("/") ||
        path.startsWith("//") ||
        /[?#\\\r\n]/.test(path)
      )
        throw new UploadError(
          "INVALID_INPUT",
          "Transfer paths must be absolute application paths",
        );
    }
    this.signing = { ...config };
  }

  override supportsPresignedUrls(): boolean {
    return true;
  }

  override async generatePresignedUploadUrl(
    options: PresignedUploadUrlOptions,
  ): Promise<PresignedUrlResponse> {
    assertWriteMode(options.writeMode);
    assertByteSize(options.fileSize);
    assertContentType(options.contentType);
    if (options.fileSize > (this.signing.maxUploadBytes ?? MAX_FILE_SIZE))
      throw new UploadError(
        "FILE_TOO_LARGE",
        "File exceeds the configured upload limit",
        undefined,
        413,
      );
    if (options.writeMode === "overwrite")
      throw new UploadError(
        "INVALID_INPUT",
        "Signed local uploads require create-only writes",
      );
    const key = this.getFullKey(
      options.customKey ?? this.generateKey(options.fileName),
    );
    const url = this.transferUrl({
      version: 1,
      purpose: "upload",
      key,
      expiresAt: this.expiry(options.expirationSeconds),
      contentType: options.contentType,
      size: options.fileSize,
    });
    return { key, url, uploadHeaders: { "Content-Type": options.contentType } };
  }

  override async generatePresignedDownloadUrl(
    options: PresignedDownloadUrlOptions,
  ): Promise<string> {
    return this.transferUrl({
      version: 1,
      purpose: "download",
      key: this.getFullKey(options.key),
      expiresAt: this.expiry(options.expirationSeconds),
    });
  }

  async acceptSignedUpload(
    input: Readonly<{
      token: string;
      signature: string;
      contentType: string;
      body: Buffer | Readable;
    }>,
  ): Promise<void> {
    const claims = this.verify(input.token, input.signature, "upload");
    if (claims.contentType !== input.contentType || claims.size === undefined)
      throw new UploadError(
        "INVALID_INPUT",
        "Upload does not match the signed request",
      );
    const body = Buffer.isBuffer(input.body)
      ? input.body
      : await bufferStream(input.body, claims.size);
    if (body.length !== claims.size)
      throw new UploadError(
        "INVALID_INPUT",
        "Upload size does not match the signed request",
      );
    await this.upload({
      file: body,
      fileName: claims.key.split("/").at(-1) ?? "file",
      customKey: claims.key,
      contentType: input.contentType,
      writeMode: "create-only",
    });
  }

  async readSignedObject(
    input: Readonly<{ token: string; signature: string }>,
  ): Promise<Readonly<{ body: Buffer; contentType: string | null }>> {
    const claims = this.verify(input.token, input.signature, "download");
    const [body, metadata] = await Promise.all([
      this.download({ key: claims.key }),
      this.stat({ key: claims.key }),
    ]);
    return { body, contentType: metadata.contentType };
  }

  private expiry(expirationSeconds?: number): number {
    return (
      Math.floor(Date.now() / 1000) +
      this.normalizeExpirationSeconds(expirationSeconds)
    );
  }

  private digest(token: string): Buffer {
    return createHmac("sha256", this.signing.signingSecret)
      .update(token)
      .digest();
  }

  private transferUrl(claims: TransferClaims): string {
    const token = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const path =
      claims.purpose === "upload"
        ? (this.signing.uploadPath ?? "/upload-local")
        : (this.signing.downloadPath ?? "/download-local");
    const url = new URL(`${this.signing.baseUrl.replace(/\/$/, "")}${path}`);
    url.searchParams.set("token", token);
    url.searchParams.set("signature", this.digest(token).toString("hex"));
    return url.toString();
  }

  private verify(
    token: string,
    signature: string,
    purpose: TransferClaims["purpose"],
  ): TransferClaims {
    const invalid = () =>
      new UploadError(
        "UNAUTHORIZED",
        "Invalid or expired transfer signature",
        undefined,
        403,
      );
    if (
      typeof token !== "string" ||
      token.length > 4096 ||
      !/^[A-Za-z0-9_-]+$/.test(token) ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      throw invalid();
    if (!timingSafeEqual(this.digest(token), Buffer.from(signature, "hex")))
      throw invalid();
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    } catch {
      throw invalid();
    }
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      value.version !== 1 ||
      !("purpose" in value) ||
      value.purpose !== purpose ||
      !("key" in value) ||
      typeof value.key !== "string" ||
      !("expiresAt" in value) ||
      typeof value.expiresAt !== "number" ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= Math.floor(Date.now() / 1000)
    )
      throw invalid();
    this.getFullKey(value.key);
    if (purpose === "upload") {
      if (
        !("size" in value) ||
        typeof value.size !== "number" ||
        !("contentType" in value) ||
        typeof value.contentType !== "string"
      )
        throw invalid();
      assertByteSize(value.size);
      assertContentType(value.contentType);
      if (value.size > (this.signing.maxUploadBytes ?? MAX_FILE_SIZE))
        throw invalid();
    }
    return value as TransferClaims;
  }
}
