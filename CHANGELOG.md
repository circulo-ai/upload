# Changelog

## 2.0.0

### Major Changes

- c27a8eb: Add exact-key and create-only S3 presigning, metadata and bounded range reads,
  encryption, public signing endpoints, network limits and managed shutdown. Add
  signed local transfers with atomic create-only storage and MIME metadata. Isolate
  optional SDK loading and expose provider/core subpaths with ESM/CJS declarations.

  Harden client completion by requiring an application verification hook before
  business callbacks. Reject cross-platform filesystem aliases and unsupported
  write guarantees, bound buffered downloads, and protect Azure multipart sessions.
  See packages/upload/PRODUCTION.md for upgrade responsibilities and qualification.

  Add an optional tRPC 11 adapter with composable typed resolvers, bounded Zod
  schemas, required authorization, verified completion and safe error mapping.
  Separate capability contracts, route builders and policy modules; move all tests
  outside source, add API inference checks and bound ordered batch concurrency.
  Require Node 22 or newer and patched AWS/FTP peers; make Vercel Blob an optional
  peer so unused provider SDKs are neither installed nor loaded by the core package.

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
