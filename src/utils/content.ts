/** Recognize common binary signatures. This is a heuristic, not malware scanning or full format validation. */
export function detectCommonMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    /^%PDF-[12]\.\d/.test(String.fromCharCode(...bytes.slice(0, 8)))
  ) {
    return "application/pdf";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a"
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 6 &&
    String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a"
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
  ) {
    const brands = String.fromCharCode(
      ...bytes.slice(8, Math.min(bytes.length, 64)),
    );
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
    if (
      brands.includes("isom") ||
      brands.includes("iso2") ||
      brands.includes("mp41") ||
      brands.includes("mp42")
    ) {
      return "video/mp4";
    }
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video/webm";
  }
  return null;
}
