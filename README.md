# @circulo-ai/upload

Production-oriented, type-safe file uploads for Node.js applications and React clients. The package provides one storage contract for S3-compatible services, Azure Blob Storage, Vercel Blob, FTP/FTPS, and local disk, plus Next.js, Hono and tRPC adapters and a typed file-router API.

## What it provides

- One `StorageProvider` interface for upload, download, and delete.
- `StorageManager` for multiple named storage contexts (buckets, containers, directories, or backends).
- Presigned uploads/downloads for S3-compatible and Azure providers.
- S3/Azure multipart initiation, part URL generation, completion, and abort.
- `f(...)` typed routes with per-category limits, MIME allowlists, middleware, input parsing, and completion callbacks.
- Next.js and Hono adapters for JSON, multipart-form, direct-upload completion, and file serving.
- React `uploadFiles`, `useFileUpload`, `UploadButton`, and `UploadDropzone`.
- Structured `UploadError` codes and validation/security utilities.

The package does not virus-scan, content-sniff, transcode, or authenticate requests. Those are application responsibilities and are called out below.

The production contract, breaking completion-verification change, provider capabilities, and release qualification steps are documented in [PRODUCTION.md](./PRODUCTION.md).

## Installation

```bash
npm install @circulo-ai/upload

# Install only the provider/framework peers you use.
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner # S3/R2/MinIO
npm install @azure/storage-blob                              # Azure Blob
npm install basic-ftp                                          # FTP/FTPS
npm install hono zod                                           # Hono routes
npm install react                                               # React helpers
```

Local storage has no provider dependency. Install `@vercel/blob` for Vercel storage,
`@trpc/server` 11.x and Zod 4 for tRPC, and Zod 4 for Next.js handlers.

## Runtime model

Providers and `StorageManager` are server-side APIs. Browser code should use presigned URLs or the framework route adapter. The `react` entry point is the browser client and does not expose credentials.

| Capability                      | S3-compatible |         Azure Blob |              Vercel Blob | Local | FTP/FTPS |
| ------------------------------- | ------------: | -----------------: | -----------------------: | ----: | -------: |
| Upload/download/delete          |             ✓ |                  ✓ |                        ✓ |     ✓ |        ✓ |
| Presigned upload/download       |             ✓ | ✓ with account key |                        — |     — |        — |
| Manual multipart API            |             ✓ |                  ✓ |                        — |     — |        — |
| Server-side automatic multipart |             — |                  — | ✓ with `multipart: true` |     — |        — |

Use Node.js 22 or newer. Edge compatibility depends on the provider and runtime APIs; local disk, FTP, and the AWS SDK are generally Node-oriented.

## Quick start

```ts
import { S3StorageProvider, StorageManager } from "@circulo-ai/upload";

const storage = new StorageManager({
  providers: {
    uploads: new S3StorageProvider({
      bucket: process.env.S3_BUCKET!,
      region: process.env.AWS_REGION!,
      // Omit credentials to use the AWS SDK default credential chain/IAM role.
    }),
  },
  defaultContext: "uploads",
});

const result = await storage.upload({
  file: Buffer.from("hello"),
  fileName: "hello.txt",
  contentType: "text/plain",
  context: "uploads",
});

console.log(result.key, result.path);
```

`StorageManager` contexts are compile-time checked when a context union is provided:

```ts
type Context = "private" | "public" | "temporary";

const storage = new StorageManager<Context>({
  providers: {
    private: privateProvider,
    public: publicProvider,
    temporary: temporaryProvider,
  },
  defaultContext: "private",
});
```

Providers can also be factories. Factories are lazy and initialized once on first use, which is useful when environment variables are unavailable during build-time module evaluation.

## Providers

### S3, R2, and MinIO

```ts
import { S3StorageProvider } from "@circulo-ai/upload";

const s3 = new S3StorageProvider({
  bucket: "my-bucket",
  region: "us-east-1",
  pathPrefix: "uploads",
  // For R2, MinIO, or another S3-compatible service:
  // endpoint: "https://account.r2.cloudflarestorage.com",
  // forcePathStyle: true,
  // credentials: { accessKeyId: "...", secretAccessKey: "..." },
});
```

