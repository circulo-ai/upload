import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "../providers/local";
import { StorageManager } from "../storage-manager";
import { createNextFileHandler } from "./next";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createNextFileHandler", () => {
  it("serves files with safe private defaults and extension-based content types", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circulo-next-upload-"));
    temporaryDirectories.push(directory);
    const provider = new LocalStorageProvider({ basePath: directory });
    const uploaded = await provider.upload({
      file: Buffer.from("hello"),
      fileName: "greeting.txt",
      contentType: "text/plain",
    });
    const handler = createNextFileHandler({
      storageManager: new StorageManager({
        providers: { uploads: provider },
        defaultContext: "uploads",
      }),
    });

    const response = await handler(
      new Request("https://example.test/api/files/serve"),
      { params: { path: ["serve", ...uploaded.key.split("/")] } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="[^"]+-greeting\.txt";/,
    );
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(await response.text()).toBe("hello");
  });
});
