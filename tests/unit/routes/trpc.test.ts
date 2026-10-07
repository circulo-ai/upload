import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "../../../src/providers/contracts";
import { f } from "../../../src/router";
import {
  createTRPCFileHandlers,
  toTRPCUploadError,
} from "../../../src/routes/trpc";
import { StorageManager } from "../../../src/storage-manager";
import type {
  FileHandlerConfig,
  UploadResponse,
} from "../../../src/types/routes";

interface Context {
  req: Request;
  userId: string | null;
}
const t = initTRPC.context<Context>().create();
const file: UploadResponse = {
  id: "id",
  key: "owner/key",
  path: "owner/key",
  url: "https://example.test/file",
  name: "file.txt",
  size: 2,
  type: "text/plain",
  uploadedAt: "now",
  expiresAt: "later",
  context: "media",
};

function fixture(verify?: FileHandlerConfig["verifyUploadCompletion"]) {
  const storage: StorageProvider = {
    upload: vi.fn(),
    download: vi.fn(),
    delete: vi.fn(),
    supportsPresignedUrls: () => true,
    supportsMultipartUpload: () => true,
    generatePresignedUploadUrl: vi.fn(async () => ({
      url: "https://example.test/put",
      key: "owner/key",
      expiresIn: 60,
      uploadHeaders: { "If-None-Match": "*" },
    })),
    generatePresignedDownloadUrl: vi.fn(async () => "https://example.test/get"),
    initiateMultipartUpload: vi.fn(async () => ({
      uploadId: "session",
      key: "owner/key",
    })),
    getMultipartPartUrls: vi.fn(async () => []),
    completeMultipartUpload: vi.fn(async () => ({
      key: "owner/key",
      location: "https://example.test/file",
      path: "owner/key",
    })),
    abortMultipartUpload: vi.fn(),
  };
  const completed = vi.fn(() => ({ persisted: true }));
  const authorize = vi.fn(({ ctx }: { ctx: Context }) => {
    if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  });
  const handlers = createTRPCFileHandlers<Context>({
    storageManager: new StorageManager({
      providers: { media: storage },
      defaultContext: "media",
    }),
    router: {
      docs: f({ any: { maxFileSize: 10, maxFileCount: 2 } }).onUploadComplete(
        completed,
      ),
    },
    getRequest: (ctx) => ctx.req,
    authorize,
    verifyUploadCompletion: verify,
  });
  const router = t.router({
    presigned: t.procedure
      .input(handlers.schemas.presigned)
      .mutation(handlers.presigned),
    presignedBatch: t.procedure
      .input(handlers.schemas.presignedBatch)
      .mutation(handlers.presignedBatch),
    complete: t.procedure
      .input(handlers.schemas.complete)
      .mutation(handlers.complete),
    delete: t.procedure
      .input(handlers.schemas.delete)
      .mutation(handlers.delete),
    download: t.procedure
      .input(handlers.schemas.download)
      .query(handlers.download),
    multipartInitiate: t.procedure
      .input(handlers.schemas.multipartInitiate)
      .mutation(handlers.multipartInitiate),
    multipartPartUrls: t.procedure
      .input(handlers.schemas.multipartPartUrls)
      .mutation(handlers.multipartPartUrls),
    multipartComplete: t.procedure
      .input(handlers.schemas.multipartComplete)
      .mutation(handlers.multipartComplete),
    multipartAbort: t.procedure
      .input(handlers.schemas.multipartAbort)
      .mutation(handlers.multipartAbort),
  });
  const caller = (userId: string | null = "owner") =>
    router.createCaller({
      req: new Request("https://example.test/trpc"),
      userId,
    });
  return { storage, completed, authorize, caller };
}

describe("tRPC upload adapter", () => {
  it("composes typed resolvers into real tRPC callers and preserves signed headers", async () => {
    const { caller, authorize } = fixture();
    const result = await caller().presigned({
      endpoint: "docs",
      fileName: "file.txt",
      contentType: "text/plain",
      fileSize: 2,
    });
    expect(result.uploadHeaders).toEqual({ "If-None-Match": "*" });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "presigned" }),
    );
  });
  it("rejects unauthenticated object operations before touching storage", async () => {
    const { caller, storage } = fixture();
    await expect(
      caller(null).delete({ key: "owner/key" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(storage.delete).not.toHaveBeenCalled();
  });
  it("validates transport input and endpoint policy before presigning", async () => {
    const { caller, storage } = fixture();
    await expect(
      caller().presigned({
        endpoint: "docs",
        fileName: "file.txt",
        contentType: "text/plain",
        fileSize: -1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().presigned({
        endpoint: "docs",
        fileName: "file.txt",
        contentType: "text/plain",
        fileSize: 11,
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(storage.generatePresignedUploadUrl).not.toHaveBeenCalled();
  });
  it("requires completion verification and invokes business callbacks only with verified DTOs", async () => {
    const missing = fixture();
    await expect(
      missing.caller().complete({ endpoint: "docs", files: [file] }),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    expect(missing.completed).not.toHaveBeenCalled();
    const verified = { ...file, key: "verified/key" };
    const { caller, completed } = fixture(async () => [verified]);
    const result = await caller().complete({ endpoint: "docs", files: [file] });
    expect(result.files[0]?.key).toBe("verified/key");
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({ file: verified }),
    );
  });
  it("routes multipart lifecycle and read operations through authorization", async () => {
    const { caller, authorize } = fixture();
    const api = caller();
    await api.multipartInitiate({
      endpoint: "docs",
      fileName: "file.txt",
      contentType: "text/plain",
      fileSize: 2,
    });
    const session = { key: "owner/key", uploadId: "session" };
    await api.multipartPartUrls({ ...session, partNumbers: [1] });
    await api.multipartComplete({
      ...session,
      parts: [{ PartNumber: 1, ETag: "etag" }],
    });
    await api.multipartAbort(session);
    await api.download({ key: "owner/key" });
    expect(authorize).toHaveBeenCalledTimes(5);
  });
  it("hides provider errors while preserving their cause", () => {
    const cause = new Error("secret-provider-url-and-token");
    expect(toTRPCUploadError(cause)).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Upload operation failed",
      cause,
    });
  });
});
