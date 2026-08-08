# Moss Kuru Live Runtime (Reproducible Environment Contract)

Status: REPRODUCIBLE RUNTIME LOCKED ON `main` (`d09b38c…`); LIVE ACCEPTANCE NOT
CLAIMED — PENDING MOSS PR #23 FOR APPROVED PIN `ef15448…`

This document pins the exact Moss runtime that the Kuru MON → USDC live adapter
(`packages/moss-bridge/src/live-kuru.ts`) targets, and the exact environment
needed to reproduce it. It supersedes the earlier "recorded workspace baseline"
identity: every `@themoss/*` package below is an exact version inside an exact
Moss git commit, not a workspace label.

## Integration status (2026-08-08)

The matrix below still describes the **published `main` baseline**
(`d09b38cbc44ee7f5722c5d09e7224f7750187762`), including FlipOrderUpdated and
pinned-block gaps that keep Live SUCCESS unclaimed on `main`.

Separately, Parallax has approved Moss pin
`ef15448e166f31c891e80dba5073dae04a052a2b` for the Live path. That pin and the
verified Mainnet Live Simulation landing are tracked in
[PR #23](https://github.com/parallax-monad/parallax/pull/23). Until #23 merges:

- do not treat `ef15448…` as the published runtime in this document's matrix;
- do not claim Live Kuru MON → USDC SUCCESS from API handoff or acceptance;
- keep fail-closed Live / `UNSUPPORTED` without a verified checkout.

After #23 merges, Moss Owner updates this matrix and reproduce steps; API
handoff then refreshes the Live SUCCESS claim boundary.

## Runtime Matrix

| Item | Recorded baseline | Current pinned runtime | Evidence |
| --- | --- | --- | --- |
| Moss repository | `https://github.com/nishuzumi/moss.git` (upstream) | same (upstream); local fork `https://github.com/jzhao0/moss.git` | `git remote -v` |
| Moss commit | `d09b38cbc44ee7f5722c5d09e7224f7750187762` | `d09b38cbc44ee7f5722c5d09e7224f7750187762` (local fork `main`) | `git cat-file -t d09b38c…` → `commit`; `git rev-parse main` |
| `@themoss/core` | 0.1.0 (workspace) | 0.1.0 | `git show d09b38c…:packages/core/package.json` |
| `@themoss/erc` | 0.1.0 (workspace) | 0.1.0 | same path `packages/erc/package.json` |
| `@themoss/protocol-kuru` | 0.1.0 (workspace, `packages/protocols/kuru`) | 0.1.0 | same path `packages/protocols/kuru/package.json` |
| `@themoss/simulator` | 0.1.0 (workspace) | 0.1.0 | same path `packages/simulator/package.json` |
| `@themoss/system` | 0.1.0 (workspace) | 0.1.0 | same path `packages/system/package.json` |
| Published npm identity | 0.1.0, but **Plan-based API**, not matching Capability/Receipt baseline | NOT USED (API mismatch verified again on 2026-08-03) | `npm view @themoss/core@0.1.0`; packed `dist/index.d.ts` exports `plan`/`finalizePlan`/`computePlanHash`/`Event`, no `Receipt`/`verifyReceiptCoverage` |
| Capability API | `Registry.discover(filter)` → `Coordinate[]`; `Registry.load(coords)` → `Stub[]`; `Registry.action(protocol, method, account, params)` → `CapabilityNode` | identical (d09b38c) | `git show d09b38c…:packages/core/src/registry.ts` |
| Receipt API | `createTraceSimulator(runtime, { receipt })`; `simulate(capability)` → `{ results, halted? }`; `parseReceipt` | identical (d09b38c) | `git show d09b38c…:packages/simulator/src/index.ts` |
| FlipOrderUpdated | unsupported (receipt parsing throws, recorded `RECEIPT_FAILED`) | **unsupported on d09b38c**; only unmerged `upstream/pr-138` (`55f7ad9`) handles it | `git merge-base --is-ancestor 55f7ad9 upstream/main` → NO; recorded fixture `fixtures/chain-evidence/kuru/mon-to-usdc/raw.json` |

### Re-verification of the old ADR claims

- "published Moss 0.1.0 does not match the recorded Capability/Receipt API" →
  **CONFIRMED** on 2026-08-03 against `@themoss/core@0.1.0` (Plan-based).
- "Moss PR #138 handles FlipOrderUpdated; not merged" → **CONFIRMED**. PR #138
  tip is `d3b1695` (docs-level) on top of `55f7ad9` (the actual
  `fix(kuru): represent flip-order receipt evidence` change, +43 lines in
  `kuru.ts`). Neither is an ancestor of `upstream/main` (`2e7c1db`) nor of the
  fork `origin/main`.

## FlipOrderUpdated Status

- Current target runtime (d09b38c): **D - receipt/outcome cannot be completed.**
  `swapReceipt` throws `Unexpected Change: Kuru market emitted FlipOrderUpdated`;
  the simulator catches it as a `RECEIPT_FAILED` warning, halts the chain, and
  returns no receipt. This is exactly what the recorded fixture shows.
- The upstream fix (`55f7ad9`, PR #138) is unmerged and unpublished. It is not a
  stable runtime. Using it would require a vendored/workspace dependency on an
  unreleased Moss revision; that decision belongs to the team and is out of
  scope for this delivery.
- The Parallax adapter does **not** delete the warning or synthesize a receipt.
  `executionStatus` stays `UNKNOWN` (fail closed). No `live-success` fixture can
  be created until a Moss runtime that parses flip-order receipts is released
  or vendored.

## Reproducible Environment

| Property | Value |
| --- | --- |
| Parallax commit (base) | `8ed7bba8da7a24f1ef33fd0639575b1a6c33ce7f` |
| Parallax branch | `feat/moss-live-kuru-adapter` |
| Moss repository | `https://github.com/nishuzumi/moss.git` (upstream) |
| Moss commit (pinned) | `d09b38cbc44ee7f5722c5d09e7224f7750187762` |
| `@themoss/core` | 0.1.0 |
| `@themoss/erc` | 0.1.0 |
| `@themoss/protocol-kuru` | 0.1.0 |
| `@themoss/simulator` | 0.1.0 |
| `@themoss/system` | 0.1.0 |
| Node | v22.23.2 (downloaded from nodejs.org `v22.23.2`, darwin-arm64 tarball) |
| pnpm | 11.10.0 (matches Moss `packageManager`, activated via corepack under Node 22) |
| OS / architecture | macOS 15.7.5 / darwin-arm64 |
| Chain ID | 143 (Monad mainnet; observed by the adapter and enforced by Agent Flow and the smoke acceptance gate) |
| Kuru protocol | Kuru CLOB (router `0xd651346d7c789536ebf06dc72aE3C8502cd695CC`) |
| USDC address | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Sender | `0xcccccccccccccccccccccccccccccccccccccccc` (no private key; read-only) |
| amountIn | `0.01` (MON) |
| RPC type | read-only Monad mainnet RPC supporting `eth_chainId`, `eth_getBlockNumber`, `debug_traceCall` |

### Environment variables (names only; never print values)

| Variable | Secret | Purpose |
| --- | --- | --- |
| `MOSS_RPC_URL` | yes (never printed) | read-only Monad RPC endpoint for `createRuntime`, quote reads, and `debug_traceCall` simulation |
| `MOSS_RUNTIME_PATH` | no | absolute path to the pinned Moss Git checkout with built workspace `dist`; `.git` metadata must be retained and `git` must be available to the runtime environment |
| `MOSS_RUNTIME_VERSION` | no | exact `@themoss/core` version, e.g. `0.1.0` |
| `MOSS_RUNTIME_REVISION` | no | immutable Moss git commit, e.g. `d09b38cbc44ee7f5722c5d09e7224f7750187762` |
| `MOSS_SENDER` | no | read-only sender address (defaults to the fixture sender above) |

## How to reproduce

These steps are operator actions performed once before a run. The adapter
verifies the checkout revision and package identity/version; Agent Flow
enforces Chain 143 and valid `simulatorPinnedBlock` provenance; and the smoke
acceptance gate verifies the public `/api/check` result and its provenance
before treating it as live acceptance evidence.

The backend bootstrap performs the same runtime provenance preflight before it
composes the application or opens a listener. `MOSS_RUNTIME_PATH` must
therefore remain a readable Git checkout: the `.git` metadata and the `git`
executable are required to verify `MOSS_RUNTIME_REVISION`. A packed runtime
directory without authoritative Git metadata is rejected rather than treated
as a verified checkout.

```bash
# 1. Pin the Moss runtime in a dedicated checkout (never touch the upstream repo).
cd /Users/jie/Documents/web3-week2/moss   # local fork with upstream remote
git fetch upstream
git worktree add ~/.local/moss-runtime/d09b38c d09b38cbc44ee7f5722c5d09e7224f7750187762

# 2. Build it under Node 22 + pnpm 11.10.0 (frozen lockfile).
export PATH="$HOME/.local/opt/node-v22.23.2-darwin-arm64/bin:$PATH"
cd ~/.local/moss-runtime/d09b38c
pnpm install --frozen-lockfile
pnpm -r build

# 3. Run the Parallax live smoke (MOSS_RPC_URL must be configured; values never printed).
cd /Users/jie/Documents/parallax-team
export MOSS_RPC_URL=...            # read-only, never printed
export MOSS_RUNTIME_PATH="$HOME/.local/moss-runtime/d09b38c"
export MOSS_RUNTIME_VERSION=0.1.0
export MOSS_RUNTIME_REVISION=d09b38cbc44ee7f5722c5d09e7224f7750187762
pnpm smoke:kuru:live
```

The smoke saves raw stage output to the gitignored `.smoke-live/` directory and
persists the public `/api/check` response alongside it. It only writes the
formal fixture under
`fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` after every acceptance
condition passes.

## Provenance trust levels

Runtime, RPC, and block provenance are kept in three explicit layers. Do not
promote one layer into another:

1. **Smoke configuration inputs.** The smoke harness receives
   `MOSS_RUNTIME_PATH`, `MOSS_RUNTIME_VERSION`, and `MOSS_RUNTIME_REVISION`
   from the operator. These remain configuration inputs, while the adapter
   independently checks the checkout and loaded package manifests.
2. **Adapter-verified runtime provenance.** `runKuruLiveSwap` reads the
   checkout Git `HEAD`, records every loaded `@themoss/*` package version, and
   fails closed when the checkout revision or package identity disagrees with
   the configured runtime identity.
3. **RPC-observed chain and stage blocks.** `chainId` is read from the RPC and
   returned to Agent Flow, which enforces Chain ID 143. Each stage's
   `blockNumber` is the block observed through RPC immediately before the
   stage call. When the runtime exposes an explicit pinned-block API, the
   adapter records its exact `simulatorPinnedBlock`; Agent Flow and acceptance
   reject results where that value is absent or invalid. A stage block is never
   treated as a substitute for the simulator's internal block.

The pinned d09b runtime currently does not expose the simulator block, so live
Agent Flow remains fail-closed until an approved runtime revision exposes it.
Downstream consumers must still independently verify any stronger deployment or
production-readiness claim.

## Security and trust boundary

- No private key is read, requested, or used. No signing, broadcast, custody,
  or wallet mutation happens anywhere in the adapter or smoke.
- The action stage only constructs unsigned calldata (`from`/`to`/`data`/`value`).
- `MOSS_RPC_URL` is read from the environment and never printed; RPC userinfo
  and query secrets are redacted by `redact()` before any payload is persisted.
- Recorded Replay remains a separate demo path and is never used as a fallback
  for POST `/api/check`. The live endpoint consumes Agent Flow results only
  when `MOSS_RUNTIME_PATH` is configured; a missing path stays explicitly
  `UNSUPPORTED`, and a live result that lacks trustworthy evidence remains
  `UNKNOWN` rather than being upgraded from Replay.

## Known limitations

1. d09b38c cannot parse `FlipOrderUpdated` receipts → simulation halts →
   `executionStatus = UNKNOWN`. No live SUCCESS fixture exists for MON → USDC.
2. Simulator synthetic-prefunds native MON only; ERC-20 affordability is not
   proven (`walletAffordabilityChecked: false`).
3. The simulator pins one base block internally (Moss ADR 0002). The adapter
   records it only when the runtime exposes the explicit pinned-block API;
   otherwise `simulatorPinnedBlock` is absent and Agent Flow/acceptance reject
   the result as non-authoritative. Per-stage pre-call block heights remain
   supplementary provenance.
4. Quote uses the public Kuru API for market discovery, then verifies on-chain;
   its availability is not guaranteed.
5. `MOSS_RPC_URL`, `MOSS_RUNTIME_PATH`, `MOSS_RUNTIME_VERSION`, and
   `MOSS_RUNTIME_REVISION` are not configured in this repository state, so the
   live smoke writes a configuration artifact and fails. No live acceptance
   artifact is claimed here.

## Raw → Normalized Evidence mapping

Raw locators/fingerprints are preserved in `raw.json`; the table below is the
explicit field mapping implemented by `normalizeLiveKuruEvidence`.

| Raw stage/field | Normalized field | Source | Reproducibility | Required | Failure behavior |
| --- | --- | --- | --- | --- | --- |
| DISCOVER → capabilities | (stage record; enables ACTION) | moss | REPRODUCIBLE | yes | stage error → `INTEGRATION_ERROR`, run stops |
| DISCOVER → protocol identity | `intent.protocol` = `"kuru"` | derived | — | yes | not applicable |
| LOAD → loaded capability/stub | `action.value` (tx summaries) | moss | REPRODUCIBLE | yes | stage error → `INTEGRATION_ERROR`, run stops |
| LOAD → capability tree | `approval.value` (`REQUIRED`/`NOT_APPLICABLE`) | derived | REPRODUCIBLE | yes | `UNKNOWN` when tree absent |
| QUOTE → route/data | `quote.value` | quote | REPRODUCIBLE | yes | `NO_ROUTE` when "no verified Kuru market path"; other errors → `INTEGRATION_ERROR` |
| QUOTE → block | `blockNumber` (per-stage) | rpc | REPRODUCIBLE | yes | missing block → `blockNumber.value = null`, completeness fails |
| ACTION → transaction from/to/data/value | `action.value` (sender/target/nativeValue/calldataBytes) | moss | REPRODUCIBLE | yes | no tx → `action.value = null`, execution `UNKNOWN` |
| ACTION → transaction order | `simulationCoverage.expectedTransactions` | derived | REPRODUCIBLE | yes | no tx → coverage incomplete |
| ACTION → approval capability | `approval.value` | derived | REPRODUCIBLE | yes | absent → `UNKNOWN` |
| SIMULATION → per-tx result.transaction | coverage match by from/to/data/value | moss | REPRODUCIBLE | yes | unmatched/missing → `complete=false`, execution `UNKNOWN` |
| SIMULATION → receipt | `receipt.value` | moss | REPRODUCIBLE | yes (SUCCESS) | `null` → execution `UNKNOWN` |
| SIMULATION → outcome | `outcome.value` | moss | REPRODUCIBLE | yes (SUCCESS) | `null` → execution `UNKNOWN` |
| SIMULATION → warnings | `warnings.value` (preserved verbatim) | moss | REPRODUCIBLE | yes | warning is NOT a failure; if it blocks receipt/outcome → execution `UNKNOWN` |
| SIMULATION → revert | `revertReason.value`, `executionStatus = REVERTED` | moss | REPRODUCIBLE | no | no attributable cause → no balance/protocol claim; coverage still evaluated |
| SIMULATION → gas | `gas.value` | moss | REPRODUCIBLE | no | `null` tolerated |
| SIMULATION → changes | `assetChanges.value` | moss | REPRODUCIBLE | no | non-empty but unexplained → `assetChangeAssessment = UNKNOWN` |
| SIMULATION → halted | `simulationCoverage.halted`/`haltReason` | moss | REPRODUCIBLE | yes | halted → `complete=false`, execution `UNKNOWN` |
| SIMULATION → results count vs actions | `simulationCoverage.complete/missing/unmatched` | derived | REPRODUCIBLE | yes | incomplete → execution `UNKNOWN` |
| RUNTIME → package versions/revision | `runtimeVersion`/`runtimeRevision`/`mossCommit` | moss | REPRODUCIBLE | yes | mismatch → run fails closed (`INTEGRATION_ERROR`) |
| RUNTIME → block per stage | `blockNumber` (+ `fetchedAt`) | rpc | REPRODUCIBLE | yes | supplementary only; it is not the simulator-pinned block |
| SIMULATOR → pinned base block | `simulatorPinnedBlock` | moss | REPRODUCIBLE | yes for authoritative live | absent/invalid → Agent Flow and acceptance fail closed |
| LIVE flags | `isReplay=false`, `isMock=false`, `replayMode=false` | derived | — | yes | any other value fails the smoke acceptance |

## P0 status

`P0_LIVE_BLOCKED_PORTABLE_RUNTIME` — this repository does not currently contain
the required Moss checkout/RPC configuration, so no live acceptance result is
claimed. Once configured, the smoke will classify a real run as simulation
blocked if the pinned runtime still cannot parse `FlipOrderUpdated`; the
minimal unblock is a published or team-vendored Moss revision that parses
flip-order receipts (the unmerged `55f7ad9` is the smallest known candidate).
