import type { StorageProvider } from "../../src/providers/contracts";
import { createFileRouter, f, type FileRouterInput } from "../../src/router";
import { StorageManager } from "../../src/storage-manager";

const router = createFileRouter({
  photos: f({ image: { maxFileSize: "4MB" } })
    .input((value: unknown) => {
      if (
        typeof value !== "object" ||
        !value ||
        !("albumId" in value) ||
        typeof value.albumId !== "string"
      )
        throw new Error("Invalid input");
      return { albumId: value.albumId };
    })
    .middleware(({ input }) => ({ owner: input.albumId }))
    .onUploadComplete(({ metadata }) => ({ owner: metadata.owner })),
});

type Equal<T, U> =
  (<V>() => V extends T ? 1 : 2) extends <V>() => V extends U ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
export type InputInference = Expect<
  Equal<FileRouterInput<typeof router, "photos">, { albumId: string }>
>;

export function contextInference(provider: StorageProvider) {
  const manager = new StorageManager({
    providers: { photos: provider, documents: provider },
    defaultContext: "photos",
  });
  manager.supportsPresignedUrls("documents");
  // @ts-expect-error Unknown contexts must never widen the inferred registry.
  manager.supportsPresignedUrls("unknown");
  new StorageManager({
    providers: { photos: provider },
    // @ts-expect-error Default context must belong to the provider registry.
    defaultContext: "missing",
  });
  return manager;
}
