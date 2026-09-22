# BE-011 Provider Registry Fixture Manifest

This directory is an **index**, not a second Provider result model.

It exists so Backend can discover deterministic BE-011 evidence without treating mock data as a real Provider response or requiring secrets/network access.

## Truthfulness rules

- `real=true` means the referenced source was captured from a real runtime/provider interaction and sanitized.
- `real=false` means deterministic mock/rule/replay input only.
- Documentation-only capability claims are never materialized as fabricated Provider JSON.
- Missing real evidence is represented as an explicit pending/unavailable entry, not an invented response.
- Provider-specific raw types stay outside Generic Evidence/Core.
- No API keys, RPC secret URLs, private keys, cookies, access tokens, or unredacted provider identifiers may be committed.

## Existing reusable Moss evidence

| Entry | Truthfulness | Source |
| --- | --- | --- |
| Moss live success | real | `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` |
| Moss integration error | mock/rule input | `fixtures/chain-evidence/kuru/integration-error/` |
| Moss missing evidence | mock/rule input | `fixtures/chain-evidence/kuru/missing-evidence/` |
| Moss no route | inspect per-entry metadata before use | `fixtures/chain-evidence/kuru/no-route/` |
| Moss reverted | mock/rule input (`real=false`) | `fixtures/chain-evidence/kuru/reverted/` |
| Native RPC controlled partial surface (guarded canonical capture) | real | `fixtures/provider-registry/be-011/native-rpc/arbitrum-sepolia-public-2026-09-10T12-19-45-890Z/` |
| Native RPC controlled partial surface (historical pre-guard capture) | real | `fixtures/provider-registry/be-011/native-rpc/arbitrum-sepolia-public-2026-09-08/` |
| Native RPC Camelot Sepolia candidate pair/pool (read-only partial) | real | `fixtures/provider-registry/be-011/native-rpc/camelot-sepolia-2026-09-16/qualification.json` |

The BE-011 capability manifest is `manifest.json`.

Each provider entry in `manifest.json` carries a machine-readable
`fixtureIndex`: an evidence-case index with an observation id, `real` flag,
existing fixture path (or `null` when unavailable), evidence classification,
chain/protocol where legitimately known, and a truthful note. It lets Backend
discover the deterministic evidence set without hardcoding paths or reading
prose, and it does not freeze final Provider status mappings.

The canonical Native RPC capture is
`arbitrum-sepolia-public-2026-09-10T12-19-45-890Z`, produced by the guarded
probe whose exact source commit is recorded as `repositoryHeadAtCapture`. The
`arbitrum-sepolia-public-2026-09-08` capture is retained as
`HISTORICAL_PRE_GUARD_CAPTURE`: its recorded `repositoryHeadAtCapture` does not
contain the probe source, so it is superseded for canonical qualification. Its
recorded observation values are unchanged and its provenance defect is not
retroactively fixed.

The separate `camelot-sepolia-2026-09-16` fixture is indexed in `manifest.json`
with classification `LIVE_READ_ONLY_PARTIAL`. It is an ad hoc fixed read-only
candidate qualification at pinned block `309542712`, not a guarded-probe
recapture: its `repositoryBaseCommit` is historical provenance and no committed
probe script version is claimed. It qualifies a candidate WETH/USDC pair/pool
only — no Camelot quote, prepared swap transaction, swap `eth_call`, or swap gas
estimate — so its protocol remains unqualified. Eleven of its thirteen
observations record a per-response `fetchedAt`; two pooled observations record
only `captureFinishedAt` with `fetchedAt: null`. That incomplete-timestamp gap
is a retained historical limitation and is not fabricated or backfilled.

The PR-P0-B controlled Native RPC inputs live at
`native-rpc/controlled-p0-b/`. They are deterministic `real=false` adapter
inputs and are not an additional Provider result model or a claim of live
Arbitrum/Camelot support.

The Native RPC fixture proves only the recorded Arbitrum Sepolia public RPC
read/error surface. It is not a Camelot transaction, complete simulation,
`PreparedExecution`, or `NativeRpcProvider` implementation. The observed
`-32601` response is a JSON-RPC method-not-found envelope, not a final Provider
`UNSUPPORTED` classification, and `eth_getBalance` was not executed and remains
`UNKNOWN`. Native RPC outage, natural timeout, rate-limit, and stale-response
evidence remain unavailable or `UNKNOWN`. Tenderly real-response entries remain
pending.
