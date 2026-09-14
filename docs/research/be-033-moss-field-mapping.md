# BE-033 Moss Field-by-Field Provisional Mapping

> **Status:** Provisional integration handoff — **not** final Evidence Contract semantics
> **Owner:** Provider Owner (`jzhao0`) — proposal only
> **Companion:** `docs/research/be-033-moss-provider-handoff.md`
> **Baseline reused:** merged #51 / BE-011 (`docs/research/be-011-provider-input-package.md`)

## How to read this document

Every Moss value Backend may consume is listed once with:

- **raw/source path** — where the value exists in the raw Moss/Kuru output;
- **raw type** — the type actually observed in the real fixture (or the type the code accepts);
- **meaning / units** — honest semantics, including where units are unknown;
- **req** — `required`, `optional`, or `nullable` behavior;
- **source** — `moss`, `rpc`, `quote`, `derived`, `mock`, `unknown` as recorded by the adapter;
- **validity** — the condition under which the value may be used;
- **class** — `REAL_OBSERVED`, `INFERRED_FROM_CODE`, `MOCK_ONLY`, `RULE_DERIVED`, `UNQUALIFIED`;
- **missing/malformed behavior** — what the current code does when the value is absent or invalid;
- **provisional mapping** — the proposed provider-neutral destination;
- **opaque?** — whether the value must remain inside the Moss Adapter (`yes` / `no`);
- **owner** — the unresolved semantic owner when a decision is still required.

Nothing here is normative. Provider-specific raw types must not cross into generic Core; the generic contract already provides `providerData` and `provenance.runtime` for verbatim provider metadata (`packages/contracts/src/generic-evidence.ts`).

**Canonical real observation used for `REAL_OBSERVED` claims:** `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` (Monad `143` × `kuru`, Moss `0.1.0` / `ef15448e166f31c891e80dba5073dae04a052a2b`, simulator pinned block `94112902`). Values from other fixtures are labelled individually.

## 1. Provider identity and runtime identity

| Field | Raw/source path | Raw type | Meaning / units | Req | Source | Validity | Class | Missing/malformed | Provisional mapping | Opaque? | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `providerId` | code constant `PROVIDER_ID` in `packages/moss-bridge/src/provider.ts` | string literal `"moss-kuru"` | Provider identity | required | n/a (constant) | always | `INFERRED_FROM_CODE` (also emitted in real evidence) | not configurable | `provider.providerId` | no | Provider Owner (fixed) |
| `runtimeVersion` | configured `MossProviderRuntime.runtimeVersion`; echoed in `normalized.runtimeVersion` | string (`"0.1.0"`) | Moss release version | required for live | moss config | must equal every loaded `@themoss/*` package version | `REAL_OBSERVED` | mismatch → `INTERNAL_ERROR` / fails closed | `provenance.runtime.runtimeVersion` | no | Contract Owner (final scoping) |
| `runtimeRevision` | configured revision; echoed in `runtimeRevision`/`mossCommit` | 40-hex string | Immutable Moss git checkout identity | required for live | moss config + checkout `git rev-parse HEAD` | must match checkout HEAD exactly; not `"latest"`/`"main"` | `REAL_OBSERVED` | non-hex or mismatch → `INTERNAL_ERROR` | `provenance.runtime.runtimeRevision` | no | Contract Owner |
| `checkoutRevision` | `RuntimeIdentity.checkoutRevision` from `runKuruLiveSwap` | 40-hex string | Adapter-observed checkout revision | optional | moss | equals `runtimeRevision` on success | `REAL_OBSERVED` | absent → provenance mismatch fails closed | `provenance.runtime.checkoutRevision` | no | Contract Owner |
| `packageVersions` | `RuntimeIdentity.packageVersions` (read from each package manifest) | `Record<string,string>` | Per-package loaded version | required for live | moss | every required package must equal `runtimeVersion` | `REAL_OBSERVED` | missing package → fails closed | `provenance.runtime.packageVersions` | no | Contract Owner |
| `mossVersion` | composed in `normalizeLiveKuruEvidence` as `@themoss/protocol-kuru@<version>` | string | Protocol package identity | required | moss/derived | package version present | `INFERRED_FROM_CODE` | falls back to `runtimeVersion` | `providerData.mossVersion` | yes | Provider Owner |
| `mossCommit` | `input.runtime.runtimeRevision` | 40-hex string | Evidence baseline commit | optional | moss | equals `runtimeRevision` | `REAL_OBSERVED` | absent → reproducibility `UNKNOWN` | `provenance.runtime.commit` | no | Contract Owner |
| `runId` | `EvidenceEvaluationInput.runId` / `LiveKuruResult.runId` | string | Run identity supplied by Backend | required | backend | echoed unchanged | `REAL_OBSERVED` (fixture: `kuru-live-1786163979273`) | absent → request invalid | Not currently on `GenericEvidence`; must bind the future prepared execution | no | Backend Owner / Contract Owner |