Credentials should come from the environment, IAM, or another secret manager—not source control or browser code. Custom endpoints must use `http` or `https`; use HTTPS outside local development.

### Azure Blob Storage

```ts
import { AzureBlobStorageProvider } from "@circulo-ai/upload";

const azure = new AzureBlobStorageProvider({
  containerName: process.env.AZURE_CONTAINER!,
  accountName: process.env.AZURE_ACCOUNT!,
  accountKey: process.env.AZURE_ACCOUNT_KEY!,
  pathPrefix: "uploads",
});
```

For server-side uploads, a connection string can be used instead of an account key. Azure SAS URL generation requires `accountKey`.

### Local disk

```ts
import { LocalStorageProvider } from "@circulo-ai/upload";

const local = new LocalStorageProvider({
  basePath: "/var/lib/my-app/uploads",
  pathPrefix: "files",
  serveBaseUrl: "/api/files/serve",
});
```

Local writes use a private temporary file followed by an atomic rename. Keys must be relative POSIX paths and are checked against the resolved base directory, including symlink-aware realpath checks. Use a persistent mounted volume in production; local disk is not shared across horizontally scaled instances.

### FTP/FTPS

```ts
import { FtpStorageProvider } from "@circulo-ai/upload";

const ftp = new FtpStorageProvider({
  host: process.env.FTP_HOST!,
  user: process.env.FTP_USER!,
  password: process.env.FTP_PASSWORD!,
  secure: true,
  rootDirectory: "/srv/uploads",
  pathPrefix: "files",
});
```

FTP supports upload, download, and delete only. Use explicit or implicit FTPS as required by the server. Plain FTP sends credentials and file data in clear text and should not be used in production.

### Vercel Blob

```ts
import { VercelBlobStorageProvider } from "@circulo-ai/upload";

const blob = new VercelBlobStorageProvider({
  token: process.env.BLOB_READ_WRITE_TOKEN,
  pathPrefix: "uploads",
  multipart: true,
});
```

Vercel Blob currently exposes public blobs through this provider. Treat the provider as public storage, do not put secrets or untrusted private documents there, and enforce authorization before every upload/delete operation.

## Typed file routers

Typed routes are the recommended HTTP integration for applications with more than one upload use case.

```ts
import {
  f,
  type FileRouter,
  StorageManager,
  S3StorageProvider,
} from "@circulo-ai/upload";
import { createNextFileHandler } from "@circulo-ai/upload/next";
import { z } from "zod";

export const fileRouter = {
  avatar: f({
    image: {
      maxFileSize: "4MB",
      maxFileCount: 1,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    },
  })
    .input((value) => z.object({ profileId: z.string().uuid() }).parse(value))
    .middleware(async ({ req, input }) => {
      const userId = req.headers.get("x-user-id");
      if (!userId) throw new Error("Unauthorized");
      return { userId, profileId: input.profileId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await saveProfileAvatar(metadata.profileId, metadata.userId, file.key);
      return { persisted: true };
    }),
} satisfies FileRouter;

const fileHandler = createNextFileHandler(
  {
    storageManager: new StorageManager({
      providers: {
        uploads: new S3StorageProvider({
          bucket: process.env.S3_BUCKET!,
          region: process.env.AWS_REGION!,
        }),
      },
      defaultContext: "uploads",
    }),
    maxFileSize: 100 * 1024 * 1024,
    maxFileCount: 100,
  },
  { router: fileRouter },
);

export const POST = fileHandler;
export const GET = fileHandler;
```

`maxFileSize` defaults to 100 MiB and `maxFileCount` defaults to 100 for non-router batch/upload calls. A route rule overrides the global limit. The `any` rule is a fallback for every category, and category-specific rules take precedence over it.

Supported route size values are positive safe integers or strings such as `"4MB"`, `"512KB"`, and `"1GB"`. Units use binary multiples (1024).

### Middleware and authorization

