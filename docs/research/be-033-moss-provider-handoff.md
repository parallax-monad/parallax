# BE-033 MossProvider Input and Integration Handoff

> **Status:** Provider Owner input/handoff package — provisional, not a Contract freeze
> **Owner:** Provider Owner (`jzhao0`)
> **Related issues:** #58 (this package), #50 / BE-011 (factual baseline), #51 (merged baseline PR)
> **Scope:** Moss (`moss-kuru`) only. This package replaces nothing in BE-011; it is the Moss-specific, Backend-consumable completion of it.
> **Non-authority notice:** This document does **not** freeze the final Evidence Contract, cross-Provider status semantics, Risk policy, public API fields, `ProviderRegistry` behavior, or a generic `MossProvider` implementation. It proposes; it does not decide.
> **Review-fix note (V1):** the two historical real recordings were corrected from execution `SUCCESS` to execution `UNKNOWN`, matching their referenced `normalized.json` (halted/incomplete coverage); the required Moss Adapter input is now specified as `MossPreparedExecutionInput` V1 instead of an unresolved future type; and STALE handling is recorded as `PROPOSED / CONTRACT_OWNER_UNRESOLVED`. A deterministic cross-check test enforces the historical-status rule.

## 1. What this package is, and what it is not

BE-033 needs enough Moss-specific, truthful information for Backend Owner to implement the Moss `ProviderAdapter` integration (BE-034/035/037/038) without guessing, and for Contract Owner to review provisional mappings.

This package:

- reuses the merged BE-011 package (`docs/research/be-011-provider-input-package.md`, `fixtures/provider-registry/be-011/`) as the factual baseline rather than restating or upgrading it;
- adds Moss-only detail: identity/scope, capability matrix, field-by-field provisional mapping, provenance vs freshness separation, exact prepared-execution binding, error/control-state mapping, fixture index, reproducibility, and ownership;
- classifies every requirement by evidentiary class.

This package explicitly is **not**:

- a final Evidence Contract;
- a new Risk policy;
- a `ProviderRegistry` rewrite;
- Tenderly, NativeRpcProvider, Enso, Camelot, or chain signing/broadcasting work;
- new production Moss generic integration;
- a reason to fabricate missing real Provider evidence.

The governing principle is **FACT > inference > proposal**. Every important field or capability below carries its class: `REAL_OBSERVED`, `INFERRED_FROM_CODE`, `MOCK_ONLY`, `RULE_DERIVED`, `UNQUALIFIED`, or an evidence-state label (`VERIFIED_RUNTIME`, `SUPPORTED_DOC_ONLY`, `UNSUPPORTED`, `UNKNOWN`).

## 2. Repository facts at authoring time

| Fact | Value | Source |
| --- | --- | --- |
| Provider identity in current code | `moss-kuru` | `packages/moss-bridge/src/provider.ts` (`PROVIDER_ID`) |
| Current canonical real Moss success fixture | `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` | fixture `metadata.json` (`real: true`, `fixtureType: LIVE_SIMULATION`) |
| Merged BE-011 baseline | `docs/research/be-011-provider-input-package.md`, `fixtures/provider-registry/be-011/manifest.json` | merged PR #51 |
| Current merged Backend composition | `apps/api/src/backend/composition.ts` (dependency container; resolves a `ProviderAdapter` but has no pipeline) | merged PR #56 |
| Pending pull request #57 | PR #57 `apps/api/src/backend/pipeline.ts` (`BackendPipelinePreparedExecution`) | **OPEN, unmerged**; its shape is compatible with the specified `MossPreparedExecutionInput` V1 — see §7.2 |
| Registered Moss adapter in Backend | none exists | `apps/api/src/backend/` contains no `moss` adapter |

**Merged current behavior vs pending #57.** PR #57 (`feat/backend-pipeline-integration-pr-b`, "feat(api): integrate backend pipeline runtime") is still **OPEN and unmerged** and is **not** described here as merged. Therefore:

- the **required Moss Adapter input binding is specified** by Provider Owner as `MossPreparedExecutionInput` V1 (§7.2), independently of whether #57 merges;
- the current PR #57 `BackendPipelinePreparedExecution<NormalizedIntent>` shape is **compatible** with that binding, but is only a compatibility reference, not a merged fact;
- statements about *current* Backend behavior are limited to merged `main`;
- nothing in this package claims that the generic Moss Adapter path is merged, implemented, or runtime-qualified.

If #57 merges with a changed shape, Backend re-derives the exact field list, but the required V1 binding material does not change. See §7.

### 2.1 Readiness statement

| Claim | Status |
| --- | --- |
| Provider Owner BE-033 input/handoff package | **Complete** |
| Required Moss Adapter V1 prepared-execution binding | **Specified** (`MossPreparedExecutionInput` V1, §7.2) |
| Backend `MossProvider` Adapter implementation | **Remaining work** — BE-034/035/037/038, Backend Owner |
| Shared/final Evidence Contract semantics | **Remaining work** — Contract Owner |
| PR #57 | **Open, not merged** |
| Production Moss Adapter implemented | **No** |
| Final shared Evidence Contract frozen | **No** |

## 3. Evidence classification vocabulary

### 3.1 Support states (reused from BE-011, unchanged)

| State | Meaning |
| --- | --- |
| `VERIFIED_RUNTIME` | A real repository-catalogued runtime observation demonstrates the capability on the stated Provider / Chain / Protocol path. |
| `SUPPORTED_DOC_ONLY` | Authoritative documentation or an approved feasibility record supports it, but no qualifying real response exists. |
| `UNSUPPORTED` | Intentionally outside this Provider's responsibility, or absent from the relevant surface. |
| `UNKNOWN` | Evidence is insufficient for a stronger claim. |

### 3.2 Qualification classes (new in BE-033, for field-level facts)

| Class | Meaning |
| --- | --- |
| `REAL_OBSERVED` | Directly present in a real, sanitized, repository-catalogued observation. |
| `INFERRED_FROM_CODE` | Not directly observed; derived from reading current implementation code. |
| `MOCK_ONLY` | Exists only in a mock/rule test input. Never promoted. |
| `RULE_DERIVED` | Produced by normalization/rule logic from other inputs; not a raw Provider field. |
| `UNQUALIFIED` | Meaning or existence is not established. |

