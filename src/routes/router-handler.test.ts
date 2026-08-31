import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "../providers/local";
import { f } from "../router";
import { StorageManager } from "../storage-manager";
import { FileRouterHandler } from "./router-handler";

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
