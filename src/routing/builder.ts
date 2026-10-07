import { UploadError } from "../utils/errors";
import type {
  FileRouteComplete,
  FileRouteConfig,
  FileRouteDefinition,
  FileRouteInputParser,
  FileRouteMiddleware,
  FileRouter,
} from "./contracts";
import { validateFileRouteConfig } from "./policy";
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
    validateFileRouteConfig(config);
    this.config = config;
    this.middlewareHandler = options.middlewareHandler;
    this.onUploadCompleteHandler = options.onUploadCompleteHandler;
    this.inputParser = options.inputParser;
  }

  middleware<TNextMetadata>(
    handler: FileRouteMiddleware<TInput, TNextMetadata>,
  ): FileRouteBuilder<TConfig, TInput, TNextMetadata> {
    if (this.onUploadCompleteHandler)
      throw new UploadError(
        "INVALID_INPUT",
        "Configure middleware before completion handlers",
      );
    return new FileRouteBuilder(this.config, {
      middlewareHandler: handler,
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
    if (this.middlewareHandler)
      throw new UploadError(
        "INVALID_INPUT",
        "Configure the input parser before middleware",
      );
    return new FileRouteBuilder(this.config, {
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