**Note.** `runId` is **not** currently carried on `GenericEvidence`. In the target design the run identity binds Provider evaluation to the prepared execution; whether it becomes a generic Evidence field is a Contract Owner decision.

## 2. Request / intent fields

| Field | Raw/source path | Raw type | Meaning / units | Req | Source | Validity | Class | Missing/malformed | Provisional mapping | Opaque? | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `intent.chainId` | normalized intent; code compares `Number(MONAD_CHAIN_ID)` | string (`"143"`) → number | Chain identity | required | caller | must equal `143`; RPC-observed chain also checked | `REAL_OBSERVED` | non-numeric/other chain → `UNSUPPORTED` or provenance failure | `intent.chainId` (number) | no | Contract Owner |
| `intent.protocol` | normalized intent | string (`"kuru"`) | Protocol identity | required | caller | must equal `kuru` | `REAL_OBSERVED` | other protocol → `UNSUPPORTED` | `intent.protocol` | no | Contract Owner |
| `intent.sender` | normalized intent | address string | Account whose execution is evaluated | required | caller | non-empty; recorded as given (`0xcccc…cccc`) | `REAL_OBSERVED` | absent → invalid request | `intent.sender` | no | Contract Owner |
| `intent.tokenIn` | normalized intent; internal key `"native"` for MON | string (`"native"` / address) | Input asset | required | caller | `"native"` or ERC-20 address | `REAL_OBSERVED` | absent → invalid request | `intent.tokenIn` (`"native"` per generic schema) | no | Contract Owner |
| `intent.tokenOut` | normalized intent | address string | Output asset (`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`) | required | caller | non-empty | `REAL_OBSERVED` | absent → invalid request | `intent.tokenOut` | no | Contract Owner |
| `intent.amountIn` | normalized intent | decimal string (`"0.01"`) | Human-readable input amount | required | caller | parseable decimal | `REAL_OBSERVED` | non-decimal → invalid request | `intent.amountIn` | no | Contract Owner |
| `intent.minimumReceived` | normalized intent | decimal string | Optional user slippage floor | optional | caller | recorded only when supplied | `MOCK_ONLY` as real evidence (absent in the real fixture) | absent → omitted | `intent.minimumReceived` | no | Contract Owner |
| `intent.minimumReceivedSource` | normalized intent | `original_swap` / `user_declared` / `demo_preset` / `unavailable` | Provenance of the floor | required by generic schema | derived | `unavailable` in the real fixture | `REAL_OBSERVED` | absent → schema rejection of generic evidence | `intent.minimumReceivedSource` | no | Contract Owner |

## 3. Quote fields

