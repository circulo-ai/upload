// src/index.ts

// Core types
export type {
FileInfo,
FileMetadata,
UploadOptions,
DownloadOptions,
DeleteOptions,
PresignedUploadUrlOptions,
PresignedDownloadUrlOptions,
PresignedUrlResponse,
S3UploadPart,
AzureUploadPart,
UploadPart,
MultipartInitResponse,
MultipartPartUrl,
MultipartInitOptions,
MultipartPartUrlsOptions,
MultipartCompleteOptions,
MultipartAbortOptions,
MultipartCompleteResponse,
ContentType,
FileValidationError,
SupportedDocumentExtension,
SupportedAudioExtension,
SupportedVideoExtension,
SupportedMediaExtension,
} from './types/core.js';

export {
SUPPORTED_DOCUMENT_EXTENSIONS,
SUPPORTED_AUDIO_EXTENSIONS,
SUPPORTED_VIDEO_EXTENSIONS,
MAX_FILE_SIZE,
} from './types/core.js';

// Provider interfaces and base classes
export { StorageProvider, BaseStorageProvider } from './providers/base.js';

// Provider implementations
export { S3StorageProvider, type S3Config } from './providers/s3.js';
export {
AzureBlobStorageProvider,
type AzureBlobConfig,
} from './providers/azure-blob.js';
export {
LocalStorageProvider,
type LocalStorageConfig,
} from './providers/local.js';

// Storage manager
export {
StorageManager,
type StorageManagerConfig,
type ContextualUploadOptions,
type ContextualDownloadOptions,
type ContextualDeleteOptions,
type ContextualPresignedUploadUrlOptions,
type ContextualPresignedDownloadUrlOptions,
type ContextualMultipartInitOptions,
type ContextualMultipartPartUrlsOptions,
type ContextualMultipartCompleteOptions,
type ContextualMultipartAbortOptions,
} from './storage-manager.js';

// Utilities
export {
getContentType,
isSupportedMimeType,
getFileExtension,
getMimeTypeFromExtension,
validateFileType,
validateFileSize,
formatFileSize,
MIME_TYPE_MAPPING,
SUPPORTED_MIME_TYPES,
SUPPORTED_AUDIO_MIME_TYPES,
SUPPORTED_VIDEO_MIME_TYPES,
} from './utils/validation.js';

export {
sanitizeFilename,
isValidUrl,
bufferToBase64,
base64ToBuffer,
} from './utils/security.js';

// ============================================================================
// README.md
// ============================================================================

# @circulo-ai/upload

Universal file upload library with support for AWS S3, Azure Blob Storage, and local file system.

## Features

- 🌐 **Multi-provider support**: AWS S3, Azure Blob, Local storage
- 🪣 **Multi-bucket/container**: Organize files across different storage contexts
- 📦 **Multipart uploads**: Large file support with resumable uploads
- 🔐 **Presigned URLs**: Direct client-to-storage uploads
- 📝 **TypeScript**: Full type safety with generics
- 🎯 **Zero dependencies**: Only peer dependencies for storage providers you use
- 🔒 **Secure**: Built-in path traversal protection and filename sanitization

## Installation

```bash
npm install @circulo-ai/upload

# Install the storage provider(s) you need:
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner  # For S3
npm install @azure/storage-blob                                 # For Azure Blob
# Local storage has no dependencies
```

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
  })
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

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.
