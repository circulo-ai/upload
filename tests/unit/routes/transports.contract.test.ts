import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStorageProvider } from "../../../src/providers/local";
import { f } from "../../../src/router";
import { createHonoFileRoutes } from "../../../src/routes/hono";
import { createNextFileHandler } from "../../../src/routes/next";
import { StorageManager } from "../../../src/storage-manager";
import type {
  FileHandlerConfig,
  UploadResponse,
} from "../../../src/types/routes";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const claim: UploadResponse = {
  id: "claim",
  name: "file.txt",
  size: 2,
            type: expect.stringMatching(/^text\/plain(?:;|$)/),
  key: "untrusted/key",
  path: "untrusted/key",
  url: "https://example.test/object",
  uploadedAt: "now",
  expiresAt: "later",
  context: "media",
};

describe.each(["hono", "next"] as const)(
  "%s transport contract",
  (transport) => {
    async function fixture(
      verify?: FileHandlerConfig["verifyUploadCompletion"],
    ) {
      const directory = await mkdtemp(join(tmpdir(), "upload-transport-"));
      directories.push(directory);
      const storage = new LocalStorageProvider({ basePath: directory });
      const completed = vi.fn(() => ({ recorded: true }));
      const router = {
        docs: f({ any: { maxFileSize: 10, maxFileCount: 1 } })
          .middleware(({ req }) => ({ userId: req.headers.get("x-user-id") }))
          .onUploadComplete(completed),
      };
      const config: FileHandlerConfig = {
        storageManager: new StorageManager({
          providers: { media: storage },
          defaultContext: "media",
        }),
        verifyUploadCompletion: verify,
      };
      const hono = createHonoFileRoutes(config, { router });
      const next = createNextFileHandler(config, { router });
      async function request(
        path: string,
        body: unknown,
        query = "endpoint=docs",
      ) {
        const req = new Request(`https://example.test/${path}?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-user-id": "owner" },
          body: JSON.stringify(body),
        });
        return transport === "hono"
          ? hono.fetch(req)
          : next(req, { params: { path: path.split("/") } });
      }
      return { storage, completed, hono, next, request };
    }

    it("enforces endpoint selection, schema validity and route limits", async () => {
      const { request } = await fixture();
      const input = {
        fileName: "file.txt",
        contentType: "text/plain",
        fileSize: 2,
      };
      expect((await request("presigned", input, "")).status).toBe(400);
      expect(
        (await request("presigned", input, "endpoint=missing")).status,
      ).toBe(404);
      expect(
        (await request("presigned", { ...input, fileSize: -1 })).status,
      ).toBe(400);
      expect(
        (await request("presigned", { ...input, fileSize: 11 })).status,
      ).toBe(400);
      const response = await request("presigned", input);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        directUploadSupported: false,
      });
    });

    it("blocks unverified completion without invoking callbacks", async () => {
      const { request, completed } = await fixture();
      expect((await request("complete", { files: [claim] })).status).toBe(501);
      expect(completed).not.toHaveBeenCalled();
    });

    it("passes the original request and only verified objects into completion", async () => {
      const verified = { ...claim, key: "verified/key" };
      const verifier = vi.fn(async () => [verified]);
      const { request, completed } = await fixture(verifier);
      const response = await request("complete", { files: [claim] });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        files: [{ key: "verified/key", serverData: { recorded: true } }],
      });
      expect(verifier).toHaveBeenCalledWith(
        expect.objectContaining({ req: expect.any(Request), endpoint: "docs" }),
      );
      expect(completed).toHaveBeenCalledWith({
        file: verified,
        metadata: { userId: "owner" },
      });
    });

    it("uploads multipart-form bytes and runs server completion with authenticated metadata", async () => {
      const { hono, next, completed } = await fixture();
      const form = new FormData();
      form.append("file", new File(["ok"], "file.txt", { type: "text/plain" }));
      const request = new Request("https://example.test/upload?endpoint=docs", {
        method: "POST",
        headers: { "x-user-id": "owner" },
        body: form,
      });
      const response = await (transport === "hono"
        ? hono.fetch(request)
        : next(request, { params: { path: ["upload"] } }));
      expect(response.status).toBe(200);
      expect(completed).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { userId: "owner" },
          file: expect.objectContaining({ size: 2, type: "text/plain" }),
        }),
      );
    });

    it("hides unknown provider failures from delete responses", async () => {
      const { request, storage } = await fixture();
      vi.spyOn(storage, "delete").mockRejectedValue(
        new Error("secret-provider-token"),
      );
      const response = await request("delete", { key: "valid/key" });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("secret-provider-token");
    });
  },
);
