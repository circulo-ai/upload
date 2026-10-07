import {
  getFileRouteRule,
  parseFileSize,
  type FileRouteCompleteContext,
  type FileRouteDefinition,
  type FileRouteFile,
  type FileRouter,
} from "../router";
import { UploadError } from "../utils/errors";
import { validateFileSize } from "../utils/validation";
import type {
  FileHandlerConfig,
  MultipartInitiateData,
  PresignedRequest,
  UploadFile,
  UploadResponse,
} from "./handler";
import { FileRouteHandler } from "./handler";

export interface FileRouterHandlerConfig<
  TRouter extends FileRouter,
> extends FileHandlerConfig {
  router: TRouter;
}

export interface FileRouterCompletionFile extends UploadResponse {
  serverData?: unknown;
}

export interface FileRouterCompletionResponse {
  files: FileRouterCompletionFile[];
}

function asRouteFile(file: UploadFile | UploadResponse): FileRouteFile {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    ...("key" in file ? { key: file.key } : {}),
  };
}

function asMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => typeof item === "string" && item.length > 0,
    ) as Array<[string, string]>,
  );
}

export class FileRouterHandler<TRouter extends FileRouter> {
  private readonly router: TRouter;
  private readonly handler: FileRouteHandler;
  private readonly verifyUploadCompletion: FileHandlerConfig["verifyUploadCompletion"];

  constructor(config: FileRouterHandlerConfig<TRouter>) {
    this.router = config.router;
    this.handler = new FileRouteHandler(config);
    this.verifyUploadCompletion = config.verifyUploadCompletion;
  }

  getRoute(endpoint: string): FileRouteDefinition {
    const route = this.router[endpoint];
    if (!Object.hasOwn(this.router, endpoint) || !route) {
      throw new UploadError(
        "UNKNOWN_ENDPOINT",
        `Upload endpoint '${endpoint}' is not configured`,
        { endpoint },
        404,
      );
    }
    // The route builder associates parsed input and middleware metadata with its handlers.
    return route as FileRouteDefinition;
  }

  private async prepare<TInput>(
    route: FileRouteDefinition,
    req: Request,
    input: TInput,
    files: readonly FileRouteFile[],
  ): Promise<unknown> {
    if (route.inputParser) {
      input = (await route.inputParser(input)) as TInput;
    }
    if (!route.middlewareHandler) return undefined;
    return route.middlewareHandler({ req, input, files });
  }

  private validateRouteFiles(
    route: FileRouteDefinition,
    files: readonly FileRouteFile[],
  ): void {
    const maxFileCount = route.config.maxFileCount;
    if (maxFileCount !== undefined && files.length > maxFileCount) {
      throw new UploadError(
        "TOO_MANY_FILES",
        `This endpoint accepts at most ${maxFileCount} file${maxFileCount === 1 ? "" : "s"}`,
        { maxFileCount },
        400,
      );
    }

    for (const file of files) {
      const contentType =
        file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      const rule = getFileRouteRule(route.config, contentType);
      if (rule.maxFileCount !== undefined && files.length > rule.maxFileCount) {
        throw new UploadError(
          "TOO_MANY_FILES",
          `This endpoint accepts at most ${rule.maxFileCount} file${rule.maxFileCount === 1 ? "" : "s"}`,
          { maxFileCount: rule.maxFileCount },
          400,
        );
      }
      if (
        rule.allowedMimeTypes &&
        !rule.allowedMimeTypes.some(
          (allowed) =>
            allowed.split(";", 1)[0]?.trim().toLowerCase() === contentType,
        )
      ) {
        throw new UploadError(
          "UNSUPPORTED_FILE_TYPE",
          `File type '${contentType}' is not allowed for this endpoint`,
          { allowedMimeTypes: rule.allowedMimeTypes },
          400,
        );
      }
      if (rule.maxFileSize !== undefined) {
        const sizeError = validateFileSize(
          file.size,
          parseFileSize(rule.maxFileSize),
        );
        if (sizeError) {
          throw new UploadError(
            sizeError.code,
            sizeError.message,
            {
              maxSize: parseFileSize(rule.maxFileSize),
              size: file.size,
              file: file.name,
            },
            400,
          );
        }
      }
    }
  }

