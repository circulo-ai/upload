# Production contract and release qualification

This document describes the 2.x production contract. It distinguishes
tested guarantees from deployment responsibilities; it is not a certification
that every storage backend or deployment has been independently audited.

## Dordoone integration contract

Keep the application-owned media ports. Implement their adapter in infrastructure
using `@circulo-ai/upload/s3` in production and
`@circulo-ai/upload/local-signed` in development. Storage selection, credentials,
public endpoints and lifecycle ownership stay at the composition root.

Use `customKey` for the already-persisted storage key and `writeMode: "create-only"`
for user uploads. Return **all** `uploadHeaders` to the client unchanged. For S3,
both Content-Type and If-None-Match are signed. Never rewrite a presigned URL's
hostname after signing; use `publicEndpoint` instead. Configure CORS to allow PUT,
Content-Type, If-None-Match and any encryption headers. AWS documents the conditional
write semantics at https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html.

Complete an upload by reading `stat({ key })` and a bounded prefix via
`download({ key, range: { start: 0, end: 63 }, maxBytes: 64 })`. Compare size,
metadata MIME, and detected signature with your pending record before marking
the upload complete. `detectCommonMimeType` recognizes common PDF/image/video
signatures; it does not parse the complete file or scan for malicious content.
Use a parser, image re-encoding or malware scanner when your threat model needs it.

The default S3 and local buffered read limit is 100 MiB. Set a smaller application
limit or `maxDownloadBytes` as appropriate. S3 network defaults are three total
attempts, a 10-second connection timeout, and a 30-second request timeout. These
bound individual SDK requests; they are not a deadline for a multi-step use case.
`serverSideEncryption` supports AES256 and aws:kms; `kmsKeyId` requires aws:kms.
Encryption and public-endpoint behavior also need validation against your selected
production provider, KMS policy and network topology.

Trusted maintenance uploads may set `cacheControl` and use explicit overwrite
semantics. User uploads must not overwrite verified content. Keep metadata,
ownership, link records and upload state in the application database. The package
does not provide that database, authorization policy, transaction, quota or outbox.

## Signed local transfers

`SignedLocalStorageProvider` generates URLs containing `token` and `signature`.
Mount the configured `uploadPath` and `downloadPath` in your server; they are not
automatically public routes. Pass the token, signature, actual Content-Type, and a
Buffer or Node Readable to `acceptSignedUpload`. Use `readSignedObject` for reads.

Signatures bind the purpose, canonical key, expiry, content type and expected byte
size. An upload cannot overwrite an existing object. A stream exceeding the signed
size is destroyed, and partial uploads are not published. A token is a bearer
credential: never log it or a signed URL. Deleting an object while its upload URL
is still valid can allow that URL to recreate it; application upload state must
govern acceptance if strictly one-time consumption is needed.

Use a dedicated, randomly generated signing secret with at least 32 bytes of
entropy. Changing the secret invalidates outstanding URLs. Set short TTLs and
`maxUploadBytes`. HTTP is supported for local development; serve production
transfers over your normal secure application endpoint.

Local storage publishes create-only objects using an atomic filesystem hard link.
There is no unsafe check-then-write fallback. A filesystem without hard-link support
must fail the operation. Overwrite writes use atomic rename. MIME metadata lives
in a reserved `.circulo-upload` directory and is unavailable to object-key reads.
Existing files without metadata return a null MIME; migrate/verify their metadata
explicitly rather than trusting a filename. The metadata sidecar and file are not
a transactional database; consumers may briefly observe a null MIME during upload.

Own the configured directory exclusively. Real-path checks reject traversal and
existing symlink escapes, and reads use O_NOFOLLOW when available, but filesystem
path checks cannot defend against an adversarial local process swapping ancestor
directories concurrently. Untrusted users/processes must not modify storage paths.
Do not serve the directory as public static content. Use a local provider's
returned key unchanged; prefixes are not applied twice.

## Capabilities and lifecycle

