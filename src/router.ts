import type { UploadResponse } from "./routes/handler";

export type FileRouteFileType =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "any";

export interface FileRouteRule {
  maxFileSize?: string | number;
  maxFileCount?: number;
  allowedMimeTypes?: string[];
}

export type FileRouteConfig = Partial<
  Record<FileRouteFileType, FileRouteRule>
> & {
  maxFileSize?: string | number;
  maxFileCount?: number;
};

export interface FileRouteFile {
  name: string;
  size: number;
  type: string;
  key?: string;
}

export interface FileRouteMiddlewareContext<TInput = unknown> {
  req: Request;
  input: TInput;
  files: readonly FileRouteFile[];
}

export interface FileRouteCompleteContext<TMetadata = unknown> {
  metadata: TMetadata;
  file: UploadResponse;
}

export type FileRouteMiddleware<TInput = unknown, TMetadata = unknown> = (
  context: FileRouteMiddlewareContext<TInput>,
) => Promise<TMetadata> | TMetadata;

export type FileRouteComplete<TMetadata = unknown> = (
  context: FileRouteCompleteContext<TMetadata>,
) => Promise<unknown> | unknown;

export type FileRouteInputParser<TInput> = (
  input: unknown,
) => Promise<TInput> | TInput;

export interface FileRouteDefinition<TInput = unknown, TMetadata = unknown> {
  config: FileRouteConfig;
  middlewareHandler?: FileRouteMiddleware<TInput, TMetadata>;
  onUploadCompleteHandler?: FileRouteComplete<TMetadata>;
  inputParser?: FileRouteInputParser<TInput>;
}

// `any` here is intentional: a router is an existential map whose individual
// endpoints may carry different input and metadata types. Consumers recover
// those types through the concrete router object and endpoint generic.
export type FileRouter = Record<string, FileRouteDefinition<any, any>>;

export type FileRouterEndpoint<TRouter extends FileRouter> = keyof TRouter &
  string;

export type FileRouterInput<
  TRouter extends FileRouter,
  TEndpoint extends FileRouterEndpoint<TRouter>,
> =
  TRouter[TEndpoint] extends FileRouteDefinition<infer TInput, unknown>
    ? TInput
    : unknown;

export class FileRouteBuilder<
  TConfig extends FileRouteConfig,
  TInput = unknown,
  TMetadata = unknown,
> implements FileRouteDefinition<TInput, TMetadata> {
  readonly config: TConfig;
  readonly middlewareHandler?: FileRouteMiddleware<TInput, TMetadata>;
  readonly onUploadCompleteHandler?: FileRouteComplete<TMetadata>;
  readonly inputParser?: FileRouteInputParser<TInput>;

  constructor(
    config: TConfig,
    options: {
      middlewareHandler?: FileRouteMiddleware<TInput, TMetadata>;
      onUploadCompleteHandler?: FileRouteComplete<TMetadata>;
      inputParser?: FileRouteInputParser<TInput>;
    } = {},
  ) {
    this.config = config;
    this.middlewareHandler = options.middlewareHandler;
    this.onUploadCompleteHandler = options.onUploadCompleteHandler;
    this.inputParser = options.inputParser;
  }

  middleware<TNextMetadata>(
    handler: FileRouteMiddleware<TInput, TNextMetadata>,
  ): FileRouteBuilder<TConfig, TInput, TNextMetadata> {
    return new FileRouteBuilder(this.config, {
      middlewareHandler: handler,
      onUploadCompleteHandler: this.onUploadCompleteHandler as
        | FileRouteComplete<TNextMetadata>
        | undefined,
      inputParser: this.inputParser,
    });
  }

  onUploadComplete(
    handler: FileRouteComplete<TMetadata>,
  ): FileRouteBuilder<TConfig, TInput, TMetadata> {
    return new FileRouteBuilder(this.config, {
      middlewareHandler: this.middlewareHandler,
      onUploadCompleteHandler: handler,
      inputParser: this.inputParser,
    });
  }

  input<TNextInput>(
    parser: FileRouteInputParser<TNextInput>,
  ): FileRouteBuilder<TConfig, TNextInput, TMetadata> {
    return new FileRouteBuilder(this.config, {
      middlewareHandler: this.middlewareHandler as
        | FileRouteMiddleware<TNextInput, TMetadata>
        | undefined,
      onUploadCompleteHandler: this.onUploadCompleteHandler,
      inputParser: parser,
    });
  }
}

export function f<const TConfig extends FileRouteConfig>(
  config: TConfig,
): FileRouteBuilder<TConfig> {
  return new FileRouteBuilder(config);
}

export function createFileRouter<const TRouter extends FileRouter>(
  router: TRouter,
): TRouter {
  return router;
}

export function parseFileSize(value: string | number): number {
  if (typeof value === "number") return value;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?\s*$/i.exec(value);
  if (!match) throw new Error(`Invalid file size: ${value}`);

  const amount = Number(match[1]);
  const unit = (match[2] ?? "B").toUpperCase();
  const multiplier =
    unit === "TB"
      ? 1024 ** 4
      : unit === "GB"
        ? 1024 ** 3
        : unit === "MB"
          ? 1024 ** 2
          : unit === "KB"
            ? 1024
            : 1;
  return Math.floor(amount * multiplier);
}

export function getFileRouteRule(
  config: FileRouteConfig,
  contentType: string,
): FileRouteRule {
  const category = contentType.split("/", 1)[0] as FileRouteFileType;
  return {
    ...config.any,
    ...config[category],
    maxFileSize: config[category]?.maxFileSize ?? config.maxFileSize,
    maxFileCount: config[category]?.maxFileCount ?? config.maxFileCount,
  };
}
