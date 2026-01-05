# @circulo-ai/upload

A type-safe, multi-provider file upload framework for Node.js and Next.js,
with first-class support for presigned URLs and multipart uploads.

## Features

- 🧠 **Type-safe storage contexts**: compile-time safety when routing files
  across multiple buckets, containers, or backends.
- 🌐 **Multi-provider support**: AWS S3, Azure Blob, Local storage, Vercel Blob
- 🪣 **Multi-bucket/container**: Organize files across different storage contexts
- 📦 **Multipart uploads**: Large file support with resumable uploads
- 🔐 **Presigned URLs**: Direct client-to-storage uploads
- 📝 **TypeScript**: Full type safety with generics
- 🎯 **Zero dependencies**: Only peer dependencies for storage providers you use
- 🔒 **Secure**: Built-in path traversal protection and filename sanitization
- 🧩 **Extensible**: Lifecycle hooks and structured errors for predictable DX

## Installation

```bash
npm install @circulo-ai/upload

# Install the storage provider(s) you need:
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner    # For S3
npm install @azure/storage-blob                                 # For Azure Blob
# Local storage has no dependencies
```

## Core Concepts

- **StorageProvider**: low-level adapter for one backend (S3, Azure Blob, Vercel Blob, Local). Use directly for single-bucket/simple cases.
- **StorageManager** (recommended): orchestrates multiple named providers/contexts (e.g., `uploads`, `public`, `temp`) with shared helpers (presign, multipart) and type-safe context selection.
- **Route adapters**: `@circulo-ai/upload/next` and `@circulo-ai/upload/hono` expose HTTP handlers for uploads, presigned URLs, multipart, and serving files.

### Environment Compatibility

| Surface                           | Supported | Notes                                                                   |
| --------------------------------- | --------- | ----------------------------------------------------------------------- |
| Node.js (server)                  | ✅        | Primary target                                                          |
| Edge runtimes (Vercel/Cloudflare) | ⚠️        | Depends on provider; Local/S3 presign need Node APIs, Vercel Blob works |
| Browser                           | ⚠️        | Use presigned URLs or route adapters; providers are server-side only    |

## Quick Start

### Single Storage Provider

```typescript
import { S3StorageProvider } from "@circulo-ai/upload";

const storage = new S3StorageProvider({
  bucket: "my-bucket",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Upload a file
const result = await storage.upload({
  file: buffer,
  fileName: "document.pdf",
  contentType: "application/pdf",
});

console.log(result.key); // Storage key
console.log(result.path); // Serve path
```

### Multiple Storage Contexts (Recommended)

```typescript
import {
  StorageManager,
  S3StorageProvider,
  LocalStorageProvider,
} from "@circulo-ai/upload";

// Define your storage contexts
type MyContexts = "user-uploads" | "public-assets" | "temp-files";

const manager = new StorageManager<MyContexts>({
  providers: {
    "user-uploads": new S3StorageProvider({
      bucket: "user-files",
      region: "us-east-1",
    }),
    "public-assets": new S3StorageProvider({
      bucket: "public-cdn",
      region: "us-east-1",
    }),
    "temp-files": new LocalStorageProvider({
      basePath: "./temp",
    }),
  },
  defaultContext: "user-uploads",
});

// Upload to specific context
await manager.upload({
  file: buffer,
  fileName: "avatar.png",
  contentType: "image/png",
  context: "user-uploads", // Type-safe context
});

// Download from context
const file = await manager.download({
  key: "avatar.png",
  context: "user-uploads",
});
```

## API Reference

### Storage Providers

#### S3StorageProvider

```typescript
import { S3StorageProvider } from "@circulo-ai/upload";

const s3 = new S3StorageProvider({
  bucket: "my-bucket",
  region: "us-east-1",

  // Optional: For S3-compatible services (MinIO, R2, etc.)
  endpoint: "https://s3.example.com",
  forcePathStyle: true,

  // Optional: Explicit credentials (uses AWS credential chain if omitted)
  credentials: {
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
  },

  // Optional: Path prefix within bucket
  pathPrefix: "uploads",
});
```

#### AzureBlobStorageProvider

```typescript
import { AzureBlobStorageProvider } from "@circulo-ai/upload";

const blob = new AzureBlobStorageProvider({
  containerName: "my-container",
  accountName: "myaccount",
  accountKey: "KEY",

  // Or use connection string
  connectionString: "DefaultEndpointsProtocol=https;...",

  // Optional: Path prefix within container
  pathPrefix: "uploads",
});
```