Route middleware is the authorization boundary. Add it to every enabled operation that can reveal, create, mutate, or delete a file. In particular, protect `serve`, `download`, `delete`, all multipart actions, and `complete`; protecting only `upload` is not sufficient.

The package cannot know whether a storage key belongs to a user. For multi-tenant applications, authorize the context and key against your own database in middleware or application code. Do not accept a client-provided `context` as an authorization decision.

## Next.js and Hono routes

Both adapters expose these paths by default:

| Method/path                  | Purpose                                           |
| ---------------------------- | ------------------------------------------------- |
| `POST /delete`               | Delete `{ key, context? }`                        |
| `POST /download`             | Get a download URL for `{ key, name?, context? }` |
| `POST /presigned`            | Create one direct-upload URL                      |
| `POST /presigned/batch`      | Create up to 100 direct-upload URLs               |
| `POST /multipart?action=...` | Initiate, get part URLs, complete, or abort       |
| `POST /upload`               | Server-side `multipart/form-data` upload          |
| `POST /complete`             | Run typed-route completion after direct upload    |
| `GET`/`HEAD /serve/...`      | Serve a file through the server                   |

Use `defaultRoute` when mounting a dedicated route file instead of a catch-all. Use `endpointParam` to rename the typed-router query parameter. Each route can be disabled or given framework middleware with `routes`.

Server-served files default to:

- `Content-Disposition: attachment`;
- `Cache-Control: private, no-store`;
- an extension-derived MIME type, with `application/octet-stream` fallback;
- `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`.

These defaults avoid turning uploaded HTML/SVG into an executable public document and avoid caching private files. If your threat model allows it, `serveContentDisposition: "inline"` and `serveCacheControl` can be set on the Next/Hono options. Configure that deliberately and keep authentication in place.

The adapter reads request bodies through the framework. Configure your framework/reverse proxy body-size limit to at least the intended upload size plus multipart overhead; a package-level file limit cannot prevent a proxy or framework from buffering an oversized request first.

## Presigned uploads

```ts
const presigned = await storage.generatePresignedUploadUrl({
  fileName: "report.pdf",
  contentType: "application/pdf",
  fileSize: 2_000_000,
  context: "uploads",
  expirationSeconds: 900,
});

await fetch(presigned.url, {
  method: "PUT",
  headers: presigned.uploadHeaders,
  body: file,
});
```

Presigned URLs are bearer credentials. Keep expiration short, never log them, and authorize the URL-creation request. The provider URL is generated for a specific key and content type, but storage bucket CORS and provider policies remain your responsibility. Configure CORS narrowly for your application origins and methods.

The maximum presigned expiration accepted by the built-in providers is seven days. The route handler uses one hour for upload URLs and five minutes for download URLs.

## Multipart uploads

S3-compatible and Azure providers support this sequence:

```ts
const { uploadId, key } = await storage.initiateMultipartUpload({
  fileName: "large.bin",
  contentType: "application/octet-stream",
  fileSize: 100 * 1024 * 1024,
  context: "uploads",
});

const parts = await storage.getMultipartPartUrls({
  uploadId,
  key,
  partNumbers: [1, 2, 3],
  context: "uploads",
});

// PUT each part to its URL, then collect provider-specific acknowledgements.
await storage.completeMultipartUpload({
  uploadId,
  key,
  parts: [{ PartNumber: 1, ETag: '"etag-1"' }], // S3; Azure uses { blockId, partNumber }.
  context: "uploads",
});
```

Part numbers must be unique integers from 1 through 10,000. Always expose an abort path on cancellation and clean up abandoned uploads using provider lifecycle rules. Multipart identifiers and keys are not authorization tokens; authorize every multipart request.

## React client

