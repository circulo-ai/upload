/**
 * Sanitize filename for safe storage
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename provided");
  }

  const sanitized = filename
    .replace(/\.\./g, "") // Remove path traversal
    .replace(/[/\\]/g, "") // Remove path separators
    .replace(/^\./g, "") // Remove leading dots
    .replace(/[<>:"|?*\x00-\x1F]/g, "_") // Replace invalid characters
    .trim();

  if (!sanitized || sanitized.length === 0) {
    throw new Error("Invalid or empty filename after sanitization");
  }

  return sanitized;
}

/**
 * Validate URL is safe (no file:// or other dangerous protocols)
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Convert buffer to base64
 */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

/**
 * Convert base64 to buffer
 */
export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}
