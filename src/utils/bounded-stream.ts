import { Readable } from "node:stream";
import { UploadError } from "./errors";
import { assertByteSize } from "./storage-validation";

/** Buffer a stream with backpressure and stop consuming it as soon as the limit is exceeded. */
export async function bufferStream(
  stream: Readable,
  maxBytes: number,
): Promise<Buffer> {
  assertByteSize(maxBytes, "Download limit");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        throw new UploadError(
          "FILE_TOO_LARGE",
          "File exceeds the configured download limit",
          undefined,
          413,
        );
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, size);
  } finally {
    if (!stream.destroyed) stream.destroy();
  }
}
