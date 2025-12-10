import { z } from "zod";
import { getContentType } from "../utils/validation";
import {
  FileRouteHandler,
  type FileHandlerConfig,
  type UploadFile,
} from "./handler";

type RouteKey =
  | "delete"
  | "download"
  | "presigned"
  | "presignedBatch"
  | "multipart"
  | "upload"
  | "serve";

export type NextRouteKey = RouteKey;

export interface NextRouteHandlerContext {
  params?: Record<string, string | string[]>;
}

export type NextRouteMiddleware<Req extends Request = Request> = (
  req: Req,
  context: NextRouteHandlerContext,
) => Promise<Response | void> | Response | void;

export interface NextRouteConfig<Req extends Request = Request> {
  enabled?: boolean;
  middleware?: NextRouteMiddleware<Req>[];
}

export interface NextFileRoutesOptions<Req extends Request = Request> {
  /**
   * Provide extra metadata for uploads and presigned URL generation.
   * Runs only for routes that upload/generate presigned URLs.
   */
  getUploadMetadata?: (
    req: Req,
  ) => Promise<Record<string, string>> | Record<string, string>;
  /**
   * Force a specific route when you use a dedicated file instead of a catch-all route.
   */
  defaultRoute?: RouteKey;
  /**
   * Catch-all param name to read from Next.js route context. Defaults to "path".
   */
  pathParam?: string;
  routes?: {
    delete?: NextRouteConfig<Req>;
    download?: NextRouteConfig<Req>;
    presigned?: NextRouteConfig<Req>;
    presignedBatch?: NextRouteConfig<Req>;
    multipart?: NextRouteConfig<Req>;
    upload?: NextRouteConfig<Req>;
    serve?: NextRouteConfig<Req>;
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

const deleteSchema = z.object({
  key: z.string(),
  context: z.string().optional(),
});

const downloadSchema = z.object({
  key: z.string(),
  name: z.string().optional(),
  context: z.string().optional(),
});

const presignedSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.number().positive(),
});

const batchFileSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.number().positive(),
});

const batchSchema = z.object({
  files: z.array(batchFileSchema).min(1).max(100),
});

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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
}

function methodNotAllowed(): Response {
  return json({ error: "Method not allowed" }, 405);
}