```tsx
import {
  createUploadHelpers,
  generateUploadComponents,
} from "@circulo-ai/upload/react";
import { fileRouter } from "./file-router";

const { UploadButton, UploadDropzone } = generateUploadComponents(fileRouter, {
  url: "/api/files",
});
const { useFileUpload } = createUploadHelpers(fileRouter, {
  url: "/api/files",
});

function AvatarUpload() {
  const upload = useFileUpload("avatar", {
    onUploadComplete: (files) => console.log(files),
    onUploadError: (error) => console.error(error),
  });

  return (
    <>
      <UploadButton endpoint="avatar" />
      <UploadDropzone endpoint="avatar" />
      {upload.error && <p role="alert">{upload.error.message}</p>}
    </>
  );
}
```

`uploadFiles` accepts `File[]` or `FileList`, supports `headers`, `signal`, `input`, `context`, progress callbacks, and endpoint functions such as `endpoint: (router) => "avatar"`. The client first asks the server for batch presigned URLs. If the provider cannot presign, it automatically falls back to the server-side multipart route.

## Validation and errors

```ts
import {
  validateFileSize,
  validateFileType,
  getMimeTypeFromExtension,
} from "@circulo-ai/upload";

const typeError = validateFileType("report.pdf", "application/pdf");
const sizeError = validateFileSize(file.size, 50 * 1024 * 1024);
const fallbackType = getMimeTypeFromExtension("pdf");
```

`validateFileType` checks the filename extension against the supplied MIME type. It does not inspect magic bytes, parse the file, or prove that a file is safe. For untrusted uploads, add content sniffing with an allowlisted parser, virus/malware scanning, image re-encoding, or an asynchronous quarantine workflow before making the object available.

Boundary validation errors use `UploadError` instances with a stable `code`, HTTP `status`, and optional `details`:

`UNKNOWN_CONTEXT`, `MISSING_KEY`, `NO_FILES`, `TOO_MANY_FILES`, `MISSING_ENDPOINT`, `UNKNOWN_ENDPOINT`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `MIME_TYPE_MISMATCH`, `INVALID_INPUT`, `INVALID_FILE`, `UNAUTHORIZED`, `PROVIDER_UNSUPPORTED`, `PROVIDER_UNSUPPORTED_MULTIPART`, `NOT_FOUND`, `DOWNLOAD_FAILED`, and `INTERNAL_ERROR`.

Framework adapters return `{ error, code, details? }` for known package errors and generic messages for unexpected provider failures. Log the original error through `hooks.onError` on the server; do not send provider credentials, presigned URLs, or stack traces to clients.

## Security checklist

Before production:

1. Add authentication and per-object authorization middleware to every route.
2. Keep storage credentials server-only and use least-privilege IAM/SAS keys.
3. Set proxy/framework request limits and the package `maxFileSize`/`maxFileCount` limits.
4. Use an allowlist for route MIME types and perform content scanning for untrusted files; extension/MIME checks alone are not security validation.
5. Keep presigned URL lifetimes short and configure narrow storage CORS.
6. Treat Vercel Blob's provider as public storage.
7. Serve user files as downloads by default; only enable inline display after reviewing HTML/SVG/script risks.
8. Use HTTPS/FTPS and rotate credentials. Never enable verbose FTP logging in production.
9. Use a persistent, private local directory only when the deployment model supports it; do not expose the storage directory as a static public folder.
10. Add rate limiting, quotas, audit logging, and cleanup for abandoned multipart uploads at the application/infrastructure layer.

## Configuration reference

### `FileHandlerConfig`

- `storageManager`: a `StorageManager` or lazy factory.
- `maxFileSize`: positive safe integer in bytes; defaults to 100 MiB.
- `maxDownloadSize`: positive safe integer for server-side buffered downloads; defaults to `maxFileSize`.
- `maxFileCount`: positive integer; defaults to 100.
- `validateFile`: optional server-side validation hook run for presign, batch-presign, multipart-init, and server upload phases.
- `serveUrlBuilder`: creates application URLs for local/non-presigned files.
- `verifyUploadCompletion`: required for client-triggered typed-router completion; return independently verified, authorized UploadResponse DTOs.
- `hooks.beforeUpload`, `hooks.afterUpload`, `hooks.onError`: lifecycle hooks.

### Provider key behavior

