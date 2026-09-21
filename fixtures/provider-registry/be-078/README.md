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
