# Proposal: Decouple Runtime Configuration from the Historical Moss Path

**Status: proposal only — not approved or implemented.** This document records a bounded
technical direction for maintainers to evaluate. It does not change supported Product
behavior, configuration, or frozen Product/Risk/Contract semantics.

## Why this proposal exists

Parallax's product identity is chain-agnostic, while its current public integration is
Arbitrum Sepolia × Camelot V3. The historical Monad × Kuru × Moss code and evidence remain
valuable compatibility and regression material, but they do not represent a completed,
currently supported multi-chain product integration.

The current runtime has a coupling between that historical route and configuration/startup:

- `apps/api/src/runtime-config.ts` requires a valid `MONAD_RPC_URL` and non-empty
  `MOSS_RUNTIME_VERSION` / `MOSS_RUNTIME_REVISION` even for local Arbitrum startup.
- `MOSS_RUNTIME_PATH` is optional locally. When it is absent, the legacy Agent Flow and
  quote flow are unavailable; the Arbitrum composition can still be used.
- `apps/api` depends on `@parallax/moss-bridge` and imports its runtime-path validator.
  This package dependency is not itself proof that a Moss checkout is required for local
  Arbitrum startup.
- Separately, the current `Dockerfile` clones, checks out, installs, and builds a pinned
  Moss repository, then sets `MOSS_RUNTIME_PATH`. `render.yaml` uses that Docker build.
  Container deployment is therefore materially coupled to the historical runtime.

The objective is to make enabled runtime routes depend only on their own explicit,
validated configuration, without silently promoting historical compatibility into a
current supported route.

## Proposed configuration shape

Introduce a typed, discriminated configuration model that separates network, protocol,
and evidence-provider registration. Conceptually:

```text
routes[]:
  id
  chainId
  protocolId
  quoteAdapter
  executionProvider
  optional supplementaryEvidenceSources[]

providers:
  nativeRpc?: provider-specific validated configuration
  traceRpc?: provider-specific validated configuration
  tenderly?: provider-specific validated configuration
  moss?: provider-specific validated configuration
```

This is a design sketch, not a proposed public API schema. Provider-specific settings
must remain optional and validated only when that provider is explicitly configured for a
route. A route must resolve to a supported, explicitly selected combination; unknown or
incomplete configuration must fail closed rather than trigger implicit fallback,
provider ranking, or a broadened registry match.

## Backward compatibility

1. Keep accepting the existing environment variables during a compatibility period.
2. Normalize legacy variables into the new internal configuration only when the legacy
   route is explicitly enabled and all required values are present.
3. Preserve the current Arbitrum route and its Native RPC primary / Trace supplementary
   boundary without requiring legacy Monad/Moss environment fields.
4. Do not infer a live Moss route from placeholder version strings or a configured RPC
   URL alone; the checkout revision and loaded package identity must still be verified.
5. Deprecate old variables only after owners approve the compatibility window and the
   deployment environment has migrated. Do not rename or delete them as part of a
   documentation-only change.

## Minimum safe migration

1. **Inventory consumers.** Map each configuration field to startup validation,
   bootstrap, route composition, probes, tests, `Dockerfile`, and deployment manifests.
2. **Add a normalized config boundary.** Parse route/provider discriminants once and
   validate only the configuration needed by enabled routes. Keep the current legacy
   parser as an adapter during migration.
3. **Separate route construction.** Construct the Arbitrum route without instantiating or
   validating Moss. Construct a legacy Moss route only when explicitly selected and fully
   configured; never silently substitute providers.
4. **Prove both paths.** Test Arbitrum startup with no legacy values and the legacy route
   with its verified checkout. Keep historical fixtures and regressions unchanged.
5. **Decouple packaging.** Only after runtime imports and startup paths no longer require
   Moss should maintainers decide whether to remove the Docker clone/build step or make a
   separately versioned legacy image/route. Deployment changes require a separate
   owner-approved implementation PR.
6. **Migrate configuration.** Update deployment settings and setup docs, observe startup
   and health behavior, then deprecate compatibility fields in a later approved change.

Each phase should be reversible and separately validated; do not combine it with a
provider migration or Product semantics change.

## Required validation

- Arbitrum Sepolia × Camelot starts with only its required RPC, trusted token registry,
  and selected persistence configuration; legacy Monad/Moss fields are absent.
- An unconfigured Moss provider does not block the Arbitrum route and does not become an
  available route by default.
- An explicitly configured Moss route rejects missing paths, revision mismatches, package
  identity mismatches, and wrong chain/protocol requests before serving it.
- Incomplete, malformed, unsupported, or ambiguous route/provider configuration fails
  closed; no implicit fallback or provider selection occurs.
- Requests cannot cross-bind chain, protocol, token metadata, sender, prepared transaction,
  or pinned block across routes.
- Existing Arbitrum, Native RPC, Trace, account-state, persisted Run/recovery, and legacy
  Monad × Kuru regression tests remain appropriately scoped and green.
- Build/deployment tests prove the selected image contents and configuration; a local
  no-Moss test alone does not establish that the production Docker image is decoupled.

## Security and provenance considerations

- Keep secrets in the deployment secret store or ignored local environment; never put
  tokens, keys, credential-bearing RPC URLs, or private values in config examples, logs,
  captures, or errors.
- Pin and verify any optional runtime by immutable revision and package identity. Do not
  treat user-provided version strings as provenance proof.
- Bind each Evidence result to the selected route, exact Intent/prepared transaction,
  source, and pinned/compatible chain state. Preserve explicit checked, unknown, and
  unavailable states.
- Keep raw provider payloads inside their adapter boundary and expose only normalized,
  allowlisted Evidence and provenance.
- Do not allow configuration changes to alter Verdict semantics, upgrade UNKNOWN, or
  make Decision Registry anchoring automatic.

## Owner decisions required before implementation

- **Product:** whether the historical Monad/Kuru/Moss path remains an intentionally
  runnable compatibility route or is retained only for tests/evidence.
- **Backend:** target configuration model, migration sequence, container packaging, and
  deployment rollback plan.
- **Provider:** any retained Moss route's exact qualification, provenance, and support
  boundary.
- **Contract Owner:** review only if the migration changes a canonical shared Evidence or
  public Contract representation.

Until these decisions and a scoped implementation issue are approved, current behavior is
defined by the live code and deployment files, not by this proposal.