| Field | Raw/source path | Raw type | Meaning / units | Req | Source | Validity | Class | Missing/malformed | Provisional mapping | Opaque? | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `quote.data.estimatedAmountOut` | `raw.quote.data.estimatedAmountOut` → `normalized.quote.value.estimatedAmountOut` | decimal string (`"0.000223"`) | Estimated output in human units of `tokenOut` | required for a usable quote | quote | present; regex `^\d+(\.\d+)?$` for the typed projection | `REAL_OBSERVED` | non-string/non-decimal → typed `quote.value=null` while the raw field stays in its `EvidenceField` | `quote.value.estimatedAmountOut` | no | Contract Owner |
| `quote.data.minimumAmountOut` | `raw.quote.data.minimumAmountOut` | decimal string (`"0.000221"`) | Provider-computed minimum output floor | optional | quote | present; non-empty string | `REAL_OBSERVED` | absent/empty → omitted from typed output; raw stays in `EvidenceField` | `quote.value.minimumAmountOut` | no | Contract Owner |
| `quote.data.amountSide` | `raw.quote.data.amountSide` | string (`"amountIn"`) | Which side the amount refers to | optional | quote | observed value only | `REAL_OBSERVED` | absent → not projected into typed quote | **no generic destination** — remains in the untyped `quote.value`/raw | yes (unless Contract adds it) | Contract Owner |
| `quote.data.amountIn` | `raw.quote.data.amountIn` | decimal string (`"0.01"`) | Echoed input amount | optional | quote | should equal request amount; not currently asserted | `REAL_OBSERVED` | absent → no cross-check | **no generic destination**; proposed consistency check | yes | Backend Owner |
| `quote.data.path` | `raw.quote.data.path` | string array (`["native","0x7547…"]`) | Route hop list | optional | quote | observed order | `REAL_OBSERVED` | absent → route not projected | **no generic destination** | yes | Contract Owner |
| `quote.kind/protocol/method` | `raw.quote.kind`, `.protocol`, `.method` | strings (`"query"`, `"kuru"`, `"quote"`) | Envelope identity | optional | quote | observed values | `REAL_OBSERVED` | absent → treated as unusable envelope | **no generic destination** | yes | Provider Owner |

The typed projection only accepts a plain decimal `estimatedAmountOut`; anything else maps to `null` so Risk fails closed preview (`QUOTE_UNAVAILABLE`/`UNKNOWN`) instead of rejecting the whole evidence. See `quoteOutput()` in `packages/moss-bridge/src/provider.ts`.

## 4. Unsigned action fields

| Field | Raw/source path | Raw type | Meaning / units | Req | Source | Validity | Class | Missing/malformed | Provisional mapping | Opaque? | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `action` (payload) | `raw.action.children[].transaction` (`from`/`to`/`data`/`value`) | object array | Exact **unsigned** transaction material | required for simulation | moss | byte-identical to `simulation.results[].transaction` in the real fixture | `REAL_OBSERVED` | empty children → `action.value=null` and `executionStatus=UNKNOWN` | **Opaque.** Only the summary is projected into generic `action` | **yes** | Backend Owner (target prepared-execution binding) |
| `action.value[].protocol` | derived from the capability node | string (`"kuru"`) | Protocol of the transaction | required for summary | moss/derived | capability tree present | `INFERRED_FROM_CODE` | missing → `"unknown"` | `action.value[].protocol` (untyped JSON) | no | Provider Owner |
| `action.value[].method` | derived from the capability node | string (`"swap"`) | Method label | required for summary | moss/derived | capability tree present | `INFERRED_FROM_CODE` | missing → `"unknown"` | `action.value[].method` | no | Provider Owner |
| `action.value[].sender` | `transaction.from` | address string | Transaction sender | optional | moss | string `from` | `REAL_OBSERVED` | missing → `null` in summary | `action.value[].sender` | no | Provider Owner |
| `action.value[].target` | `transaction.to` | address string (`0xd651346d7c789536ebf06dc72aE3C8502cd695CC`) | Transaction target | optional | moss | string `to` | `REAL_OBSERVED` | missing → `null` | `action.value[].target` | no | Provider Owner |
| `action.value[].nativeValue` | `transaction.value` | hex quantity string (`"0x2386f26fc10000"`) | Native value attached to the call (wei; **hex**) | optional | moss | hex string | `REAL_OBSERVED` | missing → `null` | `action.value[].nativeValue` | no | Contract Owner (units/encoding) |
| `action.value[].calldataBytes` | computed as `(data.length - 2) / 2` | number (`420`) | Calldata length in bytes | optional | derived | string `data` | `RULE_DERIVED` | non-string data → `null` | `action.value[].calldataBytes` | no | Provider Owner |
| `action` envelope (`kind`, `params`, `children`) | `raw.action` | object | Capability tree context | optional | moss | tree present | `REAL_OBSERVED` | absent → no transactions | Opaque; not projected | yes | Provider Owner |
| ERC-20 approval node | `raw.action` subtree with `protocol="erc20"`, `method="approve"` | object | Declared (not executed) approval step | optional | moss | present for ERC-20 input (`usdc-to-mon` fixture) | `REAL_OBSERVED` (declared) | absent → `approval="UNKNOWN"` for ERC-20 input; `NOT_APPLICABLE` for native input | `providerData.approval` | yes | Contract Owner |