| Provider      | Exact-key presign | Create-only write                 | Metadata/range reads    | Real backend verified here |
| ------------- | ----------------- | --------------------------------- | ----------------------- | -------------------------- |
| S3 compatible | Yes               | Yes, signed PUT or trusted upload | Yes                     | MinIO                      |
| Local         | No                | Yes                               | Yes                     | Local filesystem           |
| Signed local  | Yes               | Always create-only                | Yes                     | Local filesystem           |
| Azure         | Yes               | Unsupported in this API           | Unsupported in this API | No; mocked multipart tests |
| FTP/FTPS      | No                | Unsupported                       | Unsupported             | No; client contract tests  |
| Vercel Blob   | No                | Unsupported                       | Unsupported             | No; mocked stream tests    |

Unsupported range/create-only requests fail explicitly; they never silently
weaken the requested policy. Azure multipart uses a pending blob, checks session
metadata before completion/abort, preserves content type and conditions mutation
on its ETag. Pending blobs must remain inaccessible until application completion.
Production Azure, FTP and Vercel deployments need their own credentialed contract
tests, topology validation and operational monitoring before being qualified.

S3 `close()` releases internal and signing clients once and rejects later operations.
`StorageManager.close()` closes initialized providers once, skips unused lazy
factories, attempts all closes and preserves failures in an AggregateError. Own a
manager's providers exclusively; do not close resources still owned by another
live manager. Close only after draining active operations. SDKs load lazily, so
importing the root or a provider subpath does not require unused optional SDKs.

## Breaking security changes

- Client-triggered typed-router completion now requires `verifyUploadCompletion`.
  Verify the pending record, authenticated owner, expiry, object metadata and
  content, then return authoritative UploadResponse DTOs. Business callbacks run
  only on those verified DTOs. Server-side uploads still complete directly.
- Storage keys reject Windows device names, alternate data streams, forbidden
  filesystem characters and trailing spaces/dots. Audit existing keys before
  upgrade; never silently rename persisted objects.
- Buffered provider downloads now have a 100 MiB default limit. Applications
  needing larger buffers must explicitly configure an appropriate bounded limit.
- Azure abort errors are propagated and multipart session mismatches are rejected.
- Vercel Blob is now an optional peer, matching other provider SDKs. Install
  `@vercel/blob` explicitly when using that provider.

These changes require a major upgrade from 1.x. Review persisted keys, completion
handlers and buffer limits before upgrading.

## Verification and release

Run `bun run check:release` in this package. It requires typecheck, lint, the unit
suite, ESM/CJS declaration builds, and actual packed-tarball consumer tests under
Node and Bun with **no** optional dependencies installed. `bun run test` skips
external integration tests unless explicitly configured; `test:integration`
instead fails when configuration is absent, preventing a silent release check.

For the S3 contract suite, use a disposable local MinIO instance (synthetic
credentials only):

```sh
docker run -d --name circulo-upload-contract \
  -p 127.0.0.1:19007:9000 \
  -e MINIO_ROOT_USER=upload-test \
  -e MINIO_ROOT_PASSWORD=upload-test-password \
  minio/minio:RELEASE.2025-09-07T16-13-09Z server /data
UPLOAD_S3_TEST_ENDPOINT=http://127.0.0.1:19007 bun run test:integration
docker rm -f circulo-upload-contract
```

In PowerShell set `$env:UPLOAD_S3_TEST_ENDPOINT='http://127.0.0.1:19007'` before
running the test command. The tests create a unique bucket and remove their
objects/bucket; the container must also be removed after verification.

CI runs the release and MinIO checks on Node 18, 22 and 24 plus Bun. Node 18 is a
compatibility target; choose a supported LTS release for production. Releases use
Changesets on `master` and `.github/workflows/release-publish.yml`. That workflow
requires the package and MinIO checks before publishing through npm trusted
publishing with GitHub OIDC; no long-lived npm token is used. `bun run release`
dispatches that workflow through an authenticated GitHub CLI. Add a Changeset,
merge the implementation PR, then review and merge the generated version PR.
Configure npm's trusted publisher for this exact repository and workflow filename.
Production-provider qualification, dependency advisory review and an application
adapter contract test remain deployment responsibilities.
