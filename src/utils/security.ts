export const MAX_STORAGE_KEY_LENGTH = 1_024;
export const MAX_FILENAME_LENGTH = 255;

/**
 * Return a safe, display-oriented filename.
 *
 * This intentionally keeps the basename only. A filename is not a storage
 * path, and accepting path separators here makes it too easy for a caller to
 * accidentally turn user input into a directory traversal primitive.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename provided");
  }

  const sanitized = filename
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\x00-\x1F\x7F]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();

  if (!sanitized || sanitized.length === 0) {
    throw new Error("Invalid or empty filename after sanitization");
  }

  return sanitized;
}

/**
 * Validate and normalize a provider key.
 *
 * Storage keys may contain nested directories, but never absolute paths,
 * parent-directory segments, control characters, or backslashes. Rejecting
 * invalid keys (rather than silently rewriting them) avoids collisions and
 * makes authorization decisions deterministic across providers.
 */
export function normalizeStorageKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Storage key is required");
  }
  if (key.length > MAX_STORAGE_KEY_LENGTH) {
    throw new Error("Storage key is too long");
  }
  if (key.startsWith("/") || key.includes("\\")) {
    throw new Error("Storage keys must be relative POSIX paths");
  }
  if (/[\x00-\x1F\x7F]/.test(key)) {
    throw new Error("Storage keys must not contain control characters");
  }

  const segments = key.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      "Storage keys must not contain empty or parent-directory segments",
    );
  }

  // Cross-platform keys must not alias device files, NTFS streams, or paths
  // that Windows silently rewrites (trailing spaces/dots).
  if (
    segments.some(
      (segment) =>
        /[:<>"|?*]/.test(segment) ||
        /[ .]$/.test(segment) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment),
    )
  ) {
    throw new Error("Storage keys must not contain reserved filesystem names");
  }
  return segments.join("/");
}

/**
 * Build a Content-Disposition value without allowing header injection.
 */
export function contentDisposition(
  filename: string,
  disposition: "inline" | "attachment" = "attachment",
): string {
  const safeName = sanitizeFilename(filename);
  const asciiName = safeName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/['\\]/g, "_");
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
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
  if (
    typeof base64 !== "string" ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new Error("Invalid base64 input");
  }
  return Buffer.from(base64, "base64");
}