#### LocalStorageProvider

```typescript
import { LocalStorageProvider } from "@circulo-ai/upload";

const local = new LocalStorageProvider({
  basePath: "./uploads",

  // Optional: Path prefix within base path
  pathPrefix: "files",

  // Optional: Custom serve base URL
  serveBaseUrl: "/api/files",
});
```

#### Vercel Blob

```typescript
import { VercelBlobStorageProvider } from "@circulo-ai/upload";
import type { NextRequest } from "next/server";

const storage = new VercelBlobStorageProvider({
  // Often unnecessary on Vercel; SDK uses BLOB_READ_WRITE_TOKEN by default
  // token: process.env.BLOB_READ_WRITE_TOKEN,
  pathPrefix: "uploads",
  multipart: true, // let Vercel handle big uploads
});

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response("file is required", { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const info = await storage.upload({
    file: buffer,
    fileName: file.name,
    contentType: file.type,
  });

  return Response.json(info);
}
```

### StorageManager

```typescript
import { StorageManager } from "@circulo-ai/upload";

type Contexts = "primary" | "backup" | "cache";

const manager = new StorageManager<Contexts>({
  providers: {
    primary: s3Provider,
    backup: blobProvider,
    cache: localProvider,
  },
  defaultContext: "primary",
});

// Upload
await manager.upload({
  file: buffer,
  fileName: "file.pdf",
  contentType: "application/pdf",
  context: "primary", // Optional, uses default if omitted
  customKey: "custom-key", // Optional
  preserveKey: false, // Optional, skip timestamp prefix
  metadata: { userId: "123" }, // Optional
});

// Download
const buffer = await manager.download({
  key: "file-key",
  context: "primary",
});

// Delete
await manager.delete({
  key: "file-key",
  context: "primary",
});

// Presigned URLs (for cloud providers)
const { url, key } = await manager.generatePresignedUploadUrl({
  fileName: "upload.pdf",
  contentType: "application/pdf",
  fileSize: 1024000,
  context: "primary",
  expirationSeconds: 3600, // Optional
});

const downloadUrl = await manager.generatePresignedDownloadUrl({
  key: "file-key",
  context: "primary",
  expirationSeconds: 3600,
});
```

### Multipart Uploads

For large files (>5MB recommended):

```typescript
// 1. Initiate
const { uploadId, key } = await manager.initiateMultipartUpload({
  fileName: "large-file.zip",
  contentType: "application/zip",
  fileSize: 100 * 1024 * 1024, // 100MB
  context: "primary",
});

// 2. Get URLs for parts (e.g., 5MB chunks)
const partUrls = await manager.getMultipartPartUrls({
  uploadId,
  key,
  partNumbers: [1, 2, 3, 4], // Upload 4 parts
  context: "primary",
});

// 3. Upload parts (client-side)
const parts = await Promise.all(
  partUrls.map(async ({ partNumber, url }) => {
    const response = await fetch(url, {
      method: "PUT",
      body: partData[partNumber],
    });
    return {
      PartNumber: partNumber,
      ETag: response.headers.get("ETag"),
    };
  }),
);

// 4. Complete
const result = await manager.completeMultipartUpload({
  uploadId,
  key,
  parts,
  context: "primary",
});

// Or abort if needed
await manager.abortMultipartUpload({
  uploadId,
  key,
  context: "primary",
});
```

### Route handlers, hooks, and errors

`FileRouteHandler` lets you plug in logging/analytics and get consistent error codes from the generated Next.js/Hono routes.

```typescript
import { FileRouteHandler } from "@circulo-ai/upload";

const handler = new FileRouteHandler({
  storageManager: manager,
  hooks: {
    beforeUpload: (file, context) =>
      console.log("uploading", file.name, context),
    afterUpload: (upload, context) =>
      console.log("uploaded", upload.key, context),
    onError: (error, context) =>
      console.error("upload error", { error, context }),
  },
});
```

Errors are instances of `UploadError` (also exported) and the HTTP responses from `createNextFileHandler` / `createHonoFileRoutes` are shaped like:

```json
{
  "error": "File size ...",
  "code": "FILE_TOO_LARGE",
  "details": { "maxSize": 104857600 }
}
```

### Browser → API → Storage flow (presigned example)

```typescript
// client (browser)
async function uploadFile(file: File) {
  const presign = await fetch("/api/files/presigned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
    }),
  }).then((r) => r.json());

  await fetch(presign.presignedUrl, {
    method: "PUT",
    headers: presign.uploadHeaders,
    body: file,
  });

  return presign.fileInfo; // contains stable serve path + key
}
```

