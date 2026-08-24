import { describe, expect, it } from "vitest";
import { f, getFileRouteRule, parseFileSize } from "./router";

describe("file router", () => {
  it("supports fluent constraints and lifecycle hooks", async () => {
    const completed: string[] = [];
    const route = f({ image: { maxFileSize: "4MB" } })
      .middleware(async ({ req }) => ({ userId: req.headers.get("x-user-id") }))
      .onUploadComplete(async ({ metadata, file }) => {
        completed.push(`${metadata.userId}:${file.name}`);
      });

    expect(parseFileSize("4MB")).toBe(4 * 1024 * 1024);
    expect(getFileRouteRule(route.config, "image/png").maxFileSize).toBe("4MB");
    expect(route.middlewareHandler).toBeDefined();
    await route.onUploadCompleteHandler?.({
      metadata: { userId: "user-1" },
      file: {
        id: "key",
        name: "avatar.png",
        size: 1,
        type: "image/png",
        key: "key",
        path: "/key",
        url: "/key",
        uploadedAt: "now",
        expiresAt: "later",
        context: "uploads",
      },
    });

    expect(completed).toEqual(["user-1:avatar.png"]);
  });
});
