# Package architecture

The package separates storage capabilities, orchestration, provider I/O, transport
adapters and React integration. Applications own authorization, upload state,
quotas, persistence and composition. No global container or environment-based
provider selection is hidden inside the package.

## Source organization

| Directory                    | Responsibility                                                       |
| ---------------------------- | -------------------------------------------------------------------- |
| `src/types`                  | Storage, multipart, validation and transport contracts               |
| `src/providers/contracts.ts` | Small structural capability interfaces and guards                    |
| `src/providers`              | Concrete provider adapters and optional convenience base class       |
| `src/storage-manager.ts`     | Typed context registry, lazy factories, batching and lifecycle       |
| `src/routing`                | Immutable typed route builder and pure route policies                |
| `src/routes`                 | Delivery handlers and Hono/Next adapters                             |
| `src/react.tsx`              | React client integration                                             |
| `src/utils`                  | Cohesive internal validation, bounded streams, signing/key utilities |
| `tests/unit`                 | Deterministic unit and mocked provider contract tests                |
| `tests/integration`          | Explicitly configured real backend contract tests                    |
| `tests/types`                | Compile-time API inference and invalid-input expectations            |
| `scripts`                    | Packed consumer and integration release checks                       |

The old `router.ts` and `types/core.ts` entrypoints remain compatibility barrels.
Use `@circulo-ai/upload/core` for framework-independent orchestration and contracts,
provider subpaths for storage, and `/hono`, `/next`, `/trpc` or `/react` at delivery edges.
ESM and CommonJS exports have matching declarations. Optional SDKs load only when
their provider is used; importing the root does not load every SDK.

## Extension and configuration

Implement `StorageProvider` structurally or extend `BaseStorageProvider` when its
key-generation helpers are useful. Interfaces such as `ObjectMetadataReader`,
`PresignedUrlProvider` and `StorageLifecycle` express optional capabilities. The
manager checks advertised capabilities and method presence before dispatch.
Unsupported policies must fail explicitly. Do not emulate create-only writes with
a non-atomic existence check.

Supply provider instances or lazy factories to `StorageManager`. Context names are
inferred from the registry; `defaultContext` cannot narrow the registry's keys.
Registry configuration is copied. `batchConcurrency` defaults to eight, preserves
result order and drains active work after a failure before rejecting. This bound
is per batch, not an application-wide admission controller. Applications can add
their own shared concurrency and quota policies around the manager.

S3 accepts explicit credentials, an async refreshing credential provider, or the
SDK's default chain. Provider options expose endpoints, timeouts, retries,
encryption and buffer limits. Configuration is captured at construction; resource
owners drain operations and call `close()` during shutdown.

## Types and trust boundaries

Strict TypeScript, indexed-access checks and explicit overrides protect source and
tests. Route parser inputs flow into middleware, and middleware metadata flows
into completion callbacks. Runtime route erasure stays at the delivery boundary;
public contracts do not use `any`. Builder order is enforced at runtime to keep
those inferred types consistent with the installed handlers.

Client completion claims are untrusted. `verifyUploadCompletion` returns verified
DTOs before business callbacks run. Storage signatures and file signatures cannot
replace application authorization or full content validation. See
[PRODUCTION.md](./PRODUCTION.md) for policy guarantees and backend qualification.

## Release discipline

Tests live outside source and are excluded from build artifacts. `check:release`
checks source and test types, lint, unit tests, declarations and real tarball
consumers without optional SDKs. CI also runs disposable MinIO contracts. Changes
that tighten accepted keys, completion behavior or download bounds require a major
Changeset. GitHub's existing release workflow versions and publishes through OIDC.