**Critical caveat.** The generic `action` field carries a **summary** (`protocol`, `method`, `sender`, `target`, `nativeValue`, `calldataBytes`), **not** the exact calldata. Byte-exact transaction equality is only available inside the Adapter from the raw payload. In the target prepared-execution design, the exact unsigned transaction must come from the pipeline, not from this summary.

## 5. Simulation, receipt, and outcome fields

| Field | Raw/source path | Raw type | Meaning / units | Req | Source | Validity | Class | Missing/malformed | Provisional mapping | Opaque? | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `simulation.results[]` | `raw.simulation.results` | object array | Per-transaction simulation results | required for a simulated outcome | moss | array present | `REAL_OBSERVED` | non-array → all simulation fields `null`, coverage incomplete | Opaque; drives derived fields | yes | Provider Owner |
| `results[].transaction` | `raw.simulation.results[i].transaction` | object | Transaction the simulator executed | required | moss | byte-equal to an action transaction (case-insensitive compare) | `REAL_OBSERVED` | mismatch → transaction unmatched, coverage incomplete | Opaque (used for matching) | yes | Backend Owner |
| `results[].reverted` | `raw.simulation.results[i].reverted` | boolean | Whether the matched transaction reverted | required | moss | `true` only when a matching action transaction exists | `REAL_OBSERVED` | absent/non-boolean → treated as not reverted | `execution.status = REVERTED` (with `integrationStatus=OK`) | no | Contract Owner |
| `results[].revertReason` | `raw.simulation.results[i].revertReason` | string | Provider revert string | optional | moss | first string found | `MOCK_ONLY` as a real observation (real success fixture has `revertReason=null`) | absent → `revertReason.value=null` + `limitation` | Currently `providerData.revertReason`; first-class generic field = Contract Owner decision | yes (until decided) | Contract Owner |
| `results[].receipt` | `raw.simulation.results[i].receipt` | object | Simulated receipt (`kind`, `outcome`, `text`, `changes`, `protocol`) | optional | moss | last result carrying a receipt | `REAL_OBSERVED` | absent → `receipt.value=null`; `executionStatus=UNKNOWN` | `receipt.value` (untyped JSON) | no (JSON passthrough) | Contract Owner |
| `receipt.outcome` | `raw.simulation.results[i].receipt.outcome` | object | Structured swap outcome | optional | moss | receipt is an object and has `outcome` | `REAL_OBSERVED` | absent → `outcome.value=null` | `outcome.value` (untyped JSON) | no | Contract Owner |
| `receipt.outcome.amountIn` | same | integer string (`"10000000000000000"`) | Atomic input amount | optional | moss | present in the real fixture | `REAL_OBSERVED` | absent → field missing | No dedicated generic field | no | Contract Owner |
| `receipt.outcome.amountOut` | same | integer string (`"223"`) | Atomic output amount | optional | moss | present in the real fixture | `REAL_OBSERVED` | absent → missing | No dedicated generic field | no | Contract Owner |
| `results[].changes[]` | `raw.simulation.results[*].changes` | object array | Flattened change/event tree | required for asset-change evidence | moss | array per result | `REAL_OBSERVED` | non-array → `assetChanges.value=[]` | `assetChanges.value` | no | Contract Owner |
| `changes[].kind` | change node | `"nativeTransfer"` / `"event"` / `"change"` | Node discriminator | required | moss | string | `REAL_OBSERVED` | absent → node still passed through | `assetChanges.value[].kind` | no | Contract Owner |
| `results[].warnings[]` | `raw.simulation.results[*].warnings` | array | Non-fatal simulator warnings (e.g. `FlipOrderUpdated` receipt-parsing) | optional | moss | array | `REAL_OBSERVED` (empty in success fixture; non-empty in the recorded-baseline live run) | non-array → ignored | `warnings.value` | no | Provider Owner |
| `results[].gas` | `raw.simulation.results[i].gas` | integer string (`"528696"`) | Simulated execution units for that result | optional | moss | string present | `REAL_OBSERVED` | absent → `null` placeholder in the array | `providerData.gas` (array) | yes | Contract Owner (generic gas semantics) |
| `simulation.halted` | `raw.simulation.halted` | boolean or object | Whether the simulator halted early | optional | moss | `!== false` treated as halted | `INFERRED_FROM_CODE` | absent → not halted | `simulation.value.halted` | no | Contract Owner |

