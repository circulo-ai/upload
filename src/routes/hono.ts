import { Hono, type Context, type Env, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { FileRouter } from "../router";
import { UploadError } from "../utils/errors";
import { getContentType } from "../utils/validation";
import {
  FileRouteHandler,
  type FileHandlerConfig,
  type UploadResponse,
} from "./handler";
import { FileRouterHandler } from "./router-handler";

export type { FileHandlerConfig } from "./handler";

export interface RouteConfig<E extends Env> {
  enabled?: boolean;
  middleware?: MiddlewareHandler<E>[];
}

export interface HonoFileRoutesOptions<E extends Env = Env> {
  /** Optional typed file router for endpoint-specific limits and lifecycle hooks. */
  router?: FileRouter;
  /** Query parameter used to select a file router endpoint. Defaults to endpoint. */
  endpointParam?: string;
  getUploadMetadata?: (
    c: Context<E>,
  ) => Promise<Record<string, string>> | Record<string, string>;

  routes?: {
    delete?: RouteConfig<E>;
    download?: RouteConfig<E>;
    presigned?: RouteConfig<E>;
    presignedBatch?: RouteConfig<E>;
    multipart?: RouteConfig<E>;
    complete?: RouteConfig<E>;
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

type RouteHandler<E extends Env> = (
  c: Context<E, string>,
  next: () => Promise<void>,
) => Response | Promise<Response | void> | void;

interface RouteRegistrar<E extends Env> {
  post(path: string, ...handlers: RouteHandler<E>[]): void;
  get(path: string, ...handlers: RouteHandler<E>[]): void;
}

export function createHonoFileRoutes<E extends Env = Env>(
  config: FileHandlerConfig,
  options: HonoFileRoutesOptions<E> = {},
) {
  const handler = new FileRouteHandler(config);
  const routerHandler = options.router
    ? new FileRouterHandler({ ...config, router: options.router })
    : undefined;
  const endpointParam = options.endpointParam ?? "endpoint";
  const router = new Hono<E>();
  const registrar = router as unknown as RouteRegistrar<E>;
  const post = (path: string, ...handlers: RouteHandler<E>[]): void => {
    registrar.post(path, ...handlers);
  };
  const get = (path: string, ...handlers: RouteHandler<E>[]): void => {
    registrar.get(path, ...handlers);
  };

  const getMetadata = async (c: Context<E>): Promise<Record<string, string>> =>
    options.getUploadMetadata ? await options.getUploadMetadata(c) : {};

  type RouteKey = keyof NonNullable<HonoFileRoutesOptions<E>["routes"]>;

  const isEnabled = (key: RouteKey): boolean =>
    options.routes?.[key]?.enabled !== false;

  const getMiddleware = (key: RouteKey): MiddlewareHandler<E>[] =>
    options.routes?.[key]?.middleware ?? [];

  const getRouterEndpoint = (c: Context<E>): string | undefined => {
    if (!routerHandler) return undefined;
    const endpoint = c.req.query(endpointParam);
    if (!endpoint) {
      throw new UploadError(
        "MISSING_ENDPOINT",
        `Query parameter '${endpointParam}' is required when a file router is configured`,
        { endpointParam },
        400,
      );
    }
    return endpoint;
  };

  const toStatus = (status?: number): ContentfulStatusCode =>
    Math.min(599, Math.max(200, status ?? 500)) as ContentfulStatusCode;

  // DELETE
  if (isEnabled("delete")) {
    post("/delete", ...getMiddleware("delete"), async (c) => {
      try {
        const body = await c.req.json<{ key: string; context?: string }>();
        const { key, context } = body;

        const result = await handler.handleDelete(key, context);
        return c.json(result);
      } catch (error) {
        if (error instanceof UploadError) {
          const status = toStatus(error.status);
          return c.json(
            { error: error.message, code: error.code, details: error.details },
            status,
          );
        }
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

    post("/download", ...getMiddleware("download"), async (c) => {
      try {
        const validated = downloadSchema.parse(await c.req.json());
        const { key, name, context } = validated;

        const result = await handler.handleDownload(key, name, context);
        return c.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({ error: z.treeifyError(error) }, 400);
        }
        if (error instanceof UploadError) {
          const status = toStatus(error.status);
          return c.json(
            { error: error.message, code: error.code, details: error.details },
            status,
          );
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
      input: z.unknown().optional(),
    });

    post("/presigned", ...getMiddleware("presigned"), async (c) => {
      try {
        const metadata = await getMetadata(c);
        const validated = presignedSchema.parse(await c.req.json());
        const { fileName, contentType, fileSize, input } = validated;

        const context =
          c.req.query("type") ?? c.req.query("context") ?? undefined;

        const endpoint = getRouterEndpoint(c);
        const result =
          routerHandler && endpoint
            ? await routerHandler.handlePresigned(
                endpoint,
                { fileName, contentType, fileSize, context, input },
                c.req.raw,
                metadata,
              )
            : await handler.handlePresigned(
                { fileName, contentType, fileSize, context },
                metadata,
              );
        return c.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({ error: z.treeifyError(error) }, 400);
        }
        if (error instanceof UploadError) {
          const status = toStatus(error.status);
          return c.json(
            { error: error.message, code: error.code, details: error.details },
            status,
          );
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
      input: z.unknown().optional(),
    });

    post("/presigned/batch", ...getMiddleware("presignedBatch"), async (c) => {
      try {
        const metadata = await getMetadata(c);
        const validated = batchSchema.parse(await c.req.json());
        const { files, input } = validated;

        const type = c.req.query("type") ?? undefined;

        const endpoint = getRouterEndpoint(c);
        const result =
          routerHandler && endpoint
            ? await routerHandler.handleBatchPresigned(
                endpoint,
                files,
                c.req.raw,
                type,
                metadata,
                input,
              )
            : await handler.handleBatchPresigned({ files, type }, metadata);
        return c.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({ error: z.treeifyError(error) }, 400);
        }
        if (error instanceof UploadError) {
          const status = toStatus(error.status);
          return c.json(
            {
              error: error.message,
              code: error.code,
              details: error.details,
            },
            status,
          );
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
    });
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

    post("/multipart", ...getMiddleware("multipart"), async (c) => {
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
            const endpoint = getRouterEndpoint(c);
            const result =
              routerHandler && endpoint
                ? await routerHandler.handleMultipartInitiate(
                    endpoint,
                    data,
                    c.req.raw,
                    metadata,
                  )
                : await handler.handleMultipart(action, data, metadata);
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
          return c.json({ error: z.treeifyError(error) }, 400);
        }
        if (error instanceof UploadError) {
          const status = toStatus(error.status);
          return c.json(
            { error: error.message, code: error.code, details: error.details },
            status,
          );
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
    post("/upload", ...getMiddleware("upload"), async (c) => {
      try {
        const metadata = await getMetadata(c);
        const formData = await c.req.parseBody({ all: true });
        const inputRaw = formData["input"];
        let routeInput: unknown;
        if (typeof inputRaw === "string" && inputRaw.length > 0) {
          routeInput = JSON.parse(inputRaw);
        }

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

        const endpoint = getRouterEndpoint(c);
        const result =
          routerHandler && endpoint
            ? await routerHandler.handleUpload(
                endpoint,
                validFiles,
                c.req.raw,
                context,
                routeInput,
                metadata,
              )
            : await handler.handleUpload(validFiles, context, metadata);
        return c.json(result);
      } catch (error) {
        if (error instanceof UploadError) {
          const status = toStatus(error.status);
          return c.json(
            { error: error.message, code: error.code, details: error.details },
            status,
          );
        }
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

  // ROUTER COMPLETION (used after a direct presigned upload)
  if (routerHandler && options.routes?.complete?.enabled !== false) {
    post("/complete", ...getMiddleware("complete"), async (c) => {
      try {
        const endpoint = c.req.query(endpointParam);
        if (!endpoint) {
          throw new UploadError(
            "MISSING_ENDPOINT",
            `Query parameter '${endpointParam}' is required`,
            { endpointParam },
            400,
          );
        }
        const body = (await c.req.json()) as {
          files?: UploadResponse[];
          input?: unknown;
        };
        return c.json(
          await routerHandler.handleComplete(
            endpoint,
            body.files ?? [],
            c.req.raw,
            body.input,
          ),
        );
      } catch (error) {
        if (error instanceof UploadError) {
          return c.json(
            { error: error.message, code: error.code, details: error.details },
            toStatus(error.status),
          );
        }
        return c.json(
          {
            error: error instanceof Error ? error.message : "Completion failed",
          },
          500,
        );
      }
    });
  }

  // SERVE
  if (isEnabled("serve")) {
    get("/serve/*", ...getMiddleware("serve"), async (c) => {
      try {
        // Always slice the path to avoid surprises with encoded slashes
        const path = c.req.path;
        const idx = path.indexOf("/serve/");
        const rawKey = idx >= 0 ? path.slice(idx + "/serve/".length) : "";
        const key = decodeURIComponent(rawKey);
        const context = c.req.query("context") ?? undefined;
        const method = c.req.method;

        if (method === "HEAD") {
          try {
            const downloadInfo = await handler.handleDownload(
              key,
              undefined,
              context,
            );

            if (downloadInfo.expiresIn !== null && downloadInfo.downloadUrl) {
              return new Response(null, {
                status: 307,
                headers: { Location: downloadInfo.downloadUrl },
              });
            }
          } catch {
            // Fall through to direct serve if presign fails
          }
        }

        const { fileBuffer, filename } = await handler.handleServe(
          key,
          context,
        );

        const contentType =
          getContentType(filename) ?? "application/octet-stream";

        return new Response(
          method === "HEAD" ? null : (fileBuffer as unknown as BodyInit),
          {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Disposition": `inline; filename="${filename}"`,
              "Cache-Control": "public, max-age=31536000",
              "X-Content-Type-Options": "nosniff",
              ...(method === "HEAD"
                ? { "Content-Length": fileBuffer.byteLength.toString() }
                : {}),
            },
          },
        );
      } catch (error) {
        if (error instanceof UploadError) {
          const status = toStatus(error.status);
          return c.json(
            { error: error.message, code: error.code, details: error.details },
            status,
          );
        }
        return c.json(
          { error: error instanceof Error ? error.message : "File not found" },
          404,
        );
      }
    });
  }

  return router;
}
