import type {
  ContentType,
  FileValidationError,
  MAX_FILE_SIZE,
  SupportedAudioExtension,
  SupportedDocumentExtension,
  SupportedMediaExtension,
  SupportedVideoExtension,
} from "../types/core";

/**
 * MIME type mappings
 */
export const MIME_TYPE_MAPPING: Record<string, ContentType> = {
  // Images
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/svg+xml": "image",

  // Documents
  "application/pdf": "document",
  "text/plain": "document",
  "text/csv": "document",
  "application/json": "document",
  "application/xml": "document",
  "text/xml": "document",
  "text/html": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "document",
  "application/msword": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.ms-powerpoint": "document",
  "text/markdown": "document",
  "application/rtf": "document",

  // Audio
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/m4a": "audio",
  "audio/wav": "audio",
  "audio/wave": "audio",
  "audio/x-wav": "audio",
  "audio/webm": "audio",
  "audio/ogg": "audio",
  "audio/vorbis": "audio",
  "audio/flac": "audio",
  "audio/x-flac": "audio",
  "audio/aac": "audio",
  "audio/x-aac": "audio",
  "audio/opus": "audio",

  // Video
  "video/mp4": "video",
  "video/mpeg": "video",
  "video/quicktime": "video",
  "video/x-quicktime": "video",
  "video/x-msvideo": "video",
  "video/avi": "video",
  "video/x-matroska": "video",
  "video/webm": "video",
};

/**
 * Supported MIME types by extension
 */
export const SUPPORTED_MIME_TYPES: Record<
  SupportedDocumentExtension,
  string[]
> = {
  pdf: ["application/pdf", "application/x-pdf"],
  csv: ["text/csv", "application/csv", "text/comma-separated-values"],
  doc: ["application/msword", "application/doc", "application/vnd.ms-word"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
  ],
  txt: ["text/plain", "text/x-plain", "application/txt"],
  md: [
    "text/markdown",
    "text/x-markdown",
    "text/plain",
    "application/markdown",
  ],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ],
  xls: [
    "application/vnd.ms-excel",
    "application/excel",
    "application/x-excel",
    "application/x-msexcel",
  ],
  ppt: [
    "application/vnd.ms-powerpoint",
    "application/powerpoint",
    "application/x-mspowerpoint",
  ],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/octet-stream",
  ],
  html: ["text/html", "application/xhtml+xml"],
  htm: ["text/html", "application/xhtml+xml"],
  json: ["application/json", "text/json", "application/x-json"],
  yaml: ["text/yaml", "text/x-yaml", "application/yaml", "application/x-yaml"],
  yml: ["text/yaml", "text/x-yaml", "application/yaml", "application/x-yaml"],
};

export const SUPPORTED_AUDIO_MIME_TYPES: Record<
  SupportedAudioExtension,
  string[]
> = {
  mp3: ["audio/mpeg", "audio/mp3"],
  m4a: ["audio/mp4", "audio/x-m4a", "audio/m4a"],
  wav: ["audio/wav", "audio/wave", "audio/x-wav"],
  webm: ["audio/webm"],
  ogg: ["audio/ogg", "audio/vorbis"],
  flac: ["audio/flac", "audio/x-flac"],
  aac: ["audio/aac", "audio/x-aac"],
  opus: ["audio/opus"],
};

export const SUPPORTED_VIDEO_MIME_TYPES: Record<
  SupportedVideoExtension,
  string[]
> = {
  mp4: ["video/mp4", "video/mpeg"],
  mov: ["video/quicktime", "video/x-quicktime"],
  avi: ["video/x-msvideo", "video/avi"],
  mkv: ["video/x-matroska"],
  webm: ["video/webm"],
};

/**
 * Get content type for a MIME type
 */
export function getContentType(mimeType: string): ContentType | null {
  return MIME_TYPE_MAPPING[mimeType.toLowerCase()] || null;
}