## 6. Rule-derived fields (computed, not Provider-returned)

| Field | Produced by | Meaning | Class | Missing/malformed | Provisional mapping | Opaque? | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `executionStatus` | `executionStatus()` in `normalize.ts` | `SUCCESS` / `NO_ROUTE` / `REVERTED` / `UNKNOWN` decision over integration status, normalized errors, coverage, revert flag, receipt presence | `RULE_DERIVED` | non-OK integration → `UNKNOWN`; incomplete coverage → `UNKNOWN`; no receipt → `UNKNOWN` | `execution.status` | no | Contract Owner |
| `integrationStatus` | `aggregateIntegrationStatus()` (rank: `OK` < `UNAVAILABLE` < `TIMEOUT` < `INTEGRATION_ERROR`) | Legacy integration health | `RULE_DERIVED` | no errors → `OK` | `provider.integrationStatus` | no | Contract Owner |
| `simulationCoverage` | `coverageSummary()` — expected transactions from the action tree, observed from results | `{expectedTransactions, observedResults, unmatchedResultIndexes, halted, complete, missingTransactionIndexes, haltReason?}` | `RULE_DERIVED` | no action → `expectedTransactions=0`, `complete=false` | `simulation.value` | no | Contract Owner |
| `assetChangeAssessment` | `assessAssetChanges()` — conserves across expected assets | `EXPLAINED` / `UNEXPLAINED` / `UNKNOWN` / `NOT_APPLICABLE` | `RULE_DERIVED` | insufficient movements → `UNKNOWN`/`NOT_APPLICABLE` | `assetChangeAssessment` | no | Contract Owner |
| `approval` | `approvalStatus()` — native input → `NOT_APPLICABLE`; ERC-20 with `approve` node → `REQUIRED`; else `UNKNOWN` | Whether approval is required | `RULE_DERIVED` | no action tree → `UNKNOWN` | `providerData.approval` | yes | Contract Owner |
| `provider.status` | `providerEvaluationStatus()` — `FAILED` when integration non-OK; `SUCCESS` for `SUCCESS`/`NO_ROUTE`/`REVERTED`; else `UNKNOWN` | Provider evaluation status | `RULE_DERIVED` | n/a | `provider.status` | no | Contract Owner |
| `provenance.mode` | `evidenceMode()` — `RECORDED_REPLAY` > `MOCK` > `LIVE` | Truthfulness mode | `RULE_DERIVED` | n/a | `provenance.mode` | no | Contract Owner |
| `checkedScope` / `unknownScope` | `evidenceScope()` — non-null `quote` / `action` / `receipt`-or-`outcome` / `simulationCoverage`, plus `no-route` | Which stages were checked | `RULE_DERIVED` | all-null → all in `unknownScope` | `checkedScope` / `unknownScope` | no | Contract Owner |
| `capabilities` | hardcoded `["quote","action","simulate"]` for the Moss path | Declared capability tokens | `INFERRED_FROM_CODE` | constant | `capabilities` | no | Contract Owner |
| `reproducibility` | `reproducibilityOf()` — mock → `NOT_REPRODUCIBLE`; unknown → `UNKNOWN`; block+commit → `REPRODUCIBLE` | Per-field reproducibility | `RULE_DERIVED` | no block/commit → `UNKNOWN`/`NOT_REPRODUCIBLE` | per-field `reproducibility` | no | Contract Owner |
| `limitations` | hardcoded per normalization path, plus conditional receipt/revert notes | Truthful scope caveats | `INFERRED_FROM_CODE` | always at least 2 entries | `providerData.limitations` | yes | Product Owner |

## 7. Provenance fields