Generated keys contain a timestamp, UUID, and sanitized basename unless `preserveKey` is true. `customKey` is supported by server providers but must be a relative POSIX key no longer than 1024 characters. Empty segments, `.`/`..`, absolute paths, backslashes, and control characters are rejected. This rejection behavior is intentional: silently rewriting an unsafe key can create collisions or invalidate an authorization decision.

## License

MIT

## Infrastructure use

Prefer isolated provider imports; unused SDKs are loaded only when used:

```ts
import { S3StorageProvider } from "@circulo-ai/upload/s3";
import { detectCommonMimeType } from "@circulo-ai/upload/core";

const storage = new S3StorageProvider({
  bucket: config.bucket,
  region: config.region,
  endpoint: config.internalEndpoint,
  publicEndpoint: config.publicEndpoint,
  credentials: config.credentials,
  forcePathStyle: true,
  serverSideEncryption: "AES256",
});
const upload = await storage.generatePresignedUploadUrl({
  customKey: pending.storageKey,
  fileName: pending.fileName,
  contentType: pending.contentType,
  fileSize: pending.byteSize,
  expirationSeconds: 300,
  writeMode: "create-only",
});
// Send upload.url AND every upload.uploadHeaders entry to the browser.
const metadata = await storage.stat({ key: upload.key });
const prefix = await storage.download({
  key: upload.key,
  range: { start: 0, end: 63 },
  maxBytes: 64,
});
const detected = detectCommonMimeType(prefix);
// Compare metadata and detected with your authorized pending record.
// Drain active work before releasing resources during graceful shutdown.
storage.close();
```

The SDK-free `core` entrypoint also exports provider contracts, errors and the
manager. Use `local-signed` for signed local-development transfers; mount the URLs
in your server and keep authorization and upload-state checks in the application.
See [PRODUCTION.md](./PRODUCTION.md) for a complete integration and release guide.

## tRPC integration

Install `@trpc/server` 11.x and Zod 4, then import the optional adapter from
`@circulo-ai/upload/trpc`. Compose its schemas and resolvers into your existing
router and protected procedures; your authentication, context, transformer and
middleware remain owned by the application.

```ts
import { createTRPCFileHandlers } from "@circulo-ai/upload/trpc";

const files = createTRPCFileHandlers<AppContext>({
  storageManager,
  router: fileRouter,
  getRequest: (ctx) => ctx.req,
  authorize: ({ ctx, action, input }) =>
    mediaPolicy.authorize(ctx.actor, action, input),
  verifyUploadCompletion,
});

export const uploadRouter = t.router({
  presigned: protectedProcedure
    .input(files.schemas.presigned)
    .mutation(files.presigned),
  presignedBatch: protectedProcedure
    .input(files.schemas.presignedBatch)
    .mutation(files.presignedBatch),
  complete: protectedProcedure
    .input(files.schemas.complete)
    .mutation(files.complete),
  download: protectedProcedure
    .input(files.schemas.download)
    .query(files.download),
  delete: protectedProcedure.input(files.schemas.delete).mutation(files.delete),
  multipartInitiate: protectedProcedure
    .input(files.schemas.multipartInitiate)
    .mutation(files.multipartInitiate),
  multipartPartUrls: protectedProcedure
    .input(files.schemas.multipartPartUrls)
    .mutation(files.multipartPartUrls),
  multipartComplete: protectedProcedure
    .input(files.schemas.multipartComplete)
    .mutation(files.multipartComplete),
  multipartAbort: protectedProcedure
    .input(files.schemas.multipartAbort)
    .mutation(files.multipartAbort),
});
```

Authorization is required for every operation, including object keys and multipart
session IDs. Completion also requires independent storage verification. Upload
bytes through the signed URL or the existing HTTP upload handler; download returns
a URL rather than buffering binary data inside RPC JSON. `createTRPCFileSchemas`
customizes batch limits, and `toTRPCUploadError` maps safe transport errors while
preserving causes for server diagnostics. The adapter uses only public tRPC APIs.
See [tRPC procedures](https://trpc.io/docs/server/procedures) for protected-procedure
composition. Server calls and tests should use `router.createCaller(context)`.
