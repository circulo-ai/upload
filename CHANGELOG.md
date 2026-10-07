# Changelog

## Unreleased (major)

- Add exact-key/create-only S3 presigning, stat/range reads, encryption, public endpoints, bounded network/read behavior and shutdown.
- Add atomic create-only local storage with MIME metadata and signed transfer URLs.
- Add lazy optional SDK loading, isolated subpaths and correct ESM/CJS declaration conditions.
- Require verification of client-triggered completion, reject filesystem aliases and protect Azure multipart sessions.
- Add packed-consumer tests, MinIO contract tests and a dedicated runtime CI matrix.
- See PRODUCTION.md for migration requirements and tested/provider qualification limits.

## 1.7.0

### Minor Changes

- bd08de9: Harden upload keys, local storage writes, multipart validation, presigned URL lifetimes, served-file headers, and client error handling. Expand the package README with the production security model, provider capabilities, route API, and deployment checklist.

## 1.6.0

### Minor Changes

- Release the accumulated public-package improvements, including the upload
  provider adapters, FTP/FTPS support, typed file routers, React upload helpers,
  and the associated runtime and developer-experience updates.

## 1.5.3

### Patch Changes

- 8bbbe7e: Ship the production-ready workflow, dependency-injection, file-parsing, and upload runtime improvements together with their validated build and test tooling.

## 1.2.0

### Minor Changes

- f02b12a: Added vercel blob support to upload providers

## 1.1.1

### Patch Changes

- b7b0814: Fixed Readme

## 1.1.0

### Minor Changes

- 2b6380b: Minor updates

## 1.0.0

### Major Changes

- Initial release
