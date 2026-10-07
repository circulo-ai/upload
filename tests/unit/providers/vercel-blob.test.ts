import { afterEach, describe, expect, it, vi } from "vitest";
import { VercelBlobStorageProvider } from "../../../src/providers/vercel-blob";

vi.mock("@vercel/blob", () => ({
  head: vi.fn(async () => ({ url: "https://blob.example.test/file", size: 1 })),
}));
afterEach(() => vi.unstubAllGlobals());

describe("Vercel buffered download safety", () => {
  it("cancels an oversized body instead of buffering it before checking the limit", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body)),
    );
    await expect(
      new VercelBlobStorageProvider({ token: "test" }).download({
        key: "file",
        maxBytes: 2,
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported write guarantees rather than overwriting", async () => {
    await expect(
      new VercelBlobStorageProvider({ token: "test" }).upload({
        file: Buffer.from("test"),
        fileName: "file",
        contentType: "text/plain",
        writeMode: "create-only",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNSUPPORTED" });
  });
});
