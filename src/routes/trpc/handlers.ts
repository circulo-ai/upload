import type { FileRouter } from "../../router";
import { FileRouteHandler } from "../handler";
import {
  FileRouterHandler,
  type FileRouterHandlerConfig,
} from "../router-handler";
import { toTRPCUploadError } from "./errors";
import {
  createTRPCFileSchemas,
  type TRPCFileAction,
  type TRPCFileInput,
} from "./schemas";

export interface TRPCFileAuthorization<TContext> {
  readonly ctx: TContext;
  readonly action: TRPCFileAction;
  readonly input: TRPCFileInput<TRPCFileAction>;
}

export interface TRPCFileHandlersConfig<
  TContext,
  TRouter extends FileRouter,
> extends FileRouterHandlerConfig<TRouter> {
  /** Return the original request from your tRPC context. */
  getRequest: (ctx: TContext) => Request | Promise<Request>;
  /** Required object/session/tenant authorization before every operation. */
  authorize: (
    operation: TRPCFileAuthorization<TContext>,
  ) => void | Promise<void>;
  /** Trusted metadata only, derived from authenticated context. */
  getUploadMetadata?: (
    ctx: TContext,
  ) => Record<string, string> | Promise<Record<string, string>>;
}

/** Compose resolvers into your existing protected procedures and router. */
export function createTRPCFileHandlers<
  TContext,
  TRouter extends FileRouter = FileRouter,
>(config: TRPCFileHandlersConfig<TContext, TRouter>) {
  const schemas = createTRPCFileSchemas(config.maxFileCount);
  const routes = new FileRouterHandler(config);
  const handler = new FileRouteHandler(config);

  function resolver<TAction extends TRPCFileAction, TOutput>(
    action: TAction,
    execute: (input: TRPCFileInput<TAction>, ctx: TContext) => Promise<TOutput>,
  ) {
    return async (options: {
      ctx: TContext;
      input: TRPCFileInput<TAction>;
    }): Promise<TOutput> => {
      try {
        // Also validate direct resolver usage; tRPC .input(schema) remains the outer boundary.
        const input = schemas[action].parse(
          options.input,
        ) as TRPCFileInput<TAction>;
        await config.authorize({ ctx: options.ctx, action, input });
        return await execute(input, options.ctx);
      } catch (error) {
        throw toTRPCUploadError(error);
      }
    };
  }
  const metadata = (ctx: TContext) => config.getUploadMetadata?.(ctx);
  return {
    schemas,
    presigned: resolver("presigned", async (input, ctx) =>
      routes.handlePresigned(
        input.endpoint,
        input,
        await config.getRequest(ctx),
        await metadata(ctx),
      ),
    ),
    presignedBatch: resolver("presignedBatch", async (input, ctx) =>
      routes.handleBatchPresigned(
        input.endpoint,
        input.files,
        await config.getRequest(ctx),
        input.context,
        await metadata(ctx),
        input.input,
      ),
    ),
    complete: resolver("complete", async (input, ctx) =>
      routes.handleComplete(
        input.endpoint,
        input.files,
        await config.getRequest(ctx),
        input.input,
      ),
    ),
    download: resolver("download", async (input) =>
      handler.handleDownload(input.key, input.name, input.context),
    ),
    delete: resolver("delete", async (input) =>
      handler.handleDelete(input.key, input.context),
    ),
    multipartInitiate: resolver("multipartInitiate", async (input, ctx) =>
      routes.handleMultipartInitiate(
        input.endpoint,
        input,
        await config.getRequest(ctx),
        await metadata(ctx),
      ),
    ),
    multipartPartUrls: resolver("multipartPartUrls", async (input) =>
      handler.handleMultipart("get-part-urls", input),
    ),
    multipartComplete: resolver("multipartComplete", async (input) =>
      handler.handleMultipart("complete", input),
    ),
    multipartAbort: resolver("multipartAbort", async (input) =>
      handler.handleMultipart("abort", input),
    ),
  };
}