  private async complete(
    route: FileRouteDefinition,
    metadata: unknown,
    files: UploadResponse[],
  ): Promise<FileRouterCompletionResponse> {
    if (!route.onUploadCompleteHandler) {
      return { files };
    }

    const completed: FileRouterCompletionFile[] = [];
    for (const file of files) {
      const serverData = await route.onUploadCompleteHandler({
        metadata,
        file,
      } as FileRouteCompleteContext);
      completed.push({ ...file, serverData });
    }
    return { files: completed };
  }

  async handlePresigned(
    endpoint: string,
    input: PresignedRequest,
    req: Request,
    metadata?: Record<string, string>,
  ) {
    const route = this.getRoute(endpoint);
    const routeFile = {
      name: input.fileName,
      size: input.fileSize,
      type: input.contentType,
    };
    this.validateRouteFiles(route, [routeFile]);
    const routeMetadata = await this.prepare(route, req, input.input, [
      routeFile,
    ]);
    return this.handler.handlePresigned(input, {
      ...metadata,
      ...asMetadata(routeMetadata),
    });
  }

  async handleBatchPresigned(
    endpoint: string,
    files: PresignedRequest[],
    req: Request,
    type?: string,
    metadata?: Record<string, string>,
    input?: unknown,
  ) {
    const route = this.getRoute(endpoint);
    const routeFiles = files.map((file) => ({
      name: file.fileName,
      size: file.fileSize,
      type: file.contentType,
    }));
    this.validateRouteFiles(route, routeFiles);
    const routeMetadata = await this.prepare(route, req, input, routeFiles);
    return this.handler.handleBatchPresigned(
      {
        files: files.map(({ fileName, contentType, fileSize }) => ({
          fileName,
          contentType,
          fileSize,
        })),
        type,
        input,
      },
      { ...metadata, ...asMetadata(routeMetadata) },
    );
  }

  async handleUpload(
    endpoint: string,
    files: UploadFile[],
    req: Request,
    context?: string,
    input?: unknown,
    metadata?: Record<string, string>,
  ): Promise<FileRouterCompletionResponse> {
    const route = this.getRoute(endpoint);
    this.validateRouteFiles(route, files.map(asRouteFile));
    const routeMetadata = await this.prepare(
      route,
      req,
      input,
      files.map(asRouteFile),
    );
    const result = await this.handler.handleUpload(files, context, {
      ...metadata,
      ...asMetadata(routeMetadata),
    });
    const uploads = "files" in result ? result.files : [result];
    return this.complete(route, routeMetadata, uploads);
  }

  async handleMultipartInitiate(
    endpoint: string,
    input: MultipartInitiateData,
    req: Request,
    metadata?: Record<string, string>,
  ) {
    const route = this.getRoute(endpoint);
    const routeFile = {
      name: input.fileName,
      size: input.fileSize,
      type: input.contentType,
    };
    this.validateRouteFiles(route, [routeFile]);
    const routeMetadata = await this.prepare(route, req, input, [routeFile]);
    return this.handler.handleMultipart("initiate", input, {
      ...metadata,
      ...asMetadata(routeMetadata),
    });
  }

  async handleComplete(
    endpoint: string,
    files: UploadResponse[],
    req: Request,
    input: unknown = undefined,
  ): Promise<FileRouterCompletionResponse> {
    const route = this.getRoute(endpoint);
    if (!this.verifyUploadCompletion) {
      throw new UploadError(
        "PROVIDER_UNSUPPORTED",
        "Client upload completion requires a server-side verifier",
        undefined,
        501,
      );
    }
    this.validateRouteFiles(route, files.map(asRouteFile));
    const routeMetadata = await this.prepare(
      route,
      req,
      input,
      files.map(asRouteFile),
    );
    const verified = await this.verifyUploadCompletion({
      req,
      endpoint,
      files,
      metadata: routeMetadata,
    });
    this.validateRouteFiles(route, verified.map(asRouteFile));
    return this.complete(route, routeMetadata, verified);
  }
}
