import { TRPCError } from "@trpc/server";
import { UploadError } from "../../utils/errors";

/** Preserve causes for server diagnostics, never expose unknown provider messages. */
export function toTRPCUploadError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof UploadError) {
    switch (error.code) {
      case "UNAUTHORIZED":
        return new TRPCError({
          code: "UNAUTHORIZED",
          message: "Upload access denied",
          cause: error,
        });
      case "NOT_FOUND":
      case "UNKNOWN_ENDPOINT":
        return new TRPCError({
          code: "NOT_FOUND",
          message: "Upload resource not found",
          cause: error,
        });
      case "ALREADY_EXISTS":
        return new TRPCError({
          code: "CONFLICT",
          message: "Object already exists",
          cause: error,
        });
      case "FILE_TOO_LARGE":
        return new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "File exceeds the configured limit",
          cause: error,
        });
      case "PROVIDER_UNSUPPORTED":
      case "PROVIDER_UNSUPPORTED_MULTIPART":
        return new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: "Upload operation is unavailable",
          cause: error,
        });
      case "DEPENDENCY_MISSING":
      case "PROVIDER_CLOSED":
      case "DOWNLOAD_FAILED":
      case "INTERNAL_ERROR":
        break;
      default:
        return new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid upload request",
          cause: error,
        });
    }
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Upload operation failed",
    cause: error,
  });
}
