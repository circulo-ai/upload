import type { ContainerClient } from "@azure/storage-blob";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureBlobStorageProvider } from "../../../src/providers/azure-blob";
import { optionalDependency } from "../../../src/utils/optional-dependency";
const { BlobServiceClient } = optionalDependency<
  typeof import("@azure/storage-blob")
>("@azure/storage-blob");

afterEach(() => vi.restoreAllMocks());
function fixture() {
  let metadata: Record<string, string> = {};
  const blob = {
    url: "https://account.blob.core.windows.net/media/file",
    upload: vi.fn(
      async (
        _body: Buffer,
        _size: number,
        options: { metadata: Record<string, string> },
      ) => {
        metadata = options.metadata;
      },
    ),
    getProperties: vi.fn(async () => ({
      etag: '"pending"',
      contentType: "text/plain",
      metadata,
    })),
    commitBlockList: vi.fn(async () => undefined),
    deleteIfExists: vi.fn(async () => undefined),
  };
  vi.spyOn(BlobServiceClient.prototype, "getContainerClient").mockReturnValue({
    getBlockBlobClient: () => blob,
  } as unknown as ContainerClient);
  const storage = new AzureBlobStorageProvider({
    containerName: "media",
    accountName: "account",
    accountKey: Buffer.alloc(32).toString("base64"),
  });
  return { storage, blob };
}

describe("Azure multipart session integrity", () => {
  it("creates a pending blob before staging and conditionally completes the same session", async () => {
    const { storage, blob } = fixture();
    const session = await storage.initiateMultipartUpload({
      fileName: "file.txt",
      contentType: "text/plain",
      fileSize: 5,
    });
    expect(blob.upload).toHaveBeenCalledWith(
      Buffer.alloc(0),
      0,
      expect.objectContaining({ conditions: { ifNoneMatch: "*" } }),
    );
    await storage.completeMultipartUpload({
      ...session,
      parts: [
        {
          partNumber: 1,
          blockId: Buffer.from("block-000001").toString("base64"),
        },
      ],
    });
    expect(blob.commitBlockList).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        conditions: { ifMatch: '"pending"' },
        blobHTTPHeaders: { blobContentType: "text/plain" },
      }),
    );
  });

  it("rejects a forged session before completion or abort", async () => {
    const { storage, blob } = fixture();
    const session = await storage.initiateMultipartUpload({
      fileName: "file.txt",
      contentType: "text/plain",
      fileSize: 5,
    });
    await expect(
      storage.abortMultipartUpload({ ...session, uploadId: "forged" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(blob.deleteIfExists).not.toHaveBeenCalled();
  });

  it("preserves abort failures instead of silently reporting success", async () => {
    const { storage, blob } = fixture();
    const session = await storage.initiateMultipartUpload({
      fileName: "file.txt",
      contentType: "text/plain",
      fileSize: 5,
    });
    const cause = new Error("storage unavailable");
    blob.deleteIfExists.mockRejectedValueOnce(cause);
    await expect(storage.abortMultipartUpload(session)).rejects.toBe(cause);
  });
});
