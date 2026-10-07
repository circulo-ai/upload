import * as z from "zod";

/** Control-plane payloads only; bytes go directly to storage or an HTTP handler. */
export function createTRPCFileSchemas(maxFileCount = 100) {
  if (!Number.isSafeInteger(maxFileCount) || maxFileCount < 1) {
    throw new TypeError("maxFileCount must be a positive safe integer");
  }
  const key = z.string().min(1).max(1024);
  const context = z.string().min(1).max(256).optional();
  const endpoint = z.string().min(1).max(256);
  const file = z.object({
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    fileSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  });
  const session = z.object({
    key,
    context,
    uploadId: z.string().min(1).max(4096),
  });
  const partNumber = z.number().int().min(1).max(10_000);
  return {
    presigned: file.extend({
      endpoint,
      context,
      input: z.unknown().optional(),
    }),
    presignedBatch: z.object({
      endpoint,
      files: z.array(file).min(1).max(maxFileCount),
      context,
      input: z.unknown().optional(),
    }),
    complete: z.object({
      endpoint,
      input: z.unknown().optional(),
      files: z
        .array(
          z.object({
            key,
            path: z.string().max(4096),
            name: z.string().min(1).max(255),
            size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            type: z.string().min(1).max(255),
            url: z.string().max(8192),
            id: z.string().min(1).max(1024),
            uploadedAt: z.string().max(128),
            expiresAt: z.string().max(128),
            context: z.string().min(1).max(256),
            downloadUrl: z.string().max(8192).optional(),
          }),
        )
        .min(1)
        .max(maxFileCount),
    }),
    download: z.object({
      key,
      context,
      name: z.string().min(1).max(255).optional(),
    }),
    delete: z.object({ key, context }),
    multipartInitiate: file.extend({ endpoint, context }),
    multipartPartUrls: session.extend({
      partNumbers: z.array(partNumber).min(1).max(10_000),
    }),
    multipartComplete: session.extend({
      parts: z
        .array(
          z.union([
            z.object({
              PartNumber: partNumber,
              ETag: z.string().min(1).max(1024),
            }),
            z.object({ partNumber, blockId: z.string().min(1).max(1024) }),
          ]),
        )
        .min(1)
        .max(10_000),
    }),
    multipartAbort: session,
  };
}

export const trpcFileSchemas = createTRPCFileSchemas();
export type TRPCFileSchemas = ReturnType<typeof createTRPCFileSchemas>;
export type TRPCFileAction = keyof TRPCFileSchemas;
export type TRPCFileInput<TAction extends TRPCFileAction> = z.output<
  TRPCFileSchemas[TAction]
>;