`RULE_DERIVED` describes fields the code *computes* (for example simulation coverage, the asset-change assessment, approval status). A `RULE_DERIVED` output can still be `VERIFIED_RUNTIME` as a *capability*, but the field itself is not a Provider-returned value and must not be documented as one.

## 4. BE-033 requirement gap audit

This is the internal gap audit required before editing tracked files. It is kept as durable evidence because it is the resolution record for every #58 acceptance criterion.

| # | #58 requirement | Class | Resolution / owner |
| --- | --- | --- | --- |
| 1 | Versioned input package linked from #58 | `ALREADY_DOCUMENTED_BUT_NEEDS_BE033_PACKAGING` | This document + `fixtures/provider-registry/be-033/moss/`; issue comment links them |
| 2 | Every required field has source, qualification, missing-value behavior | `ALREADY_DOCUMENTED_BUT_NEEDS_BE033_PACKAGING` | `docs/research/be-033-moss-field-mapping.md` |
| 3 | Real vs mock vs rule-derived vs documentation-only separated | `ALREADY_DOCUMENTED_BUT_NEEDS_BE033_PACKAGING` | §5, §9, fixture index `real`/`evidenceClass` |
| 4 | Unavailable real cases explicit with fail-closed expectations | `UNAVAILABLE_REAL_EVIDENCE` | §8 table; fixture index `evidenceClass: "UNAVAILABLE"`, `path: null` |
| 5 | Provenance separated from freshness policy | `ALREADY_PROVEN` (facts) + `CONTRACT_OWNER_DECISION_REQUIRED` (policy) | §6 |
| 6 | Exact prepared-execution binding specified | `ALREADY_PROVEN` (specified) + `BACKEND_OWNER_IMPLEMENTATION_REQUIRED` (legacy path) + `CONTRACT_OWNER_DECISION_REQUIRED` (final shared type only) | §7.2 `MossPreparedExecutionInput` V1; PR #57 remains open and is only a compatibility reference |
| 7 | Provider raw types stay out of generic Core | `ALREADY_PROVEN` | `packages/contracts/src/generic-evidence.ts` `providerData` + `provenance.runtime`; §7.2.4 |
| 8 | Contract Owner can review provisional mappings | `CONTRACT_OWNER_DECISION_REQUIRED` | §12 unresolved list in field mapping; §13 |
| 9 | Backend can implement BE-034/035/037/038 without guessing | `CAN_BE_PROVEN_FROM_EXISTING_CODE` + this package | §7, §8, fixture index |
| A | Moss provider identity / runtime / chain / protocol scope | `CAN_BE_PROVEN_FROM_EXISTING_REAL_FIXTURE` | §5.1 |
| B | Capability matrix incl. evaluation, execution, quote, unsigned tx, asset/balance changes, gas, revert reason, block context, provenance, freshness, checked/unknown scope | `ALREADY_DOCUMENTED_BUT_NEEDS_BE033_PACKAGING` (Moss column only) + `UNAVAILABLE_REAL_EVIDENCE` (revert/timeout) | §5.2 |
| C | Field-by-field provisional mapping | `ALREADY_DOCUMENTED_BUT_NEEDS_BE033_PACKAGING` | `docs/research/be-033-moss-field-mapping.md` |
| D | Real success sample with request context | `ALREADY_PROVEN` | `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` |
| E | Real revert/failure/timeout samples | `UNAVAILABLE_REAL_EVIDENCE` | §8; **no new live probe run** |
| F | Machine-readable Moss fixture index | `ALREADY_DOCUMENTED_BUT_NEEDS_BE033_PACKAGING` | `fixtures/provider-registry/be-033/moss/fixture-index.json` |
| G | Deterministic offline loading for Backend tests | `CAN_BE_PROVEN_FROM_EXISTING_CODE` | §10 |
| H | `supports(...)` / `evaluate(...)` expectations | `CAN_BE_PROVEN_FROM_EXISTING_CODE` (§7.3 legacy) + `BACKEND_OWNER_IMPLEMENTATION_REQUIRED` (target) | §7 |

**No item is classified `MOCK_OR_RULE_ONLY` as a satisfying proof.** Where only mock/rule evidence exists (revert normalization, integration failure classification), the item is resolved as `UNAVAILABLE_REAL_EVIDENCE` plus a documented fail-closed expectation, exactly as #58 permits.

## 5. Provider identity, scope, and capability matrix

### 5.1 Factual current Moss identity and supported scope