### Custom file validation

Use the `validateFile` hook on `FileRouteHandler` to enforce your own rules. Return `null` to allow, or a `FileValidationError`/`UploadError` to block.

```typescript
import { FileRouteHandler, UploadError } from "@circulo-ai/upload";

const handler = new FileRouteHandler({
  storageManager: manager,
  validateFile: ({ fileName, contentType, fileSize, context, phase }) => {
    if (fileSize > 50 * 1024 * 1024) {
      return new UploadError("FILE_TOO_LARGE", "Max 50MB");
    }
    if (context === "avatars" && !contentType.startsWith("image/")) {
      return {
        code: "UNSUPPORTED_FILE_TYPE",
        message: "Only images are allowed for avatars",
        supportedTypes: ["image/jpeg", "image/png", "image/webp"],
      };
    }
    return null;
  },
});
```

### Security & Safety

- **Max size**: default 100 MB (`MAX_FILE_SIZE`), enforced for uploads/presigns/multipart.
- **Type checks**: optional MIME/extension validation (not content sniffing)
- **Path traversal**: Local provider sanitizes keys and enforces base directory boundaries.
- **Header hygiene**: Filenames sanitized before `Content-Disposition`; metadata sanitized per provider.
- **Public vs private**: Presigned URLs give time-limited access; Local fallback uses server-side `serve` route.
- **Hooks**: Use `onError`/`beforeUpload` to log/audit/deny suspicious uploads.

### Validation Utilities

```typescript
import {
  validateFileType,
  validateFileSize,
  formatFileSize,
  getFileExtension,
} from "@circulo-ai/upload";

// Validate file type
const error = validateFileType("document.pdf", "application/pdf");
if (error) {
  console.error(error.message);
}

// Validate size
const sizeError = validateFileSize(fileSize, 100 * 1024 * 1024);

// Format size
console.log(formatFileSize(1536000)); // "1.5 MB"

// Get extension
const ext = getFileExtension("photo.jpg"); // "jpg"
```

### Next.js route handler

Add a catch-all route (e.g., `app/api/files/[...path]/route.ts`) and point both `GET` and `POST` to the generated handler.

```typescript
import { LocalStorageProvider, StorageManager } from "@circulo-ai/upload";
import { createNextFileHandler } from "@circulo-ai/upload/next";

const handler = createNextFileHandler({
  storageManager: new StorageManager({
    providers: {
      uploads: new LocalStorageProvider({ basePath: "./uploads" }),
    },
    defaultContext: "uploads",
  }),
});

export const GET = handler;
export const POST = handler;
```

If you need to delay initialization (for example, to avoid missing env values during `next build`),
pass factories instead of concrete instances:

```typescript
const handler = createNextFileHandler({
  storageManager: () =>
    new StorageManager({
      providers: {
        uploads: () => new LocalStorageProvider({ basePath: "./uploads" }),
      },
      defaultContext: "uploads",
    }),
});

export const GET = handler;
export const POST = handler;
```

Available paths under that route:

- `POST /delete` – delete by key (JSON: `{ key, context? }`)
- `POST /download` – get a download URL (JSON: `{ key, name?, context? }`)
- `POST /presigned` – single upload URL (JSON: `{ fileName, contentType, fileSize }`, query `type`/`context`)
- `POST /presigned/batch` – multiple upload URLs (JSON: `{ files: [...] }`, query `type`)
- `POST /multipart?action=initiate|get-part-urls|complete|abort` – multipart helpers
- `POST /upload` – multipart form with `file` field
- `GET /serve/:key` – stream file contents (optional `context` query)

If you keep a dedicated file for one route (for example, `/presigned`), pass `defaultRoute: "presigned"` when creating the handler.

## Configuration Examples

### AWS S3 with Environment Variables

```typescript
const s3 = new S3StorageProvider({
  bucket: process.env.S3_BUCKET!,
  region: process.env.AWS_REGION!,
  // Credentials automatically loaded from environment or IAM role
});
```

### Cloudflare R2

```typescript
const r2 = new S3StorageProvider({
  bucket: "my-r2-bucket",
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
```

### MinIO

```typescript
const minio = new S3StorageProvider({
  bucket: "my-bucket",
  region: "us-east-1",
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
  },
});
```

## When This May Not Be a Fit

- You only need a simple `<input type="file">` + form POST
- You want a hosted upload widget / UI
- You need built-in virus scanning or media processing

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.
