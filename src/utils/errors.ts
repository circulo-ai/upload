export type UploadErrorCode =
  | "UNKNOWN_CONTEXT"
  | "MISSING_KEY"
  | "NO_FILES"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "MIME_TYPE_MISMATCH"
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
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
