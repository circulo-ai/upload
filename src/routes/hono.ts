import { Hono, type Context, type Env, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { FileRouteHandler, type FileHandlerConfig } from "./handler";
import { getContentType } from "../utils/validation";

export type { FileHandlerConfig } from "./handler";

export interface RouteConfig<E extends Env> {
  enabled?: boolean;
  middleware?: MiddlewareHandler<E>[];
}

export interface HonoFileRoutesOptions<E extends Env = Env> {
  getUploadMetadata?: (
    c: Context<E>,
  ) => Promise<Record<string, string>> | Record<string, string>;

  routes?: {
    delete?: RouteConfig<E>;
    download?: RouteConfig<E>;
    presigned?: RouteConfig<E>;
    presignedBatch?: RouteConfig<E>;
    multipart?: RouteConfig<E>;
    upload?: RouteConfig<E>;
    serve?: RouteConfig<E>;
  };
}

interface FileBlob {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  type: string;
  size: number;
}

function isFileBlob(value: unknown): value is FileBlob {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as FileBlob).arrayBuffer === "function" &&
    "name" in value &&
    "type" in value &&
    "size" in value
  );
}

type UploadFile = {
  buffer: Buffer;
  name: string;
  type: string;
  size: number;
};

export function createHonoFileRoutes<E extends Env = Env>(
  config: FileHandlerConfig,
  options: HonoFileRoutesOptions<E> = {},
) {
  const handler = new FileRouteHandler(config);
  const router = new Hono<E>();

  const getMetadata = async (c: Context<E>): Promise<Record<string, string>> =>
    options.getUploadMetadata ? await options.getUploadMetadata(c) : {};

  type RouteKey = keyof NonNullable<HonoFileRoutesOptions<E>["routes"]>;

  const isEnabled = (key: RouteKey): boolean =>
    options.routes?.[key]?.enabled !== false;

  const getMiddleware = (key: RouteKey): MiddlewareHandler<E>[] =>
    options.routes?.[key]?.middleware ?? [];

  // DELETE
  if (isEnabled("delete")) {
    router.post("/delete", ...getMiddleware("delete"), async (c) => {
      try {
        const body = await c.req.json<{ key: string; context?: string }>();
        const { key, context } = body;

        const result = await handler.handleDelete(key, context);
        return c.json(result);
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : "Delete failed" },
          500,
        );
      }
    });
  }

  // DOWNLOAD (manual zod parse -> no valid("json") bug)
  if (isEnabled("download")) {
    const downloadSchema = z.object({
      key: z.string(),
      name: z.string().optional(),
      context: z.string().optional(),
    });

    router.post("/download", ...getMiddleware("download"), async (c) => {
      try {
        const validated = downloadSchema.parse(await c.req.json());
        const { key, name, context } = validated;

        const result = await handler.handleDownload(key, name, context);
        return c.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({ error: error.flatten() }, 400);
        }
        return c.json(
          {
            error: error instanceof Error ? error.message : "Download failed",
          },
          500,
        );
      }
    });
  }

  // PRESIGNED SINGLE
  if (isEnabled("presigned")) {
    const presignedSchema = z.object({
      fileName: z.string().min(1),
      contentType: z.string().min(1),
      fileSize: z.number().positive(),
    });

    router.post("/presigned", ...getMiddleware("presigned"), async (c) => {
      try {
        const metadata = await getMetadata(c);
        const validated = presignedSchema.parse(await c.req.json());
        const { fileName, contentType, fileSize } = validated;

        const context =
          c.req.query("type") ?? c.req.query("context") ?? undefined;

        const result = await handler.handlePresigned(
          { fileName, contentType, fileSize, context },
          metadata,
        );
        return c.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({ error: error.flatten() }, 400);
        }
        if (error instanceof Error && error.message === "Unauthorized") {
          return c.json({ error: "Unauthorized" }, 401);
        }
        return c.json(
          {
            error:
              error instanceof Error ? error.message : "Failed to generate URL",
          },
          500,
        );
      }
    });
  }

  // PRESIGNED BATCH
  if (isEnabled("presignedBatch")) {
    const batchFileSchema = z.object({
      fileName: z.string().min(1),
      contentType: z.string().min(1),
      fileSize: z.number().positive(),
    });

    const batchSchema = z.object({
      files: z.array(batchFileSchema).min(1).max(100),
    });

    router.post(
      "/presigned/batch",
      ...getMiddleware("presignedBatch"),
      async (c) => {
        try {
          const metadata = await getMetadata(c);
          const validated = batchSchema.parse(await c.req.json());
          const { files } = validated;

          const type = c.req.query("type") ?? undefined;

          const result = await handler.handleBatchPresigned(
            { files, type },
            metadata,
          );
          return c.json(result);
        } catch (error) {
          if (error instanceof z.ZodError) {
            return c.json({ error: error.flatten() }, 400);
          }
          if (error instanceof Error && error.message === "Unauthorized") {
            return c.json({ error: "Unauthorized" }, 401);
          }
          return c.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to generate batch URLs",
            },
            500,
          );
        }
      },
    );
  }

  // MULTIPART
  if (isEnabled("multipart")) {
    // schemas that match your handler types exactly
    const multipartInitiateSchema = z.object({
      fileName: z.string().min(1),
      contentType: z.string().min(1),
      fileSize: z.number().positive(),
      context: z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    });

    const multipartGetPartUrlsSchema = z.object({
      uploadId: z.string().min(1),
      key: z.string().min(1),
      partNumbers: z.array(z.number().int().positive()).min(1),
      context: z.string().optional(),
    });

    const partsSchema = z
      .array(
        z.union([
          z.object({
            PartNumber: z.number().int().positive(),
            ETag: z.string().min(1),
          }),
          z.object({
            blockId: z.string().min(1),
            partNumber: z.number().int().positive(),
          }),
        ]),
      )
      .min(1);

    const multipartCompleteSchema = z.object({
      uploadId: z.string().min(1),
      key: z.string().min(1),
      parts: partsSchema,
      context: z.string().optional(),
    });

    const multipartAbortSchema = z.object({
      uploadId: z.string().min(1),
      key: z.string().min(1),
      context: z.string().optional(),
    });

    const multipartActionSchema = z.enum([
      "initiate",
      "get-part-urls",
      "complete",
      "abort",
    ]);
    type MultipartAction = z.infer<typeof multipartActionSchema>;

    router.post("/multipart", ...getMiddleware("multipart"), async (c) => {
      try {
        const metadata = await getMetadata(c);

        // Parse & narrow action to the literal union (never undefined)
        const action: MultipartAction = multipartActionSchema.parse(
          c.req.query("action"),
        );

        const raw = await c.req.json();

        switch (action) {
          case "initiate": {
            const data = multipartInitiateSchema.parse(raw);
            const result = await handler.handleMultipart(
              action,
              data,
              metadata,
            );
            return c.json(result);
          }

          case "get-part-urls": {
            const data = multipartGetPartUrlsSchema.parse(raw);
            const result = await handler.handleMultipart(
              action,
              data,
              metadata,
            );
            return c.json(result);
          }

          case "complete": {
            const data = multipartCompleteSchema.parse(raw);
            const result = await handler.handleMultipart(
              action,
              data,
              metadata,
            );
            return c.json(result);
          }

          case "abort": {
            const data = multipartAbortSchema.parse(raw);
            const result = await handler.handleMultipart(
              action,
              data,
              metadata,
            );
            return c.json(result);
          }
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({ error: error.flatten() }, 400);
        }
        if (error instanceof Error && error.message === "Unauthorized") {
          return c.json({ error: "Unauthorized" }, 401);
        }
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Multipart operation failed",
          },
          500,
        );
      }
    });
  }

  // UPLOAD
  if (isEnabled("upload")) {
    router.post("/upload", ...getMiddleware("upload"), async (c) => {
      try {
        const metadata = await getMetadata(c);
        const formData = await c.req.parseBody({ all: true });

        const contextRaw = formData["context"];
        const context = typeof contextRaw === "string" ? contextRaw : undefined;

        const filesInput = formData["file"];
        const filesArray = Array.isArray(filesInput)
          ? filesInput
          : filesInput
            ? [filesInput]
            : [];

        const validFiles: UploadFile[] = [];

        for (const f of filesArray) {
          if (isFileBlob(f)) {
            validFiles.push({
              buffer: Buffer.from(await f.arrayBuffer()),
              name: f.name,
              type: f.type,
              size: f.size,
            });
          }
        }

        const result = await handler.handleUpload(
          validFiles,
          context,
          metadata,
        );
        return c.json(result);
      } catch (error) {
        if (error instanceof Error && error.message === "Unauthorized") {
          return c.json({ error: "Unauthorized" }, 401);
        }
        return c.json(
          { error: error instanceof Error ? error.message : "Upload failed" },
          500,
        );
      }
    });
  }

  // SERVE
  if (isEnabled("serve")) {
    router.get("/serve/*", ...getMiddleware("serve"), async (c) => {
      try {
        const wildcard = c.req.param("*");
        const key = decodeURIComponent(wildcard ?? "");
        const context = c.req.query("context") ?? undefined;

        const { fileBuffer, filename } = await handler.handleServe(
          key,
          context,
        );

        const contentType =
          getContentType(filename) ?? "application/octet-stream";

        return new Response(fileBuffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="${filename}"`,
            "Cache-Control": "public, max-age=31536000",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : "File not found" },
          404,
        );
      }
    });
  }

  return router;
}