/**
 * Check if a MIME type is supported
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase() in MIME_TYPE_MAPPING;
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot !== -1 ? filename.slice(lastDot + 1).toLowerCase() : "";
}

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(extension: string): string {
  const extensionMimeMap: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    // Documents
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    htm: "text/html",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword",
    xls: "application/vnd.ms-excel",
    ppt: "application/vnd.ms-powerpoint",
    md: "text/markdown",
    rtf: "application/rtf",
    // Audio
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    webm: "audio/webm",
    ogg: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
    opus: "audio/opus",
    // Video
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
  };

  return (
    extensionMimeMap[extension.toLowerCase()] || "application/octet-stream"
  );
}

/**
 * Validate file type and MIME type match
 */
export function validateFileType(
  fileName: string,
  mimeType: string
): FileValidationError | null {
  const extension = getFileExtension(fileName) as SupportedMediaExtension;

  // Check document types
  if (extension in SUPPORTED_MIME_TYPES) {
    const baseMimeType = mimeType.split(";")[0]?.trim();
    if (!baseMimeType) {
      return {
        code: "MIME_TYPE_MISMATCH",
        message: "Invalid MIME type",
        supportedTypes: [],
      };
    }

    const allowedMimeTypes =
      SUPPORTED_MIME_TYPES[extension as SupportedDocumentExtension];

    if (!allowedMimeTypes?.includes(baseMimeType)) {
      return {
        code: "MIME_TYPE_MISMATCH",
        message: `MIME type ${baseMimeType} does not match file extension ${extension}`,
        supportedTypes: allowedMimeTypes || [],
      };
    }

    return null;
  }

  // Check audio types
  if (extension in SUPPORTED_AUDIO_MIME_TYPES) {
    const baseMimeType = mimeType.split(";")[0]?.trim();
    if (!baseMimeType) {
      return {
        code: "MIME_TYPE_MISMATCH",
        message: "Invalid MIME type",
        supportedTypes: [],
      };
    }

    const allowedMimeTypes =
      SUPPORTED_AUDIO_MIME_TYPES[extension as SupportedAudioExtension];

    if (!allowedMimeTypes?.includes(baseMimeType)) {
      return {
        code: "MIME_TYPE_MISMATCH",
        message: `MIME type ${baseMimeType} does not match file extension ${extension}`,
        supportedTypes: allowedMimeTypes || [],
      };
    }

    return null;
  }

  // Check video types
  if (extension in SUPPORTED_VIDEO_MIME_TYPES) {
    const baseMimeType = mimeType.split(";")[0]?.trim();
    if (!baseMimeType) {
      return {
        code: "MIME_TYPE_MISMATCH",
        message: "Invalid MIME type",
        supportedTypes: [],
      };
    }

    const allowedMimeTypes =
      SUPPORTED_VIDEO_MIME_TYPES[extension as SupportedVideoExtension];

    if (!allowedMimeTypes?.includes(baseMimeType)) {
      return {
        code: "MIME_TYPE_MISMATCH",
        message: `MIME type ${baseMimeType} does not match file extension ${extension}`,
        supportedTypes: allowedMimeTypes || [],
      };
    }

    return null;
  }

  return {
    code: "UNSUPPORTED_FILE_TYPE",
    message: `Unsupported file type: ${extension}`,
    supportedTypes: [
      ...Object.keys(SUPPORTED_MIME_TYPES),
      ...Object.keys(SUPPORTED_AUDIO_MIME_TYPES),
      ...Object.keys(SUPPORTED_VIDEO_MIME_TYPES),
    ],
  };
}

/**
 * Validate file size
 */
export function validateFileSize(
  fileSize: number,
  maxSize: typeof MAX_FILE_SIZE = 100 * 1024 * 1024
): FileValidationError | null {
  if (fileSize > maxSize) {
    return {
      code: "FILE_TOO_LARGE",
      message: `File size ${formatFileSize(
        fileSize
      )} exceeds maximum ${formatFileSize(maxSize)}`,
      supportedTypes: [],
    };
  }
  return null;
}

/**
 * Format bytes to human-readable size
 */
export function formatFileSize(bytes: number, precision: number = 1): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const value = bytes / k ** i;
  const formattedValue = Number.parseFloat(value.toFixed(precision));

  return `${formattedValue} ${sizes[i]}`;
}