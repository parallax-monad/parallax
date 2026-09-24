# BE-078 canonical NativeRpcProvider exercise

This fixture area records the independent, real execution of the accepted BE-063 / PR #77
unsigned Camelot transaction through the concrete `NativeRpcProvider` and its public
`evaluateProviderAdapter` boundary. The runner pins the exact transaction to the accepted
block, requires the RPC-observed block hash to match, and writes a new timestamped capture
only after chain/block identity and `eth_call` match the accepted observations and
`eth_estimateGas` returns an observed positive estimate. Estimates may differ between
RPC implementations: the capture retains the actual estimate, historical estimate,
and their difference without treating equality as an execution requirement.

Run from the repository root:

```bash
pnpm --filter @parallax/api probe:native-rpc-canonical
```

The default endpoint is the keyless official Arbitrum Sepolia public RPC. To use an
archive-capable endpoint for the accepted historical block, set
`ARBITRUM_SEPOLIA_RPC_URL` in the process environment or in the worktree-root `.env`
before running the command. The `.env` file is ignored by Git. The endpoint value is never
written into the capture. Failed or incomplete runs do not create a PASS fixture.

V2 captures include `sourceProvenance`: the repository HEAD, dirty-worktree flag,
Node version, and a SHA-256 manifest of Backend runtime source, Contracts source,
the runner/helpers, and dependency/build configuration. HEAD identifies the base
checkout when `worktreeDirty` is true; the file hashes identify the executed working
tree. Source and canonical fixture changes during execution fail closed. The manifest
excludes local environment files and stores no file contents or credentials.

The preparation block has a number and hash; its on-chain timestamp is used only
to validate the historical deadline, never as `observedAt`. The Provider records
the actual evaluation observation time separately. Freshness remains `not_checked`.

The original V1 capture `native-rpc-canonical-2026-09-21T11-54-00-618Z` is retained
as historical evidence. It was collected from the uncommitted working tree later
committed as `365bcb3`; its recorded `b80ed60` HEAD lacks the runner and builder.
Its preparation `observedAt` was derived from block production time and must not
be used as observation-time evidence. Use the V2 capture for corrected provenance.

Corrected V2 evidence: [2026-09-21 read-only PASS](native-rpc-canonical-2026-09-21T12-13-23-953Z/capture.json).
This capture records the dirty working tree based on `365bcb3`, with 51 source/configuration
file hashes. Both the observed and historical gas estimates are `272052`.

This is a read-only provider exercise. A PASS confirms only the concrete Provider's
verified chain/block, pinned `eth_call`, and pinned gas estimate. It does not claim a
receipt, state diff, Risk verdict, signed transaction, broadcast, or full Backend Demo
Gate acceptance.

## Independent assembled Backend Golden Path exercise

The assembled Backend/API path is exercised separately by:

```bash
pnpm --filter @parallax/api probe:backend-golden-path
```

The runner requires the exact local `origin/main` HEAD, uses the accepted BE-063
baseline as an explicit Expectation Baseline, starts an injected production Arbitrum
composition, and performs a real read-only `POST /api/check` followed by
`GET /api/runs/:runId`. It records the submitted request, baseline identity, Provider
Evidence summary, public Run round-trip hashes, redaction checks, and a SHA-256 manifest
of the loaded Backend/runtime source. The manifest is checked again after execution so
local runtime edits cannot be mistaken for exact-main evidence. No signing, broadcasting,
custody, or raw RPC payload is captured.

`EXERCISE_COMPLETE_REVIEW_REQUIRED` means the assembled HTTP/pipeline path completed
and its public boundaries passed the runner assertions; it is not an automatic Product
Gate approval. With the current Native RPC surface, incomplete receipt/outcome/state
Evidence is expected to remain fail-closed: `quoteFidelity=UNKNOWN`,
`evidenceState=INCOMPLETE`, and `verdict=UNKNOWN` are recorded as the truthful result.
Remediation is reported from the actual P0 result; this runner does not configure an
explicit bounded remediation request, so `NOT_RUN` must not be interpreted as a solver
failure. The final acceptance still requires Product/owner review of the capture.

Final assembled exercise capture:

- [2026-09-22 read-only exercise](backend-golden-path-20260922032144325/capture.json)

## Alternative QuickNode trace capability exercise

Run from the repository root:

```bash
pnpm --filter @parallax/api probe:quicknode-canonical
```

This is a read-only Arbitrum Sepolia capability exercise against the accepted BE-063
Camelot transaction. It first passes the existing NativeRpcProvider canonical checks,
then observes `debug_traceCall` using `callTracer` and `prestateTracer` with diff mode.

The RPC endpoint is supplied through `ARBITRUM_SEPOLIA_RPC_URL` and is never persisted.
Raw trace payloads are not stored; only bounded observations and SHA-256 digests are
written. Supply the endpoint locally and run this probe with Node 22.x; the runner refuses
other Node versions before making an RPC call. An existing local Node 22 binary can be
selected through the command's `PATH` without changing the repository or global Node.
The capture records Node's DNS result order. On a network where the endpoint's IPv4
route resets connections, `NODE_OPTIONS=--dns-result-order=ipv6first` can select its
working IPv6 route for this command.

A PASS is alternative endpoint capability evidence only. It does not replace or qualify
Tenderly, change production Provider selection, alter the Evidence Contract, or claim
signing, broadcast, custody, Risk acceptance, or Product Demo Gate acceptance.

Observed read-only capture: [2026-09-24 QuickNode capability exercise](quicknode-canonical-2026-09-24T14-28-41-070Z/capture.json).
It records Node `v22.23.2`, `ipv6first` DNS ordering, the accepted BE-063 fixture digest,
the pinned block and exact unsigned transaction, canonical Provider observations, and
bounded call and state-diff trace summaries. The recorded base HEAD had task-local
changes, so the source manifest and runner digest identify the executed working tree.
