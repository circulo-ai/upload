import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3StorageProvider } from "../../src/providers/s3";

// Explicit opt-in: use a disposable local MinIO instance, never production credentials.
const endpoint = process.env.UPLOAD_S3_TEST_ENDPOINT;
describe.skipIf(!endpoint).sequential("S3 contract against MinIO", () => {
  const bucket = `upload-contract-${randomUUID()}`;
  const credentials = {
    accessKeyId: "upload-test",
    secretAccessKey: "upload-test-password",
  };
  const config = {
    endpoint,
    bucket,
    region: "us-east-1",
    credentials,
    forcePathStyle: true,
  };
  const client = new S3Client(config);
  const storage = new S3StorageProvider(config);
  const keys = new Set<string>();

  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  });
  afterAll(async () => {
    try {
      if (keys.size)
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: [...keys].map((Key) => ({ Key })) },
          }),
        );
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    } finally {
      storage.close();
      client.destroy();
    }
  });

  it("uploads through a real signed URL, verifies metadata, reads a range, and rejects replay", async () => {
    const key = "user/exact-key";
    keys.add(key);
    const upload = await storage.generatePresignedUploadUrl({
      customKey: key,
      fileName: "note.txt",
      contentType: "text/plain",
      fileSize: 11,
      expirationSeconds: 60,
      writeMode: "create-only",
    });
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.uploadHeaders,
      body: "hello world",
    });
    expect(response.status, await response.text()).toBe(200);
    expect(await storage.stat({ key })).toMatchObject({
      byteSize: 11,
      contentType: "text/plain",
    });
    expect(
      (
        await storage.download({
          key,
          range: { start: 0, end: 4 },
          maxBytes: 5,
        })
      ).toString(),
    ).toBe("hello");
    const replay = await fetch(upload.url, {
      method: "PUT",
      headers: upload.uploadHeaders,
      body: "changed!!!!",
    });
    expect(replay.status).toBe(412);
    expect((await storage.download({ key })).toString()).toBe("hello world");
    const read = await fetch(
      await storage.generatePresignedDownloadUrl({
        key,
        expirationSeconds: 60,
      }),
    );
    expect(await read.text()).toBe("hello world");
    const alteredType = await fetch(upload.url, {
      method: "PUT",
      headers: { ...upload.uploadHeaders, "Content-Type": "text/html" },
      body: "hello world",
    });
    expect(alteredType.status).toBe(403);
  });

  it("enforces create-only trusted uploads and supports metadata, delete, and bounded reads", async () => {
    const key = "trusted/file";
    keys.add(key);
    const input = {
      customKey: key,
      fileName: "file.txt",
      file: Buffer.from("trusted"),
      contentType: "text/plain",
      writeMode: "create-only" as const,
      cacheControl: "private, no-store",
    };
    await storage.upload(input);
    await expect(storage.upload(input)).rejects.toThrow();
    await expect(storage.download({ key, maxBytes: 1 })).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    await storage.delete({ key });
    await expect(storage.stat({ key })).rejects.toThrow();
  });

  it("completes a multipart upload using real signed part URLs", async () => {
    const upload = await storage.initiateMultipartUpload({
      fileName: "multipart.txt",
      contentType: "text/plain",
      fileSize: 9,
    });
    keys.add(upload.key);
    try {
      const urls = await storage.getMultipartPartUrls({
        ...upload,
        partNumbers: [1],
      });
      const partUrl = urls[0];
      if (!partUrl) throw new Error("Missing signed part URL");
      const response = await fetch(partUrl.url, {
        method: "PUT",
        body: "multipart",
      });
      expect(response.status, await response.text()).toBe(200);
      await storage.completeMultipartUpload({
        ...upload,
        parts: [{ PartNumber: 1, ETag: response.headers.get("etag") ?? "" }],
      });
      expect((await storage.download({ key: upload.key })).toString()).toBe(
        "multipart",
      );
    } catch (cause) {
      await storage.abortMultipartUpload(upload);
      throw cause;
    }
  });
});
