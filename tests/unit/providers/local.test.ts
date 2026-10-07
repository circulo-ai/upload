import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "../../../src/providers/local";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("LocalStorageProvider", () => {
  it("round-trips prefixed keys without duplicating the context prefix", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circulo-upload-"));
    temporaryDirectories.push(directory);
    const provider = new LocalStorageProvider({
      basePath: directory,
      pathPrefix: "chat",
    });

    const uploaded = await provider.upload({
      file: Buffer.from("hello"),
      fileName: "note.txt",
      contentType: "text/plain",
    });

    expect(uploaded.key.startsWith("chat/")).toBe(true);
    expect(await provider.download({ key: uploaded.key })).toEqual(
      Buffer.from("hello"),
    );
    expect(await readFile(join(directory, uploaded.key), "utf8")).toBe("hello");
  });

  it("rejects traversal keys instead of sanitizing them into a different file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circulo-upload-"));
    temporaryDirectories.push(directory);
    const provider = new LocalStorageProvider({ basePath: directory });

    await expect(
      provider.upload({
        file: Buffer.from("blocked"),
        fileName: "safe.txt",
        contentType: "text/plain",
        customKey: "../outside.txt",
      }),
    ).rejects.toThrow();
  });

  it("enforces an optional buffered download limit before reading", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circulo-upload-"));
    temporaryDirectories.push(directory);
    const provider = new LocalStorageProvider({ basePath: directory });
    const uploaded = await provider.upload({
      file: Buffer.from("too large"),
      fileName: "file.txt",
      contentType: "text/plain",
    });

    await expect(
      provider.download({ key: uploaded.key, maxBytes: 1 }),
    ).rejects.toThrow("download limit");
  });
});
