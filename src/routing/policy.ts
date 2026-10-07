import type {
  FileRouteConfig,
  FileRouteFileType,
  FileRouteRule,
} from "./contracts";
export function parseFileSize(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid file size: ${value}`);
    }
    return value;
  }
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
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`Invalid file size: ${value}`);
  }
  return result;
}

export function validateFileRouteConfig(config: FileRouteConfig): void {
  const rules: FileRouteRule[] = [
    config as FileRouteRule,
    ...(Object.values(config).filter(isFileRule) as FileRouteRule[]),
  ];
  for (const rule of rules) {
    if (rule.maxFileSize !== undefined) parseFileSize(rule.maxFileSize);
    if (
      rule.maxFileCount !== undefined &&
      (!Number.isSafeInteger(rule.maxFileCount) || rule.maxFileCount <= 0)
    ) {
      throw new Error(`Invalid maxFileCount: ${rule.maxFileCount}`);
    }
    if (
      rule.allowedMimeTypes?.some(
        (mimeType) =>
          typeof mimeType !== "string" ||
          !/^[^\s/]+\/[^\s;]+(?:\s*;.*)?$/i.test(mimeType),
      )
    ) {
      throw new Error("allowedMimeTypes must contain valid MIME types");
    }
  }
}

function isFileRule(value: unknown): value is FileRouteRule {
  return typeof value === "object" && value !== null;
}

export function getFileRouteRule(
  config: FileRouteConfig,
  contentType: string,
): FileRouteRule {
  const category = contentType.split("/", 1)[0] as FileRouteFileType;
  const categoryRule = config[category];
  return {
    ...config.any,
    ...categoryRule,
    maxFileSize:
      categoryRule?.maxFileSize ??
      config.any?.maxFileSize ??
      config.maxFileSize,
    maxFileCount:
      categoryRule?.maxFileCount ??
      config.any?.maxFileCount ??
      config.maxFileCount,
  };
}
