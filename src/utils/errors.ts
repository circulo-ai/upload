export type UploadErrorCode =
  | "DEPENDENCY_MISSING"
  | "ALREADY_EXISTS"
  | "PROVIDER_CLOSED"
  | "UNKNOWN_CONTEXT"
  | "MISSING_KEY"
  | "NO_FILES"
  | "TOO_MANY_FILES"
  | "MISSING_ENDPOINT"
  | "UNKNOWN_ENDPOINT"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "MIME_TYPE_MISMATCH"
  | "INVALID_INPUT"
  | "INVALID_FILE"
  | "UNAUTHORIZED"
  | "PROVIDER_UNSUPPORTED"
  | "PROVIDER_UNSUPPORTED_MULTIPART"
  | "NOT_FOUND"
  | "DOWNLOAD_FAILED"
  | "INTERNAL_ERROR";

export class UploadError extends Error {
  code: UploadErrorCode;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    code: UploadErrorCode,
    message: string,
    details?: Record<string, unknown>,
    status: number = 400,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UploadError";
    this.code = code;
    this.status = Math.min(599, Math.max(400, Math.trunc(status)));
    this.details = details;
  }
}
