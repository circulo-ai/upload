import { S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { S3StorageProvider } from "../../../src/providers/s3";

const providers: S3StorageProvider[] = [];
function provider(
  extra: Partial<ConstructorParameters<typeof S3StorageProvider>[0]> = {},
) {
  const storage = new S3StorageProvider({
    bucket: "media",
    region: "us-east-1",
    endpoint: "https://internal.example.test",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    ...extra,
  });
  providers.push(storage);
  return storage;
}
afterEach(() => {
  providers.splice(0).forEach((storage) => storage.close());
  vi.restoreAllMocks();
});

describe("S3 storage guarantees", () => {
  it("signs the exact key, MIME and create-only precondition using the public endpoint", async () => {
    const storage = provider({
      publicEndpoint: "https://public.example.test",
      serverSideEncryption: "AES256",
    });
    const result = await storage.generatePresignedUploadUrl({
      fileName: "image.png",
      customKey: "users/asset",
      contentType: "image/png",
      fileSize: 12,
      expirationSeconds: 60,
      writeMode: "create-only",
    });
    const url = new URL(result.url);
    expect(result.key).toBe("users/asset");
    expect(url.host).toBe("public.example.test");
    expect(url.pathname).toBe("/media/users/asset");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-type", "if-none-match"]),
    );
    expect(result.uploadHeaders).toMatchObject({
      "If-None-Match": "*",
      "Content-Type": "image/png",
      "x-amz-server-side-encryption": "AES256",
    });
  });

  it("does not duplicate key prefixes and rejects empty explicit keys", async () => {
    const storage = provider({ pathPrefix: "uploads" });
    const result = await storage.generatePresignedUploadUrl({
      fileName: "file",
      customKey: "uploads/exact",
      contentType: "text/plain",
      fileSize: 0,
    });
    expect(result.key).toBe("uploads/exact");
    await expect(
      storage.generatePresignedUploadUrl({
        fileName: "file",
        customKey: "",
        contentType: "text/plain",
        fileSize: 0,
      }),
    ).rejects.toThrow();
  });

  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid file sizes: %s",
    async (fileSize) => {
      await expect(
        provider().generatePresignedUploadUrl({
          fileName: "file",
          contentType: "text/plain",
          fileSize,
        }),
      ).rejects.toThrow();
    },
  );

  it("rejects header injection and invalid expirations", async () => {
    const storage = provider();
    await expect(
      storage.generatePresignedUploadUrl({
        fileName: "file",
        contentType: "text/plain\r\nX-Bad: true",
        fileSize: 1,
      }),
    ).rejects.toThrow();
    await expect(
      storage.generatePresignedDownloadUrl({
        key: "file",
        expirationSeconds: 604801,
      }),
    ).rejects.toThrow();
  });

  it("queries metadata and bounded ranges through the internal client", async () => {
    const storage = provider({ publicEndpoint: "https://public.example.test" });
    const send = vi.spyOn(S3Client.prototype, "send");
    send.mockResolvedValueOnce({
      ContentLength: 123,
      ContentType: "image/png",
      ETag: '"etag"',
    } as never);
    expect(await storage.stat({ key: "asset" })).toEqual({
      byteSize: 123,
      contentType: "image/png",
      etag: '"etag"',
    });
    send.mockResolvedValueOnce({
      Body: Readable.from([Buffer.from("prefix")]),
      ContentLength: 6,
    } as never);
    expect(
      await storage.download({
        key: "asset",
        range: { start: 0, end: 63 },
        maxBytes: 64,
      }),
    ).toEqual(Buffer.from("prefix"));
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      Key: "asset",
      Range: "bytes=0-63",
    });
  });

  it("destroys oversized streams even when metadata is absent", async () => {
    const body = Readable.from([Buffer.from("too large")]);
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: body,
    } as never);
    await expect(
      provider().download({ key: "asset", maxBytes: 2 }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(body.destroyed).toBe(true);
  });

  it("preserves stream failures", async () => {
    const cause = new Error("interrupted stream");
    const body = new Readable({
      read() {
        this.destroy(cause);
      },
    });
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: body,
    } as never);
    await expect(provider().download({ key: "asset" })).rejects.toBe(cause);
  });

  it("applies encryption, cache policy and conditional writes to trusted uploads", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValue({} as never);
    await provider({ serverSideEncryption: "AES256" }).upload({
      file: Buffer.from("ok"),
      fileName: "file",
      customKey: "exact",
      contentType: "text/plain",
      writeMode: "create-only",
      cacheControl: "public, max-age=60",
    });
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      IfNoneMatch: "*",
      ServerSideEncryption: "AES256",
      CacheControl: "public, max-age=60",
    });
  });

  it("rejects duplicate multipart parts before network I/O", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    await expect(
      provider().completeMultipartUpload({
        key: "file",
        uploadId: "id",
        parts: [
          { PartNumber: 1, ETag: "a" },
          { PartNumber: 1, ETag: "b" },
        ],
      }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("closes both clients once and rejects later operations", async () => {
    const storage = provider({ publicEndpoint: "https://public.example.test" });
    const destroy = vi.spyOn(S3Client.prototype, "destroy");
    storage.close();
    storage.close();
    expect(destroy).toHaveBeenCalledTimes(2);
    await expect(storage.stat({ key: "file" })).rejects.toMatchObject({
      code: "PROVIDER_CLOSED",
    });
  });
});
