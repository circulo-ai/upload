// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Supported image file extensions
 */
export const SUPPORTED_IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
] as const;

/**
 * Supported document file extensions
 */
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "csv",
  "doc",
  "docx",
  "txt",
  "md",
  "xlsx",
  "xls",
  "ppt",
  "pptx",
  "html",
  "htm",
  "json",
  "yaml",
  "yml",
] as const;

/**
 * Supported audio file extensions
 */
export const SUPPORTED_AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "wav",
  "webm",
  "ogg",
  "flac",
  "aac",
  "opus",
] as const;

/**
 * Supported video file extensions
 */
export const SUPPORTED_VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
] as const;

export type SupportedDocumentExtension =
  (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];
export type SupportedImageExtension =
  (typeof SUPPORTED_IMAGE_EXTENSIONS)[number];
export type SupportedAudioExtension =
  (typeof SUPPORTED_AUDIO_EXTENSIONS)[number];
export type SupportedVideoExtension =
  (typeof SUPPORTED_VIDEO_EXTENSIONS)[number];
export type SupportedMediaExtension =
  | SupportedImageExtension
  | SupportedDocumentExtension
  | SupportedAudioExtension
  | SupportedVideoExtension;

/**
 * File validation error
 */
export interface FileValidationError {
  code: "UNSUPPORTED_FILE_TYPE" | "MIME_TYPE_MISMATCH" | "FILE_TOO_LARGE";
  message: string;
  supportedTypes: readonly string[];
}

/**
 * MIME type content categories
 */
export type ContentType = "image" | "document" | "audio" | "video";

/**
 * Maximum file size (100MB)
 */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;
