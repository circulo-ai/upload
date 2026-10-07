import { createRequire } from "node:module";
import { UploadError } from "./errors";

const requireDependency = createRequire(
  typeof __filename === "string" ? __filename : import.meta.url,
);

/** Load provider SDKs only when that provider is used, including in CJS builds. */
export function optionalDependency<T>(name: string): T {
  try {
    return requireDependency(name) as T;
  } catch (cause) {
    throw new UploadError(
      "DEPENDENCY_MISSING",
      `Install ${name} to use this storage provider`,
      undefined,
      500,
      { cause },
    );
  }
}
