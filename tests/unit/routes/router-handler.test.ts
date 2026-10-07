import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStorageProvider } from "../../../src/providers/local";
import { f } from "../../../src/router";
import { FileRouterHandler } from "../../../src/routes/router-handler";
import { StorageManager } from "../../../src/storage-manager";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FileRouterHandler", () => {
  it("runs middleware and completion hooks around server uploads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circulo-router-"));
    temporaryDirectories.push(directory);
    const completed: Array<{ userId: string; key: string }> = [];
    const router = {
      imageUploader: f({ image: { maxFileSize: "4MB", maxFileCount: 1 } })
        .middleware(async ({ req }) => ({
          userId: req.headers.get("x-user-id") ?? "anonymous",
        }))
        .onUploadComplete(async ({ metadata, file }) => {
          completed.push({ userId: metadata.userId, key: file.key });
          return { indexed: true };
        }),
    };
    const storageManager = new StorageManager({
      providers: {
        uploads: new LocalStorageProvider({ basePath: directory }),
      },
      defaultContext: "uploads",
    });
    const handler = new FileRouterHandler({ storageManager, router });

    const result = await handler.handleUpload(
      "imageUploader",
      [
        {
          buffer: Buffer.from("image"),
          name: "avatar.png",
          size: 5,
          type: "image/png",
        },
      ],
      new Request("https://example.test/upload", {
        headers: { "x-user-id": "user-1" },
      }),
    );

    expect(result.files[0]?.serverData).toEqual({ indexed: true });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.userId).toBe("user-1");
  });

  it("enforces endpoint file size rules before storage is called", async () => {
    const router = {
      imageUploader: f({ image: { maxFileSize: "1B" } }),
    };
    const storageManager = new StorageManager({
      providers: {
        uploads: new LocalStorageProvider({ basePath: tmpdir() }),
      },
      defaultContext: "uploads",
    });
    const handler = new FileRouterHandler({ storageManager, router });

    await expect(
      handler.handlePresigned(
        "imageUploader",
        {
          fileName: "large.png",
          contentType: "image/png",
          fileSize: 2,
        },
        new Request("https://example.test/presigned"),
      ),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects files whose declared size does not match the received bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circulo-router-"));
    temporaryDirectories.push(directory);
    const storageManager = new StorageManager({
      providers: {
        uploads: new LocalStorageProvider({ basePath: directory }),
      },
      defaultContext: "uploads",
    });
    const handler = new FileRouterHandler({
      storageManager,
      router: { uploader: f({ any: { maxFileCount: 1 } }) },
    });

    await expect(
      handler.handleUpload(
        "uploader",
        [
          {
            buffer: Buffer.from("actual bytes"),
            name: "file.txt",
            size: 1,
            type: "text/plain",
          },
        ],
        new Request("https://example.test/upload"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_FILE" });
  });
});

describe("client completion trust boundary", () => {
  const file = {
    key: "forged",
    name: "file.txt",
    size: 5,
    type: "text/plain",
    path: "/forged",
    id: "untrusted",
    url: "/forged",
    uploadedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-02T00:00:00Z",
    context: "local",
  };
  it("rejects client completion without a verifier before calling business hooks", async () => {
    const complete = vi.fn();
    const storageManager = new StorageManager({
      providers: { local: new LocalStorageProvider({ basePath: "." }) },
      defaultContext: "local",
    });
    const handler = new FileRouterHandler({
      storageManager,
      router: { files: f({ maxFileCount: 1 }).onUploadComplete(complete) },
    });
    await expect(
      handler.handleComplete(
        "files",
        [file],
        new Request("https://example.test/complete"),
      ),
    ).rejects.toMatchObject({ status: 501 });
    expect(complete).not.toHaveBeenCalled();
  });
  it("passes only authoritative verified metadata to business hooks", async () => {
    const complete = vi.fn();
    const trusted = { ...file, key: "verified", path: "/verified" };
    const storageManager = new StorageManager({
      providers: { local: new LocalStorageProvider({ basePath: "." }) },
      defaultContext: "local",
    });
    const handler = new FileRouterHandler({
      storageManager,
      router: { files: f({ maxFileCount: 1 }).onUploadComplete(complete) },
      verifyUploadCompletion: async () => [trusted],
    });
    await handler.handleComplete(
      "files",
      [file],
      new Request("https://example.test/complete"),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ file: trusted }),
    );
  });
});
