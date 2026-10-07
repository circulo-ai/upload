import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStorageProvider } from "../../../src/providers/local";
import { SignedLocalStorageProvider } from "../../../src/providers/local-signed";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "upload-production-"));
  directories.push(path);
  return path;
}
async function signedProvider() {
  return new SignedLocalStorageProvider({
    basePath: await directory(),
    baseUrl: "http://localhost:3000",
    signingSecret: "a".repeat(32),
  });
}
function credentials(url: string) {
  const parsed = new URL(url);
  return {
    token: parsed.searchParams.get("token") ?? "",
    signature: parsed.searchParams.get("signature") ?? "",
  };
}

describe("local create-only and signed transfers", () => {
  it("allows only one concurrent create-only upload and leaves no temporary files", async () => {
    const path = await directory();
    const storage = new LocalStorageProvider({ basePath: path });
    const results = await Promise.allSettled(
      ["one", "two"].map((text) =>
        storage.upload({
          file: Buffer.from(text),
          fileName: "file",
          customKey: "exact",
          contentType: "text/plain",
          writeMode: "create-only",
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "ALREADY_EXISTS" } });
    expect(["one", "two"]).toContain(
      (await storage.download({ key: "exact" })).toString(),
    );
    expect(await readdir(path)).toEqual(
      expect.arrayContaining(["exact", ".circulo-upload"]),
    );
    expect((await readdir(path)).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
    expect(await storage.stat({ key: "exact" })).toMatchObject({
      byteSize: 3,
      contentType: "text/plain",
    });
  });

  it("round-trips signed uploads and downloads and rejects replay", async () => {
    const storage = await signedProvider();
    const result = await storage.generatePresignedUploadUrl({
      fileName: "file",
      customKey: "exact",
      contentType: "text/plain",
      fileSize: 5,
    });
    const request = {
      ...credentials(result.url),
      contentType: "text/plain",
      body: Readable.from([Buffer.from("hello")]),
    };
    await storage.acceptSignedUpload(request);
    await expect(
      storage.acceptSignedUpload({ ...request, body: Buffer.from("hello") }),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
    const url = await storage.generatePresignedDownloadUrl({ key: result.key });
    expect(await storage.readSignedObject(credentials(url))).toEqual({
      body: Buffer.from("hello"),
      contentType: "text/plain",
    });
  });

  it("rejects altered claims, signatures, MIME, size and cross-purpose tokens", async () => {
    const storage = await signedProvider();
    const result = await storage.generatePresignedUploadUrl({
      fileName: "file",
      contentType: "text/plain",
      fileSize: 5,
    });
    const signed = credentials(result.url);
    await expect(
      storage.acceptSignedUpload({
        ...signed,
        contentType: "image/png",
        body: Buffer.from("hello"),
      }),
    ).rejects.toThrow();
    await expect(
      storage.acceptSignedUpload({
        ...signed,
        contentType: "text/plain",
        body: Buffer.from("short!"),
      }),
    ).rejects.toThrow();
    await expect(storage.readSignedObject(signed)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      storage.acceptSignedUpload({
        ...signed,
        token: signed.token + "x",
        contentType: "text/plain",
        body: Buffer.from("hello"),
      }),
    ).rejects.toThrow();
    await expect(
      storage.acceptSignedUpload({
        ...signed,
        signature: "0".repeat(64),
        contentType: "text/plain",
        body: Buffer.from("hello"),
      }),
    ).rejects.toThrow();
  });

  it("rejects expired signatures at the expiry boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const storage = await signedProvider();
    const result = await storage.generatePresignedUploadUrl({
      fileName: "file",
      contentType: "text/plain",
      fileSize: 1,
      expirationSeconds: 1,
    });
    vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
    await expect(
      storage.acceptSignedUpload({
        ...credentials(result.url),
        contentType: "text/plain",
        body: Buffer.from("a"),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("cancels oversized upload streams and persists no object", async () => {
    const storage = await signedProvider();
    const result = await storage.generatePresignedUploadUrl({
      fileName: "file",
      customKey: "exact",
      contentType: "text/plain",
      fileSize: 2,
    });
    const body = Readable.from([Buffer.from("oversized")]);
    await expect(
      storage.acceptSignedUpload({
        ...credentials(result.url),
        contentType: "text/plain",
        body,
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(body.destroyed).toBe(true);
    await expect(storage.stat({ key: "exact" })).rejects.toThrow();
  });

  it("enforces bounded local range reads and rejects reserved metadata keys", async () => {
    const storage = new LocalStorageProvider({ basePath: await directory() });
    await storage.upload({
      file: Buffer.from("abcdef"),
      fileName: "file",
      customKey: "exact",
      contentType: "text/plain",
    });
    expect(
      (
        await storage.download({
          key: "exact",
          range: { start: 1, end: 3 },
          maxBytes: 3,
        })
      ).toString(),
    ).toBe("bcd");
    await expect(
      storage.download({ key: "exact", maxBytes: NaN }),
    ).rejects.toThrow();
    await expect(
      storage.download({ key: ".circulo-upload/private.json" }),
    ).rejects.toThrow();
  });

  it("rejects directory symlink escapes before creating outside directories", async () => {
    const path = await directory();
    const outside = await directory();
    await symlink(
      outside,
      join(path, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const storage = new LocalStorageProvider({ basePath: path });
    await expect(
      storage.upload({
        file: Buffer.from("bad"),
        fileName: "file",
        customKey: "escape/nested/file",
        contentType: "text/plain",
      }),
    ).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
});