| Fact | Value | Class |
| --- | --- | --- |
| `providerId` | `moss-kuru` | `REAL_OBSERVED` (code constant; also emitted in real fixture-derived Generic Evidence) |
| Observed runtime version | `0.1.0` | `REAL_OBSERVED` |
| Observed runtime revision | `ef15448e166f31c891e80dba5073dae04a052a2b` | `REAL_OBSERVED` |
| Observed protocol package | `@themoss/protocol-kuru@0.1.0` | `REAL_OBSERVED` |
| `chainId` | `143` (Monad) | `REAL_OBSERVED` |
| Protocol | `kuru` | `REAL_OBSERVED` |
| Intent scope | swap/check `MON -> 0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (USDC), amountIn `0.01` | `REAL_OBSERVED` |
| Direction also recorded (non-success-real) | `USDC -> MON` recorded replay fixture | `REAL_OBSERVED` (historical recording, see §9) |
| Input prerequisites | generic `swap/check` intent (`chainId`, `sender`, `tokenIn`, `tokenOut`, `amountIn`, optional `minimumReceived` + source); configured `MOSS_RUNTIME_PATH`; environment-supplied RPC URL; runtime version + revision | `INFERRED_FROM_CODE` |
| Unsupported intent shapes | any `protocol !== "kuru"`; any `chainId !== 143` | `INFERRED_FROM_CODE` (`MossProvider.supports`) |

**Do not generalize.** The observed Monad × Kuru scope is the *only* Moss scope with real evidence. There is no real evidence for any other chain, protocol, direction, amount, or runtime revision. `USDC -> MON` is real but from an **older** recorded baseline (`mossCommit d09b38cbc44ee7f5722c5d09e7224f7750187762`, `mossVersion "workspace @themoss/protocol-kuru@0.1.0"`) and is **not** the canonical runtime-qualified capture.

Synthetic pre-funding caveat carried from BE-011 unchanged: Moss trace simulation synthetic-prefunds native MON only and does **not** prove ERC-20 affordability or allowance. `walletAffordabilityChecked` is `false` in all Moss evidence.

### 5.2 Moss capability matrix

States are from §3.1. "Historical compatibility path" means the current `moss-kuru` path verified by the real fixture; it is not a claim of universal Moss support.

| Capability | State | Boundary / evidence |
| --- | --- | --- |
| Evaluation / simulation | `VERIFIED_RUNTIME` | Real fixture: 5 stages OK, `simulationCoverage.complete=true`, `expectedTransactions=1`, `observedResults=1`. Limited to the historical Monad × Kuru path. |
| Execution result | `VERIFIED_RUNTIME` | Real fixture `executionStatus=SUCCESS`; `NO_ROUTE` and `REVERTED` are defined code outcomes but not real-observed from Moss (§8). |
| Quote | `VERIFIED_RUNTIME` | Historical compatibility path only. `quote.data` observed with `estimatedAmountOut="0.000223"`, `minimumAmountOut="0.000221"`. |
| Unsigned transaction construction | `VERIFIED_RUNTIME` | Historical compatibility ACTION stage produced `from`/`to`/`data`/`value`; **no signing, broadcast, custody, or wallet mutation**. |
| Asset changes | `VERIFIED_RUNTIME` | Real fixture `assetChanges` array (native transfers + events), `assetChangeAssessment=EXPLAINED`. |
| Balance changes | `UNKNOWN` | No distinct generic balance-change capability is proven. `walletAffordabilityChecked=false`; synthetic pre-funding does not prove ERC-20 balances. |
| Gas | `VERIFIED_RUNTIME` | Real fixture `gas.value=["528696"]`. This is simulator-reported gas for one result, not a fee/price estimate. |
| Revert reason | `UNKNOWN` for real coverage; `SUPPORTED_DOC_ONLY` as code behavior | No real Moss revert response was captured. `packages/moss-bridge/src/errors.ts` defines revert classification, and `fixtures/chain-evidence/kuru/reverted/` is `RULE_TEST_INPUT`/`real=false`. |
| Block context | `VERIFIED_RUNTIME` | Real fixture records per-stage blocks (`94112883`), quote/action block (`94112901`), and `simulatorPinnedBlock=94112902`. Stage block ≠ simulator pinned block. |
| Provenance | `VERIFIED_RUNTIME` | Runtime version/revision, chain ID, block provenance, per-field `source`/`reproducibility`/`fetchedAt` preserved. See §6. |
| Freshness inputs | `VERIFIED_RUNTIME` (inputs only) | `fetchedAt`, block numbers, and runtime revision exist and are recorded. |
| Freshness / stale policy | `UNKNOWN` | No reviewed stale threshold or freshness policy exists. Moss path never emits `STALE`. **Do not** treat the existence of a timestamp as `freshness = VERIFIED_RUNTIME`. |
| Checked scope | `VERIFIED_RUNTIME` (qualification: `RULE_DERIVED`, per-run) | `toGenericEvidence` derives `checkedScope = ["quote","action","simulation","simulation-coverage"]` (plus `no-route`) from non-null fields; `unknownScope` is the complement. |
| Unknown scope | `VERIFIED_RUNTIME` (qualification: `RULE_DERIVED`, per-run) | See above. `revertReason` and `gas` are **not** part of the current checked/unknown derivation; they live in `providerData`. |
| Auth | `UNKNOWN` as a universal Moss value | Configured local runtime + environment-supplied RPC; RPC auth is endpoint-specific. |
| Rate limits | `UNKNOWN` | Not normalized as a universal Moss limit; not exercised. |
| Timeout | `UNKNOWN` (runtime qualification / timeout capability evidence); `UNAVAILABLE` (real timeout evidence); classification behavior is `INFERRED_FROM_CODE` | `StageTimeoutError` / `Promise.race` with 30s stage and 90s overall client-enforced deadlines, and the resulting `TIMEOUT` classification, exist in code (`INFERRED_FROM_CODE`) but are not a runtime-verified Provider capability. No real Provider timeout response was captured, so real timeout evidence is `UNAVAILABLE` and runtime qualification stays `UNKNOWN`. |
| Batch / multi-transaction execution | `SUPPORTED_DOC_ONLY` | Code supports multiple action transactions (`coverage.expectedTransactions`) but only 1 was observed. |
| ERC-20 approval | `SUPPORTED_DOC_ONLY` | `approvalStatus` is derived; the real fixture is native-in (`NOT_APPLICABLE`), the recorded `USDC -> MON` fixture is `REQUIRED`. Not real-observed as an executed approval. |

### 5.3 Concept separation (do not merge)

`runtime metadata`, `provenance`, `freshness policy`, and `decision policy` are four different things:

- **Runtime metadata**: which Moss checkout/packages produced a result (`runtimeVersion`, `runtimeRevision`, `checkoutRevision`, `commit`, `packageVersions`).
- **Provenance**: the acquisition facts (chain ID, block, timestamps, request/quote/action relationship).
- **Freshness policy**: a threshold that decides whether provenance is still good enough. **Currently `UNKNOWN`/unresolved.**
- **Decision policy**: Risk/Product thresholds and verdicts. Out of Provider ownership.

## 6. Provenance and freshness

### 6.1 Observed provenance facts (`REAL_OBSERVED`)

From `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/`:

| Fact | Value |
| --- | --- |
| Provider identity | `moss-kuru` |
| Chain identity | `143` (observed via RPC), `observedChainId=143` |
| Protocol identity | `kuru` |
| Runtime identity | version `0.1.0`, revision `ef15448e166f31c891e80dba5073dae04a052a2b` |
| Per-stage block | `DISCOVER/LOAD/QUOTE/ACTION = 94112883`, `SIMULATE = 94112901` |
| Quote/action evidence block | `94112901` (`quote.blockNumber`, `action.blockNumber`) |
| Simulator pinned block | `94112902` (`simulatorPinnedBlock`) |
| Block hash | **not present** in the fixture (block *number* only) |
| Capture timestamps | `startedAt=2026-08-08T04:39:39.273Z`, `finishedAt=2026-08-08T04:39:49.599Z` |
| Per-field fetch timestamp | `fetchedAt=2026-08-08T04:39:40.097Z` (single value applied to all sourced fields) |
| Request relationship | intent is preserved verbatim in normalized evidence; no request ID or request hash beyond `runId=kuru-live-1786163979273` |
| Quote relationship | `quote`, `receipt`, `outcome`, `assetChanges`, `gas` share block `94112901` |
| Unsigned-action relationship | `raw.action.children[].transaction` and `raw.simulation.results[].transaction` are byte-identical (`from`/`to`/`data`/`value`); the normalized `action` is a *summary*, not the payload |
| Simulation block binding | The simulator pins `94112902`, which is **one block above** the quote/action/evidence block `94112901`. Stage blocks (`94112883`) are earlier still. A stage block is never a substitute for the simulator block. |
| `mossCommit` | `ef15448e166f31c891e80dba5073dae04a052a2b` (equals `runtimeRevision`) |

### 6.2 Provenance policy distinctions

- **OBSERVED PROVENANCE FACT**: the table above. These are acquisition facts.
- **FRESHNESS POLICY**: **UNKNOWN / unresolved.** No reviewed stale threshold, head-lag budget, or freshness decision exists for Moss. The Provider Owner does not define one and states none.
- The fact that provenance contains a timestamp and a block number does **not** make `freshness = VERIFIED_RUNTIME`. Freshness semantics require a Contract Owner decision plus a qualification method; neither exists today.
- Current code does not produce `STALE` on the Moss path: `providerEvaluationStatus` maps a broken integration to `FAILED` and a verified outcome (`SUCCESS`/`NO_ROUTE`/`REVERTED`) to `SUCCESS`, and comments state that `STALE`/`UNSUPPORTED` are not produced by the Moss path.

## 7. PreparedExecution / exact execution binding

This is the most important Backend-facing section of BE-033.

### 7.1 Core invariant

The target generic `MossProvider` Adapter must consume the **exact execution that Backend/Protocol prepared for the run**. It must not silently reconstruct a different transaction from Intent when the generic pipeline supplies an exact prepared execution.

Failure to honor the binding is a control failure (`invalid`/`failed`), never a silent fallback to a self-built transaction.

### 7.2 TARGET MOSS ADAPTER INPUT — `MossPreparedExecutionInput` V1

PR #57 is still **OPEN and unmerged** and is **not** described here as merged. BE-033 no longer treats the required Moss Adapter input as unresolved merely because #57 has not merged: the Provider Owner now specifies the concrete integration input contract below. It is an **Adapter-private integration input contract/proposal**, not a freeze of the shared Evidence Contract.

```text
BackendPipelinePreparedExecution
  → buildProviderInput(...)
  → MossPreparedExecutionInput V1
  → Moss evaluation
