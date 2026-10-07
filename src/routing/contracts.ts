import type { UploadResponse } from "../types/routes";

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

/** Heterogeneous endpoints retain their concrete generics in the inferred router.
 * Only the delivery adapter erases handler input types after parsing/middleware. */
export interface RuntimeFileRouteDefinition {
  readonly config: FileRouteConfig;
  readonly inputParser?: FileRouteInputParser<unknown>;
  readonly middlewareHandler?: (...args: never[]) => unknown;
  readonly onUploadCompleteHandler?: (...args: never[]) => unknown;
}
export type FileRouter = Record<string, RuntimeFileRouteDefinition>;

export type FileRouterEndpoint<TRouter extends FileRouter> = keyof TRouter &
  string;

export type FileRouterInput<
  TRouter extends FileRouter,
  TEndpoint extends FileRouterEndpoint<TRouter>,
> =
  TRouter[TEndpoint] extends FileRouteDefinition<infer TInput, infer _TMetadata>
    ? TInput
    : unknown;