export function createNextFileHandler<Req extends Request = Request>(
  config: FileHandlerConfig,
  options: NextFileRoutesOptions<Req> = {},
): (req: Req, context?: NextRouteHandlerContext) => Promise<Response> {
  const handler = new FileRouteHandler(config);
  const pathParam = options.pathParam ?? "path";

  const getMetadata = async (req: Req): Promise<Record<string, string>> =>
    options.getUploadMetadata ? await options.getUploadMetadata(req) : {};

  const isEnabled = (key: RouteKey): boolean =>
    options.routes?.[key]?.enabled !== false;

  const getMiddleware = (key: RouteKey): NextRouteMiddleware<Req>[] =>
    options.routes?.[key]?.middleware ?? [];

  const resolveRoute = (
    context?: NextRouteHandlerContext,
  ): { route: RouteKey; rest: string[] } | null => {
    const params = context?.params ?? {};
    const values = Object.values(params) as Array<string | string[] | undefined>;
    const raw =
      (params[pathParam] as string[] | string | undefined) ??
      (values.find((value) => Array.isArray(value)) as string[] | undefined) ??
      (values[0] as string | undefined);

    const segments = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? [raw]
        : [];

    if (segments.length === 0) {
      return options.defaultRoute
        ? { route: options.defaultRoute, rest: [] }
        : null;
    }

    const [first, ...rest] = segments;
    switch (first) {
      case "delete":
        return { route: "delete", rest };
      case "download":
        return { route: "download", rest };
      case "presigned":
        if (rest[0] === "batch") {
          return { route: "presignedBatch", rest: rest.slice(1) };
        }
        return { route: "presigned", rest };
      case "multipart":
        return { route: "multipart", rest };
      case "upload":
        return { route: "upload", rest };
      case "serve":
        return { route: "serve", rest };
      default:
        return null;
    }
  };

  const runMiddleware = async (
    key: RouteKey,
    req: Req,
    ctx: NextRouteHandlerContext,
  ): Promise<Response | null> => {
    for (const mw of getMiddleware(key)) {
      const result = await mw(req, ctx);
      if (result instanceof Response) {
        return result;
      }
    }
    return null;
  };

  return async (
    req: Req,
    context: NextRouteHandlerContext = {},
  ): Promise<Response> => {
    const routeInfo = resolveRoute(context);
    if (!routeInfo) {
      return notFound();
    }

    if (!isEnabled(routeInfo.route)) {
      return notFound();
    }

    const middlewareResult = await runMiddleware(routeInfo.route, req, context);
    if (middlewareResult) {
      return middlewareResult;
    }

    const url = new URL(req.url);

    try {
      switch (routeInfo.route) {
        case "delete": {
          if (routeInfo.rest.length > 0) {
            return notFound();
          }
          if (req.method !== "POST") {
            return methodNotAllowed();
          }

          const { key, context: fileContext } = deleteSchema.parse(
            await req.json(),
          );
          const result = await handler.handleDelete(key, fileContext);
          return json(result);
        }

        case "download": {
          if (routeInfo.rest.length > 0) {
            return notFound();
          }
          if (req.method !== "POST") {
            return methodNotAllowed();
          }

          const { key, name, context: fileContext } = downloadSchema.parse(
            await req.json(),
          );
          const result = await handler.handleDownload(key, name, fileContext);
          return json(result);
        }

        case "presigned": {
          if (routeInfo.rest.length > 0) {
            return notFound();
          }
          if (req.method !== "POST") {
            return methodNotAllowed();
          }

          const metadata = await getMetadata(req);
          const { fileName, contentType, fileSize } = presignedSchema.parse(
            await req.json(),
          );
          const contextParam =
            url.searchParams.get("type") ??
            url.searchParams.get("context") ??
            undefined;

          const result = await handler.handlePresigned(
            {
              fileName,
              contentType,
              fileSize,
              context: contextParam ?? undefined,
            },
            metadata,
          );
          return json(result);
        }

        case "presignedBatch": {
          if (routeInfo.rest.length > 0) {
            return notFound();
          }
          if (req.method !== "POST") {
            return methodNotAllowed();
          }

          const metadata = await getMetadata(req);
          const { files } = batchSchema.parse(await req.json());
          const type = url.searchParams.get("type") ?? undefined;

          const result = await handler.handleBatchPresigned(
            { files, type },
            metadata,
          );
          return json(result);
        }

        case "multipart": {
          if (routeInfo.rest.length > 0) {
            return notFound();
          }
          if (req.method !== "POST") {
            return methodNotAllowed();
          }

          const metadata = await getMetadata(req);
          const action = multipartActionSchema.parse(
            url.searchParams.get("action"),
          );
          const raw = await req.json();

          switch (action) {
            case "initiate": {
              const data = multipartInitiateSchema.parse(raw);
              const result = await handler.handleMultipart(
                action,
                data,
                metadata,
              );
              return json(result);
            }
            case "get-part-urls": {
              const data = multipartGetPartUrlsSchema.parse(raw);
              const result = await handler.handleMultipart(
                action,
                data,
                metadata,
              );
              return json(result);
            }
            case "complete": {
              const data = multipartCompleteSchema.parse(raw);
              const result = await handler.handleMultipart(
                action,
                data,
                metadata,
              );
              return json(result);
            }
            case "abort": {
              const data = multipartAbortSchema.parse(raw);
              const result = await handler.handleMultipart(
                action,
                data,
                metadata,
              );
              return json(result);
            }
          }
        }

        case "upload": {
          if (routeInfo.rest.length > 0) {
            return notFound();
          }
          if (req.method !== "POST") {
            return methodNotAllowed();
          }

          const metadata = await getMetadata(req);
          const formData = await req.formData();

          const contextField = formData.get("context");
          const contextValue =
            typeof contextField === "string" && contextField.length > 0
              ? contextField
              : undefined;

          const fileEntries = formData.getAll("file");
          const validFiles: UploadFile[] = [];

          for (const entry of fileEntries) {
            if (isFileBlob(entry)) {
              validFiles.push({
                buffer: Buffer.from(await entry.arrayBuffer()),
                name: entry.name,
                type: entry.type,
                size: entry.size,
              });
            }
          }

          const result = await handler.handleUpload(
            validFiles,
            contextValue,
            metadata,
          );
          return json(result);
        }

        case "serve": {
          if (req.method !== "GET" && req.method !== "HEAD") {
            return methodNotAllowed();
          }

          const keyFromPath = routeInfo.rest.length
            ? routeInfo.rest
                .map((segment) => decodeURIComponent(segment))
                .join("/")
            : url.searchParams.get("key") ?? "";

          if (!keyFromPath) {
            return json({ error: "No file key provided" }, 400);
          }

          const contextParam =
            url.searchParams.get("context") ??
            url.searchParams.get("type") ??
            undefined;

          const { fileBuffer, filename } = await handler.handleServe(
            keyFromPath,
            contextParam ?? undefined,
          );

          const contentType =
            getContentType(filename) ?? "application/octet-stream";

          if (req.method === "HEAD") {
            return new Response(null, {
              status: 200,
              headers: {
                "Content-Length": fileBuffer.byteLength.toString(),
                "Content-Type": contentType,
                "Content-Disposition": `inline; filename="${filename}"`,
                "Cache-Control": "public, max-age=31536000",
                "X-Content-Type-Options": "nosniff",
              },
            });
          }

          return new Response(fileBuffer, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Disposition": `inline; filename="${filename}"`,
              "Cache-Control": "public, max-age=31536000",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }

        default:
          return notFound();
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ error: error.flatten() }, 400);
      }
      if (error instanceof Error && error.message === "Unauthorized") {
        return json({ error: "Unauthorized" }, 401);
      }

      const message =
        error instanceof Error ? error.message : "Internal server error";
      const status =
        routeInfo.route === "serve"
          ? 404
          : error instanceof Error &&
              (message.toLowerCase().includes("not found") ||
                message.toLowerCase().includes("missing"))
            ? 404
            : 500;

      return json({ error: message }, status);
    }
  };
}
