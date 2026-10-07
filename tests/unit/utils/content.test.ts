import { describe, expect, test } from "vitest";
import { detectCommonMimeType } from "../../../src/utils/content";

function bytes(text: string): Uint8Array {
  return Uint8Array.from(
    text.split("").map((character) => character.charCodeAt(0)),
  );
}

describe("media content detection", () => {
  test("verifies PDF content rather than trusting its extension", () => {
    expect(detectCommonMimeType(bytes("%PDF-1.7\n"))).toBe("application/pdf");
    expect(detectCommonMimeType(bytes("<html>fake.pdf</html>"))).toBeNull();
  });
  test("detects supported image signatures", () => {
    expect(
      detectCommonMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    ).toBe("image/jpeg");
    expect(
      detectCommonMimeType(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(detectCommonMimeType(bytes("GIF89a"))).toBe("image/gif");
    expect(detectCommonMimeType(bytes("RIFFxxxxWEBP"))).toBe("image/webp");
  });

  test("detects supported video and avif signatures", () => {
    expect(
      detectCommonMimeType(
        bytes("\u0000\u0000\u0000\u0014ftypisom\u0000\u0000\u0000\u0000"),
      ),
    ).toBe("video/mp4");
    expect(
      detectCommonMimeType(
        bytes("\u0000\u0000\u0000\u0014ftypavif\u0000\u0000\u0000\u0000"),
      ),
    ).toBe("image/avif");
    expect(
      detectCommonMimeType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])),
    ).toBe("video/webm");
  });

  test("returns null for unknown content", () => {
    expect(detectCommonMimeType(bytes("not-media"))).toBeNull();
  });
});