```

`MossPreparedExecutionInput` V1 binds, without independent reconstruction:

| Required field | Source | Meaning | BE-033 handling |
| --- | --- | --- | --- |
| `runId` | Pipeline | Run identity | Binds provider evaluation to the prepared run |
| `intent` | Pipeline normalized intent | Intent already accepted by the pipeline | Must match the evaluated intent |
| `chainId` | Pipeline | Chain identity (`143` for Moss) | Gate; mismatch fails closed |
| `protocol` | Pipeline | Protocol identity (`kuru` for Moss) | Gate; mismatch fails closed |
| `quote` | Exact ProtocolAdapter quote | The quote produced for this run | Moss must consume it and **must not re-quote** |
| `unsignedTransaction` | Exact ProtocolAdapter `{ kind: "unsigned", payload }` | The transaction Moss must evaluate | Moss must evaluate **this exact transaction** |
| `blockContext` | Backend Chain `{ blockNumber, blockHash?, observedAt? }` | Chain context associated with preparation (INPUT context) | Preserved as preparation context, not as the simulator pin |
| `gasEstimate` | Backend Chain `{ gasUnits }` | Chain-level estimate | Distinct from Moss simulated gas |
| `finality` | Backend Chain `{ status, blockContext? }` | Finality context associated with preparation | Context only |

`MossPreparedExecutionInput` V1 therefore maps to the current pending `BackendPipelinePreparedExecution<NormalizedIntent>` field-for-field. That pending field list is **compatible** with this binding, and the binding is specified independently of whether #57 merges. If #57 lands with a changed shape, Backend re-derives the exact field list; the **required binding material does not change**. The final shared generic `PreparedExecution`/Evidence type remains Contract Owner scope.

#### 7.2.1 Exact-transaction invariant and fail-closed behavior

The Moss Adapter **MUST evaluate the exact prepared unsigned transaction supplied by Backend/Protocol**. It **MUST NOT** silently re-quote or rebuild a different transaction from Intent.

If the evaluated Moss transaction does not match the prepared `unsignedTransaction` in identity/material — `from` / `to` / `data` / `value`, or the applicable exact transaction representation — the Adapter must **fail closed** as `invalid` (preferred) or `failed`, and must **not** continue to Core/Decision. A mismatch is never `success` and never a silent re-quote.

This is a target-behavior requirement for Backend Owner implementation. It is not implemented on merged `main` (§7.3).

#### 7.2.2 Block and provenance ownership: INPUT vs OUTPUT

INPUT provenance/context (supplied to Moss evaluation):

- the Backend `blockContext` describes the chain context associated with preparation;
- quote provenance already present on the exact quote must be preserved where available.

OUTPUT Provider provenance (produced by Moss evaluation, and therefore **not** required as input):

- Moss runtime identity (`runtimeVersion` / `runtimeRevision` / `checkoutRevision` / `commit` / `packageVersions`);
- Moss `fetchedAt` / capture facts;
- Moss stage blocks;
- the quote/action evidence block, if observed;
- `simulatorPinnedBlock` / `provenance.simulationBlock`;
- any Provider-specific observed provenance.

**The simulator-pinned block is Provider evaluation OUTPUT and therefore does not need to exist before Moss evaluation.** It must not be required as an input field.

Four distinct block notions must not be conflated or collapsed into one another:

| Block layer | Owner | Meaning |
| --- | --- | --- |
| Backend preparation block | Backend Chain `blockContext` | Context associated with preparing quote/transaction (INPUT) |
| Moss stage block | Moss evaluation | Per-stage RPC block observation (e.g. `94112883`) |
| Moss quote/action evidence block | Moss evaluation | Block attached to quote/action evidence (e.g. `94112901`) |
| Moss simulator-pinned block | Moss evaluation | Exact simulator base block (e.g. `94112902`), OUTPUT only |

One generic `blockContext` input field cannot by itself express all four; that distinction is owned by the Adapter and by the OUTPUT provenance block, which is exactly why the simulator pin is not an input requirement.

#### 7.2.3 Legacy path (unchanged)

Current merged behavior (this is what exists on `main`, not a proposal):

- `packages/moss-bridge/src/provider.ts` `MossProvider.evaluate(input: EvidenceEvaluationInput)` receives only `{ runId, intent, tokenInDecimals, tokenOutDecimals }`.
- `MossProvider` calls `runKuruLiveSwap` with the intent and runtime configuration. The **Moss/Kuru runner builds the quote and the unsigned action internally** (DISCOVER → LOAD → QUOTE → ACTION → SIMULATE).
- `KuruLiveAgentFlow` (`packages/orchestrator/agent-flow/index.ts`) constructs `MossProvider` directly; there is no Backend pipeline and no prepared execution in the merged path.
- The merged Backend `ProviderAdapter` boundary (`apps/api/src/backend/provider-adapter.ts`) is generic (`Intent`, `Input` type parameters) and currently has **no Moss implementation**.

**So: on merged `main`, legacy ownership means Moss/Kuru produce quote/action internally.** That is a fact about the legacy path, not the target architecture. Do not describe the target generic ownership as already-merged behavior, and do not describe the legacy behavior as if it satisfied the target prepared-execution invariant.

#### 7.2.4 Ownership of raw and reconstructed material

- Moss raw request/response types (`RawKuruEvidence`, `NormalizedKuruEvidence`, `LiveKuruResult`, stage records) **must remain inside `packages/moss-bridge`** and, in the target design, inside the Backend Moss Adapter. They must not cross into generic Core.
- TARGET: the Adapter maps prepared execution + Moss observation into `GenericEvidence`; the exact unsigned transaction comes from the pipeline, and the Moss raw transaction is retained only as controlled response evidence / for equality checks.
- LEGACY: `toGenericEvidence` maps internally-built quote/action into the generic contract and exposes a non-payload **summary** in `action` plus raw payload metadata in `providerData`. It does not currently assert equality against a prepared execution because none is supplied.

#### 7.2.5 `supports(...)` and `evaluate(...)` expectations

| Surface | LEGACY (merged) | TARGET (Backend Owner work) |
| --- | --- | --- |
| `supports` | `intent.protocol === "kuru" && intent.chainId === 143`; cheap and side-effect free | Same chain/protocol gate plus capability check against the requested `capability`; must not claim capabilities the Adapter cannot honor |
| `evaluate` input | `EvidenceEvaluationInput` (`runId`, `intent`, decimals) | `MossPreparedExecutionInput` V1 per §7.2 (+ Moss runtime identity), **not** a self-built transaction |
| `evaluate` output | `GenericEvidence` (`genericEvidenceSchema.parse`) | Same generic contract; no new Core vocabulary |
| Raw output | Never escapes `evaluate` | Never escapes the Adapter |
| Failure | threw `EvidenceProviderError` or returned `provider.status !== "SUCCESS"` with `failure` set | Same; additionally fail closed as `invalid`/`failed` on missing or mismatched prepared execution (§7.2.1) |

## 8. Error and control-state mapping

### 8.1 Vocabulary in current code (do not invent new terms)

| Layer | Vocabulary | Source |
| --- | --- | --- |
| Moss normalized error `code` | `NO_ROUTE`, `REVERTED`, `TIMEOUT`, `UNAVAILABLE`, `INTEGRATION_ERROR`, `UNKNOWN` | `packages/moss-bridge/src/errors.ts` |
| Moss integration health | `OK`, `INTEGRATION_ERROR`, `UNAVAILABLE`, `TIMEOUT` | same |
| Generic provider status | `SUCCESS`, `UNKNOWN`, `UNSUPPORTED`, `FAILED`, `STALE` | `packages/contracts/src/generic-evidence.ts` |
| Generic execution status | `SUCCESS`, `NO_ROUTE`, `REVERTED`, `UNKNOWN` | same |
| Backend control status | `success`, `unsupported`, `failed`, `timeout`, `unknown`, `stale`, `invalid` | `apps/api/src/backend/control-boundary.ts` |
| Risk verdict | `PROCEED`, `ADJUST`, `STOP`, `UNKNOWN` (produced from evidence, never stored on it) | `packages/contracts` |

`ProviderAdapterErrorCode` in `provider-adapter.ts` is `UNSUPPORTED | FAILED | TIMEOUT | UNKNOWN | STALE`; `controlStatusForCode` also produces `invalid` for mismatch/forbidden codes. Note that Moss `UNAVAILABLE` maps to Backend `failed` (via `controlStatusForCode` fallthrough) unless the Adapter maps it explicitly — this mapping is **Backend Owner implementation work**, not decided here.

### 8.2 Control-state table

`REAL_SAMPLE` records whether a real Moss response sample exists in this repository. Where it is `UNAVAILABLE`, qualification is `UNKNOWN` for the real-response shape while the expected fail-closed handling is taken from existing code/contracts.

| Condition | Actual evidence class | Real sample | Expected Provider/Backend control state | Retryable | Diagnostic preserved | Must be redacted | Fail-closed consequence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Unsupported chain | `INFERRED_FROM_CODE` | No | Moss `EvidenceProviderError` code `UNSUPPORTED`; `ProviderAdapterErrorCode` `UNSUPPORTED`; Backend `unsupported` | No | providerId, message, requested chain | endpoint/secrets | No Provider call; cannot reach `PROCEED` |
| Unsupported protocol | `INFERRED_FROM_CODE` | No | Same as above | No | protocol, message | endpoint/secrets | Same |
| Unsupported input shape | `INFERRED_FROM_CODE` | No | `UNSUPPORTED` / `invalid` (schema rejection) | No | shape description | raw secrets | Same |
| Unsupported capability | `UNQUALIFIED` for Moss (no capability negotiation exists yet) | No | `UNSUPPORTED` or `unknown` — **Contract Owner decision** | Unknown | requested capability | — | Registry must not select a Provider lacking a required capability |
| Provider / integration failure | `MOCK_ONLY` input (`fixtures/chain-evidence/kuru/integration-error/`, `real=false`) | **No** | Moss `UNAVAILABLE` or `INTEGRATION_ERROR`; generic `provider.status=FAILED`; Backend `failed` | `INTEGRATION_ERROR` retryable; `UNAVAILABLE` not | classified failure (`stage`, `code`, `message`, `source`, `normalization`) | endpoint URL/userinfo/query secrets | Pipeline throws on `providerResult.status !== "success"` |
| Malformed response | `INFERRED_FROM_CODE` | No | `INTEGRATION_ERROR` / `invalid`; Risk input becomes `UNKNOWN` | Yes (`INTEGRATION_ERROR`) | parse failure shape (no raw payload beyond controlled evidence) | raw payload secrets | `provider.status=FAILED`; never `PROCEED` |
| Timeout (stage) | `INFERRED_FROM_CODE` (`StageTimeoutError`, `Promise.race` 30s) | No | Moss `TIMEOUT`; Backend `timeout` | Yes | stage name, elapsed ms | — | Timeout is never mapped to STOP or a verdict |
| Timeout (overall) | `INFERRED_FROM_CODE` (90s default) | No | Same | Yes | overall deadline | — | Same |
| Outage | `UNAVAILABLE_REAL_EVIDENCE` | **No** | `UNAVAILABLE`/`failed` | Depends on cause | availability classification | endpoint identity | Fail closed |
| Authentication failure | `UNAVAILABLE_REAL_EVIDENCE`; Moss has no documented Moss-level auth failure | **No** | `unavailable`/`failed`; **no Moss-specific auth code invented** | No | none beyond generic message | **credential material must never be captured** | Fail closed |
| Rate limit | `UNAVAILABLE_REAL_EVIDENCE` | **No** | `unavailable`/`failed`; **no Moss-specific rate-limit code invented** | Possibly (after backoff) — unqualified | none beyond generic message | — | Fail closed |
| Revert / failed evaluation | `MOCK_ONLY` (`fixtures/chain-evidence/kuru/reverted/`, `real=false`) + `RULE_DERIVED` derivation from `simulation.results[].reverted` | **No** | Moss `executionStatus=REVERTED` with `integrationStatus=OK`; generic `provider.status=SUCCESS` + `execution.status=REVERTED`; Risk remains `UNKNOWN` | No | `revertReason` when present | — | A verified revert is *not* a Provider failure; it must not become `PROCEED` |
| Partial response | `INFERRED_FROM_CODE` (`coverage.complete=false`) | No | `executionStatus=UNKNOWN`, generic `provider.status=UNKNOWN` | Unqualified | `simulationCoverage` (expected/observed/missing/unmatched) | — | Risk `UNKNOWN`; never `PROCEED` |
| Missing critical evidence | `MOCK_ONLY` (`fixtures/chain-evidence/kuru/missing-evidence/`, `real=false`) | No | `executionStatus=UNKNOWN`; `provider.status=UNKNOWN`; field `value=null` + `limitation` | Unqualified | `limitations`, null field | — | Fail closed |
| Stale evidence | `UNAVAILABLE_REAL_EVIDENCE`; no freshness policy exists | **No** | **PROPOSED / CONTRACT_OWNER_UNRESOLVED.** The Moss path has no reviewed freshness policy and does not currently emit `STALE`, so `backendControlStatus=stale` must **not** be presented as an already-decided Moss fact. Conservative unresolved behavior is `UNKNOWN` / fail closed | Unqualified | — | — | Until a freshness policy exists, Moss cannot independently classify real evidence as `STALE` and staleness is not silently treated as fresh. Generic Backend status vocabulary is unchanged |
| Unknown outcome | `INFERRED_FROM_CODE` (`executionStatus=UNKNOWN`) | No | generic `provider.status=UNKNOWN` | Unqualified | classified errors | — | Fail closed |
| No route | `MOCK_ONLY` fixture; `RULE_DERIVED` derivation requires explicit `QUOTE`/`ACTION` stage | No | `executionStatus=NO_ROUTE`, `integrationStatus=OK`; generic `provider.status=SUCCESS`; legal terminal without a simulator pinned block | No | route limitation | — | `NO_ROUTE` must not be reported as an integration failure, and must not require a fabricated block |

### 8.3 Invariant

**No Provider non-success or materially incomplete result may silently become `PROCEED`.**

Enforcement evidence:

- `toGenericEvidence` sets `provider.status=FAILED` whenever `integrationStatus !== "OK"`, and a classified `failure` requires `provider.status=FAILED` (schema-level `superRefine` in `generic-evidence.ts`).
- `KuruLiveAgentFlow.check` throws `LiveAgentFlowError` when `evidence.provider.integrationStatus !== "OK"` and never evaluates Risk on that evidence.
- Pending PR #57 `BackendPipeline.executeNormalized` throws `providerResultError(providerResult)` when `providerResult.status !== "success"` before Core/Decision run.
- `provider-result-boundary.ts` keeps every candidate field `pending_review` and `getContractOwnerApprovedCandidates` returns `[]` unless the whole change set is Contract-Owner approved.

## 9. Evidence inventory

The machine-readable index is `fixtures/provider-registry/be-033/moss/fixture-index.json`. It reuses the BE-011 fixture-index convention (same evidence-case fields) and does not replace `fixtures/provider-registry/be-011/manifest.json`, which remains the cross-Provider baseline.

### 9.1 Moss evidence cases

| id | Path | `real` | Evidence class | Proves | Does NOT prove |
| --- | --- | --- | --- | --- | --- |
| `moss-live-success-mon-to-usdc` | `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` | `true` | `REAL_LIVE_SIMULATION` | Full DISCOVER→SIMULATE success on Monad 143 × Kuru, runtime `0.1.0`/`ef15448e…`, pinned simulator block, asset changes, gas | Universal Moss support; ERC-20 affordability; revert/timeout/failure shape; freshness policy; prepared-execution binding; signing/broadcast |
| `moss-recorded-mon-to-usdc` | `fixtures/chain-evidence/kuru/mon-to-usdc/` | `true` | `REAL_RECORDED_HISTORICAL` | Historical MON→USDC recording on an older baseline (`d09b38cb…`); recorded `integrationStatus=OK`, `executionStatus=UNKNOWN` with halted/incomplete coverage (`haltReason: "Unexpected Change: Kuru market emitted FlipOrderUpdated"`) | Canonical runtime qualification (superseded by the live-success fixture for that purpose); any successful/complete execution |
| `moss-recorded-usdc-to-mon` | `fixtures/chain-evidence/kuru/usdc-to-mon/` | `true` | `REAL_RECORDED_HISTORICAL` | Historical USDC→MON recording incl. `approval=REQUIRED` derivation; recorded `integrationStatus=OK`, `executionStatus=UNKNOWN` with halted/incomplete coverage (`haltReason: "execution reverted"`) | Executed ERC-20 approval; canonical runtime qualification; any successful/complete execution |
| `moss-unsupported-guard` | `null` | `false` | `DETERMINISTIC_RULE_GUARD` | `supports` rejects non-Kuru/non-143 without invoking the runner | Anything about real Provider behavior |
| `moss-reverted-mock` | `fixtures/chain-evidence/kuru/reverted/` | `false` | `RULE_TEST_INPUT` | Revert normalization/rule behavior only (`source: "mock"`) | Any real Moss revert response |
| `moss-integration-error-mock` | `fixtures/chain-evidence/kuru/integration-error/` | `false` | `RULE_TEST_INPUT` | Integration-failure classification only | Any real Moss failure/outage response |
| `moss-missing-evidence-mock` | `fixtures/chain-evidence/kuru/missing-evidence/` | `false` | `RULE_TEST_INPUT` | Missing-evidence `UNKNOWN` behavior | Any real partial response |
| `moss-no-route-mock` | `fixtures/chain-evidence/kuru/no-route/` | `false` | `RULE_TEST_INPUT` | `NO_ROUTE` mapping only | Any real no-route response |
| `moss-replay-mon-to-usdc` | `fixtures/replay-data/mon-to-usdc.json` | `false` (recorded replay envelope) | `RECORDED_REPLAY` | Replay-mode contract behavior | Live Provider behavior |
| `moss-replay-usdc-to-mon` | `fixtures/replay-data/usdc-to-mon.json` | `false` | `RECORDED_REPLAY` | Same | Same |
| `moss-timeout` | `null` | `false` | `UNAVAILABLE` | Documented fail-closed expectation + code classification only | Any real timeout response |
| `moss-outage` | `null` | `false` | `UNAVAILABLE` | Expected fail-closed handling | Any real outage response |
| `moss-auth-failure` | `null` | `false` | `UNAVAILABLE` | Expected fail-closed handling; no Moss auth code invented | Any real auth failure |
| `moss-rate-limit` | `null` | `false` | `UNAVAILABLE` | Expected fail-closed handling; no Moss rate-limit code invented | Any real rate-limit response |
| `moss-malformed-response` | `null` | `false` | `UNAVAILABLE` | Expected fail-closed handling | Any real malformed response |
| `moss-partial-response` | `null` | `false` | `UNAVAILABLE` | Expected fail-closed handling | Any real partial response |
| `moss-stale-evidence` | `null` | `false` | `UNAVAILABLE` | Freshness policy remains unresolved | Any real stale response; any freshness policy |
| `moss-unknown-outcome` | `null` | `false` | `UNAVAILABLE` | Expected fail-closed handling | Any real unknown-outcome response |

### 9.2 Fixture acceptance criteria and results

| Criterion | Result |
| --- | --- |
| Success fixture path and scope | Canonical: `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/`; scope = Monad 143 × Kuru × Moss `0.1.0`/`ef15448e…`, MON→USDC `0.01` |
| Failure/revert/timeout/unsupported fixtures with `real` flag + qualification | Failure/revert = mock (`real=false`, `RULE_TEST_INPUT`); timeout/outage/auth/rate-limit/malformed/partial/stale = `real=false`, `UNAVAILABLE`, `path=null`; unsupported = deterministic guard (`path=null`) |
| Provider/chain/protocol/request context per fixture | Present in the index and in each fixture's existing `metadata.json`; `null` where legitimately unknown |
| Capture commit/block/timestamp metadata | Present for real fixtures (`parallaxCommit`, `mossRuntimeRevision`/`mossCommit`, block, `startedAt`/`finishedAt`/`recordedAt`) |
| Deterministic offline loading | §10 |
| No secrets/private endpoints/credentials/private keys | Verified by secret scan (§13) and by the existing redaction tests |
| No silent overwrite; unavailable evidence explicit | Index uses `path: null` + `UNAVAILABLE`; no fixture was written or modified by BE-033 |

## 10. Reproducibility

The fixture directory README (`fixtures/provider-registry/be-033/moss/README.md`) documents the same rules. Summary:

- **Immutable historical observations**: `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/`, `mon-to-usdc/`, `usdc-to-mon/`. Do not rewrite, re-capture over, or "fix" them. If a newer capture is needed, create a new uniquely-named directory.
- **Mocks / rule inputs**: `reverted/`, `integration-error/`, `missing-evidence/`, `no-route/`. These are deterministic and must stay labelled `real=false`.
- **Replay envelopes**: `fixtures/replay-data/*.json` — demo/replay contract inputs, not live Provider responses.
- **Offline loading for Backend tests**: read the canonical fixture JSON directly from the repository (`readFileSync(new URL(relativePath, import.meta.url))`), exactly as `packages/moss-bridge/test/normalize.test.ts` and `test/live-kuru.test.ts` already do. No network, no RPC URL, no `MOSS_RUNTIME_PATH`, and no RPC/provider secret is required for deterministic contract tests.
- **Network-dependent tests** stay out of the default suite: `pnpm test` excludes `*.integration.test.ts`; the live smoke is a separate opt-in script (`pnpm smoke:kuru:live`) requiring an operator-supplied runtime and RPC.
- **No silent overwrite**: the live smoke writes the gitignored `.smoke-live/` staging directory first and only promotes the formal fixture after the acceptance gate passes.
- **Why unavailable evidence is explicit**: an absent `path` with `evidenceClass: "UNAVAILABLE"` is a truthful statement. Fabricating a response to make the package look complete would corrupt every downstream capability and control-state claim.

## 11. Field-by-field provisional mapping

The full table lives in `docs/research/be-033-moss-field-mapping.md`. It covers, for every Moss field Backend may consume: raw/source path, raw type, meaning, units/encoding, required/optional/nullable behavior, source, validity conditions, qualification class, missing/malformed behavior, proposed provider-neutral mapping, whether it must remain opaque inside the Moss Adapter, and the unresolved semantic owner.

It is explicitly a **provisional mapping**, not final Contract semantics.

## 12. Ownership

### Provider Owner (`jzhao0`)

- Moss factual research and evidence qualification.
- Field meaning and honest units/encoding.
- Capability qualification and the `real`/mock/rule classification.
- Fixture qualification and this handoff package.
- Adapter-specific mapping **proposal** (not decision).

### Backend Owner

- Concrete Moss `ProviderAdapter` implementation and composition wiring.
- `ProviderRegistry` integration for the Moss provider.
- PreparedExecution runtime plumbing into the Moss Adapter (per §7).
- Fail-closed pipeline behavior and non-success → error mapping.
- Public application integration.

### Contract Owner

- Final shared Evidence fields and any new generic vocabulary.
- Cross-Provider status semantics (especially `UNAVAILABLE` → Backend `failed` vs `unavailable`).
- Public metadata semantics.
- Freshness semantics and any stale threshold framework.
- Compatibility decisions (including whether legacy Moss quote/action ownership must change).

### Product / Risk Owner

- Any threshold, economic-boundary, or business/risk decision policy.
- Whether `UNSUPPORTED`/`UNKNOWN` results surface as user-visible limitations.

### Ownership boundary between the two Moss paths

| Concern | Legacy (merged) | Target (Backend Owner) |
| --- | --- | --- |
| Quote / unsigned tx ownership | Moss/Kuru runner builds them internally | Protocol adapter builds them; Moss consumes the exact prepared execution |
| Migration status | Implemented and merged | **Not implemented** — Backend implementation work |
| Contract impact | None | May require a Moss-specific input type; Contract Owner reviews |

## 13. Unresolved Contract Owner decisions

1. **Final shared generic `PreparedExecution`/Evidence type** — only the shared/final type remains open. The required Moss Adapter input binding is already specified as `MossPreparedExecutionInput` V1 (§7.2), including how the four block notions relate and why the simulator pin is Provider evaluation OUTPUT.
2. **`UNAVAILABLE` → Backend control status** — `controlStatusForCode("UNAVAILABLE")` currently falls through to `failed`. Confirm intended mapping for Moss.
3. **Revert-reason semantics** — whether `revertReason` becomes a first-class generic field or stays inside `providerData`.
4. **Gas semantics** — distinguish chain `gasUnits` (estimate), Moss simulator gas (observed units for one result), and any future fee/total-cost field. Risk usage is Risk Owner scope.
5. **Freshness semantics and stale threshold** — currently `UNKNOWN`; no policy exists, so `backendControlStatus=stale` is `PROPOSED / CONTRACT_OWNER_UNRESOLVED` and Moss cannot independently classify real evidence as `STALE` (conservative behavior: `UNKNOWN` / fail closed).
6. **Capability vocabulary** — `ProviderCapability` is currently `string`; whether Moss capability tokens (`quote`, `action`, `simulate`, plus future `prepared-execution`) become canonical.
7. **`checkedScope`/`unknownScope` membership** — the current derivation is settled: state `VERIFIED_RUNTIME` with `RULE_DERIVED` qualification (non-null `quote`/`action`/`receipt`-or-`outcome`/`simulationCoverage`, plus `no-route`). Open only: whether additional fields (`revertReason`/`gas`/freshness) should later join the derivation.
8. **Partial-response semantics** — whether `coverage.complete=false` is `UNKNOWN` or a distinct generic partial state.
9. **Cross-Provider Evidence impact** — whether any of the above changes `packages/contracts` for all providers, not just Moss.

## 14. No new live probe

**No new live Moss probe was run for BE-033.**

Rationale, per the task constraints: the real success evidence already in the repository is sufficient for every positive factual statement this package makes; #58 explicitly permits unavailable real evidence; the remaining gaps (revert, timeout, outage, auth, rate limit, malformed, partial, stale) cannot be produced by a read-only, non-destructive, secret-safe probe against a live Moss runtime without either destabilizing the environment or fabricating a scenario. Running one would not have produced materially better evidence and would risk a misleading "checklist symmetry" capture.

## 15. Sources inspected

- Issues: #58, merged PR #51, pending PR #57.
- Docs: `docs/research/be-011-provider-input-package.md`, `docs/integration/moss-kuru-live-runtime.md`, `docs/integration/backend-p0-acceptance.md`, `docs/planning/arbitrum-open-house/02-B-provider-implementation.md`, `docs/README.md`.
- Moss implementation: `packages/moss-bridge/src/{provider,normalize,errors,live-kuru,live-acceptance,kuru,types,serialize,index}.ts`, `packages/moss-bridge/test/*.test.ts`.
- Contracts: `packages/contracts/src/{generic-evidence,evidence-provider}.ts`.
- Backend: `apps/api/src/backend/{provider-adapter,provider-result-boundary,provider-registry,control-boundary,composition}.ts`; pending `apps/api/src/backend/pipeline.ts` (PR #57).
- Orchestrator legacy flow: `packages/orchestrator/agent-flow/index.ts`.
- Fixtures: `fixtures/chain-evidence/kuru/`, `fixtures/replay-data/`, `fixtures/provider-registry/be-011/`.

## 16. Completion gate for BE-033 Provider Owner input

Moss Provider Owner input is ready for Backend integration when:

- the capability matrix covers every Moss capability in §5.2 with an explicit state;
- every consumable field has a source, qualification class, and missing-value behavior;
- real vs mock/rule/replay/unavailable evidence is unmistakable;
- non-success control states are mapped with explicit fail-closed behavior, including where no real sample exists;
- provenance is separated from freshness policy, and freshness policy is recorded as unresolved;
- the exact prepared-execution binding is specified for the target Adapter as `MossPreparedExecutionInput` V1 (§7.2), and the legacy ownership is distinguished from it;
- no Moss raw type is required to leak into generic Core;
- no final Contract semantics are frozen by this package.

All of the above are satisfied by this package, so all nine #58 acceptance criteria are met by Provider Owner work. The remaining items are **not** blockers to BE-033: they are Contract Owner decisions (§13) and Backend Owner implementation (§12), neither of which is a Provider Owner deliverable. PR #57 is still open and is not described as merged; the required V1 binding holds independently of it.