| Field | Raw/source path | Raw type | Meaning / units | Req | Source | Validity | Class | Missing/malformed | Provisional mapping | Opaque? | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `observedChainId` | RPC `eth_chainId` read by `runKuruLiveSwap` | number (`143`) | Chain actually reached | required for live | rpc | must equal 143 | `REAL_OBSERVED` | undefined → `UNAVAILABLE` (`stage=DISCOVER`) | `provenance.observedChainId` | no | Contract Owner |
| `simulatorPinnedBlock` | runtime `getPinnedBlockNumber()` (hex) normalized to decimal | decimal string (`"94112902"`) | Exact simulator base block | required for simulated outcomes | moss/rpc | `/^\d+$/`; before/after pin must agree; `NO_ROUTE` exempt | `REAL_OBSERVED` | missing/invalid → `INTERNAL_ERROR`; `NO_ROUTE` may omit | `provenance.simulationBlock` | no | Contract Owner |
| `blockNumber` (top-level) | `liveBlockNumber()` — last `SIMULATE` stage block, else last stage block | decimal string (`"94112901"`) | Latest block read across stages | required | rpc | numeric string | `REAL_OBSERVED` | null → `blockNumber.value=null`, `source="unknown"` | `blockNumber.value` | no | Contract Owner |
| `stages[].blockNumber` | per-stage RPC block read before the stage call | decimal string (`94112883` for stages, `94112901` for SIMULATE) | Block observed at stage boundary | optional | rpc | numeric string | `REAL_OBSERVED` | absent → omitted from stage summary | `providerData.stages[].blockNumber` | yes | Provider Owner |
| `stages[].stage` / `.success` / `.startedAt` / `.finishedAt` | `StageRecord` | string / boolean / ISO string | Per-stage execution record | required when stages exist | moss | present | `REAL_OBSERVED` | absent → omitted | `providerData.stages` | yes | Provider Owner |
| `fetchedAt` | capture timestamp threaded through normalization | ISO datetime (`2026-08-08T04:39:40.097Z`) | Fetch/capture time | optional | derived | ISO datetime | `REAL_OBSERVED` | absent → field omitted | `provenance.fetchedAt` and per-field `fetchedAt` | no | Contract Owner |
| `result.startedAt` / `finishedAt` | fixture metadata | ISO datetime | Run wall-clock window | optional | harness | present | `REAL_OBSERVED` | absent in normalized evidence | Not on `GenericEvidence`; fixture metadata only | no | Provider Owner |
| `blockHash` | not present | — | Canonical block hash | absent | — | — | `UNQUALIFIED` | n/a | No mapping; **must not be claimed** | no | Contract Owner |
| `parallaxCommit` | fixture metadata | 40-hex | Parallax commit at capture | optional | harness | present (`938f62fe…`) | `REAL_OBSERVED` | absent → capture provenance weaker | Fixture metadata only | no | Provider Owner |
| `provenance.source` | `evidence.source` | `moss` | Evidence source | required | derived | always `moss` for this path | `INFERRED_FROM_CODE` | n/a | `provenance.source` | no | Contract Owner |
| freshness (`stale` policy) | — | — | Stale threshold / policy | **none** | — | no policy exists | `UNQUALIFIED` | n/a | **No mapping** — unresolved | no | Contract Owner |
| request/quote/action relationship | `runId` + intent + byte-identical `raw.action`/`raw.simulation` transactions | — | Binding between request, quote, action, simulation | partial | derived | byte equality observed in the real fixture | `REAL_OBSERVED` | no generic field encodes the binding today | Proposed: explicit binding in the target prepared execution | no | Backend Owner |

## 8. Failure and control fields

