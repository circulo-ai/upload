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
  let cursor = 0;
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  const amountStart = cursor;
  while (isDigit(value[cursor])) cursor += 1;
  if (cursor === amountStart) throw new Error(`Invalid file size: ${value}`);
  if (value[cursor] === ".") {
    cursor += 1;
    const fractionStart = cursor;
    while (isDigit(value[cursor])) cursor += 1;
    if (cursor === fractionStart)
      throw new Error(`Invalid file size: ${value}`);
  }
  const amountEnd = cursor;
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  const unitStart = cursor;
  while (isAsciiLetter(value[cursor])) cursor += 1;
  const unit = (value.slice(unitStart, cursor) || "B").toUpperCase();
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  if (cursor !== value.length) throw new Error(`Invalid file size: ${value}`);
  const amount = Number(value.slice(amountStart, amountEnd));
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

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function isAsciiLetter(value: string | undefined): boolean {
  return (
    value !== undefined &&
    ((value >= "a" && value <= "z") || (value >= "A" && value <= "Z"))
  );
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
