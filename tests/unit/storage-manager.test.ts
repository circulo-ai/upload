import { describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "../../src/providers/base";
import { StorageManager } from "../../src/storage-manager";

function provider(): StorageProvider {
  return {
    upload: vi.fn(),
    download: vi.fn(),
    delete: vi.fn(),
    supportsPresignedUrls: () => false,
    supportsMultipartUpload: () => false,
    close: vi.fn(),
  };
}

describe("storage manager lifecycle", () => {
  it("closes shared providers once, skips untouched factories and does not mutate configuration", async () => {
    const active = provider();
    const lazy = vi.fn(() => provider());
    const providers = { primary: active, shared: active, lazy };
    const manager = new StorageManager({
      providers,
      defaultContext: "primary",
    });
    const first = manager.close();
    const second = manager.close();
    expect(first).toBe(second);
    await first;
    expect(active.close).toHaveBeenCalledTimes(1);
    expect(lazy).not.toHaveBeenCalled();
    expect(providers.lazy).toBe(lazy);
    await expect(manager.download({ key: "file" })).rejects.toMatchObject({
      code: "PROVIDER_CLOSED",
    });
  });

  it("attempts every close and preserves all failures", async () => {
    const one = provider();
    const two = provider();
    const cause = new Error("close failed");
    if (!one.close) throw new Error("Missing test close hook");
    vi.mocked(one.close).mockRejectedValue(cause);
    const manager = new StorageManager<string>({
      providers: { one, two },
      defaultContext: "one",
    });
    await expect(manager.close()).rejects.toMatchObject({ errors: [cause] });
    expect(two.close).toHaveBeenCalledTimes(1);
  });

  it("never resolves inherited object properties as storage contexts", async () => {
    const manager = new StorageManager<string>({
      providers: { primary: provider() },
      defaultContext: "primary",
    });
    expect(manager.hasContext("toString")).toBe(false);
    await expect(
      manager.download({ key: "file", context: "toString" }),
    ).rejects.toThrow();
  });
});