| Field | Raw/source path | Raw type | Meaning | Req | Source | Validity | Class | Missing/malformed | Provisional mapping | Opaque? | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `errors.value[].code` | normalized from `raw.errors` or a thrown/classified error | enum (`NO_ROUTE`, `REVERTED`, `TIMEOUT`, `UNAVAILABLE`, `INTEGRATION_ERROR`, `UNKNOWN`) | Classified failure kind | optional | moss/rpc/quote/unknown | from structured error or derived message rules | `MOCK_ONLY` as a real observation; `INFERRED_FROM_CODE` as behavior | absent → synthesized `INTEGRATION_ERROR` when integration non-OK | `provider.errors.value[].code`, `provider.failure.code` | no | Contract Owner |
| `errors.value[].stage` | raw error key or structured `stage` | `DISCOVER`/`LOAD`/`QUOTE`/`ACTION`/`SIMULATE` | Failing stage | optional | derived | valid stage name only | `INFERRED_FROM_CODE` | absent → omitted; last failed stage is used for the synthesized failure | `provider.errors.value[].stage` | no | Contract Owner |
| `errors.value[].message` | raw error message | string | Redacted diagnostic | required | moss/rpc/unknown | non-empty | `MOCK_ONLY` as real observation | absent → `JSON.stringify` fallback | `provider.errors.value[].message` | no | Contract Owner |
| `errors.value[].integrationStatus` | structured or derived | `OK`/`INTEGRATION_ERROR`/`UNAVAILABLE`/`TIMEOUT` | Integration health | required | derived | authoritative when structured | `INFERRED_FROM_CODE` | absent → derived | `provider.errors.value[].integrationStatus` | no | Contract Owner |
| `errors.value[].source` | structured or stage-derived (`QUOTE`→`quote`, `SIMULATE`→`rpc`, else `moss`) | enum | Failure origin | required | derived | one of `moss`/`rpc`/`quote`/`unknown` | `INFERRED_FROM_CODE` | absent → `unknown` | `provider.errors.value[].source` | no | Contract Owner |
| `errors.value[].normalization` | classifier | `PRESERVED`/`DERIVED` | Whether the error was structured or message-derived | required | derived | always set | `RULE_DERIVED` | n/a | `provider.errors.value[].normalization` | no | Contract Owner |
| `errors.value[].retryable` | structured field or classifier default | boolean | Whether a retry against the same runtime may help | optional | derived | structured value wins; `TIMEOUT`/`INTEGRATION_ERROR` default `true` | `INFERRED_FROM_CODE` | absent for other statuses | `provider.errors.value[].retryable` | no | Contract Owner |
| `EvidenceProviderError.code` | `provider.ts` | `NO_ROUTE`/`REVERTED`/`TIMEOUT`/`UNAVAILABLE`/`INTEGRATION_ERROR`/`UNKNOWN`/`INTERNAL_ERROR`/`UNSUPPORTED` | Thrown boundary failure | optional | derived | when no evidence could be produced | `INFERRED_FROM_CODE` | n/a | Backend Adapter `ProviderAdapterErrorCode` | no | Backend Owner |
| Backend `status` | `provider-result-boundary.ts` | `success`/`unknown`/`unsupported`/`failed`/`timeout`/`stale`/`invalid` | Backend control status | required | derived | boundary contract | `INFERRED_FROM_CODE` | invalid → rejected | Pending pipeline control status | no | Backend Owner / Contract Owner |
| timeout config | `stageTimeoutMs` (30 000 default), `overallTimeoutMs` (90 000 default) | number ms | Client-enforced deadlines (`Promise.race`; Moss APIs take no `AbortSignal`) | optional | code | code constant | `INFERRED_FROM_CODE` | defaults apply | Not evidence; must not become a Provider-timeout claim | yes | Provider Owner |

## 9. Must remain opaque inside the Moss Adapter

These values must not become generic Core fields without a Contract Owner decision:

1. `raw.action.children[].transaction` payload (`data`, `value`, `from`, `to`) — exact calldata stays Adapter-side; generic `action` is a summary.
2. `raw.simulation.results[]` records, including `receipt`, `changes`, `warnings`, and event topics/data.
3. `raw.discover[]` / `raw.load[]` capability metadata (`params`, `risk`, `tags`).
4. `results[].gas` array — until generic gas semantics are decided.
5. `approval`, `walletAffordabilityChecked`, `limitations`, `mossVersion`, stage records — currently carried in `providerData`.
6. Any endpoint URL, RPC userinfo, query secret, operator runtime path, or credential material — never persisted, always redacted.

## 10. Unresolved semantics requiring Contract Owner approval

1. Whether the generic `action` field must one day carry the exact unsigned payload instead of a summary (and how that interacts with the pipeline's prepared `unsignedTransaction`).
2. `revertReason` as a first-class generic field vs `providerData`.
3. Generic gas semantics (chain estimate vs simulated units vs fee/total cost).
4. Freshness policy and any stale threshold; whether `fetchedAt`/block inputs alone can ever justify `STALE`.
5. `runId` on `GenericEvidence`.
6. `checkedScope`/`unknownScope` membership only — the current derivation is settled as state `VERIFIED_RUNTIME` / qualification `RULE_DERIVED` (non-null fields); open is whether additional fields join it later.
7. `UNSUPPORTED` and partial/`UNKNOWN` semantics for partial responses.
8. Whether `nativeValue` keeps hex encoding or is normalized to a decimal string, and the corresponding unit contract.
9. Whether `mossVersion`/stage records stay in `providerData` or become a typed provider metadata block.
10. The final `PreparedExecution` type and whether Moss receives the pending #57 shape or a Moss-specific input.
