# BE-011 Provider Owner Input Package

> **Status:** Draft checkpoint v1 — Native RPC real surface qualification
> **Owner:** Provider Owner (`jzhao0`)
> **Related issue:** #50
> **Purpose:** ProviderRegistry input collection only.
> **Non-authority notice:** This document does **not** freeze ProviderRegistry, the final Evidence Contract, Risk semantics, public API fields, or cross-Provider business semantics.

## 1. Why this package exists

BE-011 needs enough verified Provider information for Backend to design a fail-closed `ProviderRegistry` without guessing:

- which Provider can evaluate which Intent / Chain / Protocol combination;
- which capabilities are actually available;
- which claims are runtime-verified versus documentation-only;
- which Provider failures must remain `unsupported`, `failed`, `timeout`, `unknown`, or `stale`;
- which deterministic fixtures Backend can use without network access or secrets.

This package is intentionally evidence-first. A capability is not promoted to runtime-verified merely because code, tests, or vendor documentation describe it.

## 2. Support-state vocabulary

| State | Meaning |
| --- | --- |
| `VERIFIED_RUNTIME` | A real repository-catalogued runtime observation demonstrates the capability on the stated Provider / Chain / Protocol path. |
| `SUPPORTED_DOC_ONLY` | Current authoritative documentation or an approved feasibility record supports the capability, but no qualifying real response has been captured for BE-011. |
| `UNSUPPORTED` | The capability is intentionally outside this Provider's responsibility or is absent from the relevant standard surface. |
| `UNKNOWN` | Evidence is insufficient to make a stronger claim. |

Additional scope labels such as `P0_TARGET`, `P0_CONTROLLED_FALLBACK`, and `DEFERRED_OPTIONAL` describe project scope only; they are not Provider capability states.

## 3. Current Provider scope

### 3.1 MossProvider — current compatibility path

Canonical Provider identity in current code:

```text
moss-kuru
```

Observed real fixture:

```text
fixtures/chain-evidence/kuru/live-success-mon-to-usdc/
```

The fixture records:

- Monad chain ID `143`;
- protocol `kuru`;
- Moss runtime version `0.1.0`;
- Moss runtime revision `ef15448e166f31c891e80dba5073dae04a052a2b`;
- successful DISCOVER / LOAD / QUOTE / ACTION / SIMULATE stages;
- unsigned action construction;
- simulation coverage `complete=true`;
- observed chain and block provenance;
- execution status `SUCCESS`;
- real asset-change and gas evidence;
- explicit no-signing / no-broadcast / no-custody limitations.

The fixture is real but its own metadata says `PARTIALLY_VERIFIED`; therefore BE-011 must preserve the stated limitations rather than upgrading every Moss field to universal runtime support.

### 3.2 TenderlyProvider — Arbitrum Sepolia P0 target

Current project feasibility work supports Tenderly on Arbitrum Sepolia only at:

```text
SUPPORTED_DOC_ONLY
```

until a credentialed probe is executed and sanitized.

Provider responsibilities begin from an exact prepared unsigned execution supplied by Protocol / Backend. Tenderly must **not**:

- create the Camelot quote;
- rebuild Camelot calldata from Intent;
- sign or broadcast the user's swap.

Required Contract/Backend gate carried from #42:

```text
PreparedExecution
= quote + exact ordered unsigned transaction plan + chain/protocol identity + provenance
```

Tenderly / Native RPC must later fail closed when that input is missing or mismatched.

### 3.3 NativeRpcProvider — controlled P0 fallback

Standard EVM JSON-RPC is a **partial evidence** source, not a semantic replacement for Tenderly.

Canonical guarded capture:

```text
fixtures/provider-registry/be-011/native-rpc/arbitrum-sepolia-public-2026-09-10T12-19-45-890Z/
```

Its recorded `repositoryHeadAtCapture` is the exact commit containing the probe
source, so the capture is reproducible from that revision. The earlier
`arbitrum-sepolia-public-2026-09-08` capture is retained as
`HISTORICAL_PRE_GUARD_CAPTURE`: its recorded `repositoryHeadAtCapture` does not
contain the probe source. Its recorded observation values are unchanged and its
provenance defect is not retroactively fixed.

The guarded probe writes each capture into a unique UTC-timestamped directory
(`arbitrum-sepolia-public-YYYY-MM-DDTHH-MM-SS-mmmZ`), fails instead of
overwriting an existing capture, and only creates the final capture directory
after every required live observation passed validation.

The capture records the official Arbitrum Sepolia public endpoint class, the
observed Nitro client identity, `chainId=421614`, one pinned block, non-empty
WETH code, successful pinned `decimals()` and `balanceOf()` reads, a controlled
WETH `transfer` revert envelope (JSON-RPC code `3` whose ABI `Error(string)`
payload is validated against the expected reason), a successful pinned
`eth_estimateGas`, and one real JSON-RPC `-32601` method-not-found envelope.
Protocol and Intent are deliberately `null`: this WETH probe is not a Camelot
transaction and does not qualify `PreparedExecution` or a
`NativeRpcProvider` implementation.

The completed real checkpoint method sequence is recorded in section 7.2. It
includes chain and pinned-block context, `eth_getCode`, pinned `eth_call`, and
pinned `eth_estimateGas`; it does **not** include `eth_getBalance`.
`eth_getBalance` therefore remains a conditional future read with `UNKNOWN`
runtime qualification and must not be promoted from this checkpoint. The
recorded ERC-20 `balanceOf` `eth_call` does not qualify native balance reads.
Protocol-aware ERC-20 `balanceOf` / `allowance` calls likewise require trusted
addresses / ABI semantics; only the recorded WETH `balanceOf` call was executed.

Standard RPC does not itself produce a hypothetical receipt, generic hypothetical logs, state diff, or complete asset-change set.

### 3.4 EnsoProvider — deferred

Enso remains optional Strong/Best-stage work. It is not a P0 prerequisite and must not be silently inserted into current ProviderRegistry selection logic before a separate scope/qualification decision.

## 4. Capability matrix

| Capability | `moss-kuru` | Tenderly / Arbitrum Sepolia | Native RPC / Arbitrum Sepolia | Enso |
| --- | --- | --- | --- | --- |
| Provider identity/version | `VERIFIED_RUNTIME` for observed Moss fixture | `UNKNOWN` runtime version | endpoint client identity `VERIFIED_RUNTIME`; `NativeRpcProvider` version not applicable because it is not implemented | `UNKNOWN` |
| Swap/check Intent | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` via future PreparedExecution | `SUPPORTED_DOC_ONLY` via future PreparedExecution | `UNKNOWN` |
| Chain | `143` `VERIFIED_RUNTIME` | `421614` `SUPPORTED_DOC_ONLY` | `421614` `VERIFIED_RUNTIME` at the captured endpoint | `UNKNOWN` |
| Protocol | `kuru` `VERIFIED_RUNTIME` | `camelot-v3` `SUPPORTED_DOC_ONLY` project target | `camelot-v3` remains `SUPPORTED_DOC_ONLY`; the real WETH surface probe has `protocol=null` | `UNKNOWN` |
| Quote | `VERIFIED_RUNTIME` compatibility path | `UNSUPPORTED` by Provider ownership | `UNSUPPORTED` by Provider ownership | `UNKNOWN` |
| Unsigned tx construction | `VERIFIED_RUNTIME` compatibility ACTION stage | `UNSUPPORTED` by Provider ownership | `UNSUPPORTED` by Provider ownership | `UNKNOWN` |
| Simulation/evaluation | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY`; the observed `eth_call` / `eth_estimateGas` mechanics do not prove complete generic simulation or evaluation | `UNKNOWN` |
| Execution result | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY`; the observed `eth_call` envelope is not a full generic execution result or hypothetical receipt | `UNKNOWN` |
| Asset changes | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `UNSUPPORTED` on standard hypothetical RPC | `UNKNOWN` |
| Balance changes | `UNKNOWN` as a distinct capability | `SUPPORTED_DOC_ONLY` | `UNSUPPORTED` as generic hypothetical post-state change; the recorded ERC-20 `balanceOf` `eth_call` read is `VERIFIED_RUNTIME`, but native `eth_getBalance` was not executed and is `UNKNOWN` | `UNKNOWN` |
| Gas | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` as a generic/registry-level gas capability; only the narrow pinned `eth_estimateGas` mechanic is `VERIFIED_RUNTIME` (estimate, not gas used) | `UNKNOWN` |
| Revert reason | `UNKNOWN` for **real** BE-011 response coverage | `SUPPORTED_DOC_ONLY` | `UNKNOWN`; a real `eth_call` error message/data envelope was observed, but it does not prove the final generic Provider revert-reason semantic | `UNKNOWN` |
| Block context | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `VERIFIED_RUNTIME` for captured head/block/hash/time | `UNKNOWN` |
| Provenance | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `VERIFIED_RUNTIME` for request timestamps and pinned block; final Provider mapping unimplemented | `UNKNOWN` |
| Freshness evidence | block/time provenance `VERIFIED_RUNTIME`; generic freshness/stale evaluation `UNKNOWN` — no universal stale threshold or freshness policy is defined or runtime-qualified | block provenance `SUPPORTED_DOC_ONLY`, policy `UNKNOWN` | `SUPPORTED_DOC_ONLY`; block context/provenance inputs are observed, but final freshness semantics and threshold remain unqualified | `UNKNOWN` |

### Native RPC narrower observed mechanics

These states describe only the recorded RPC mechanics. They do not promote the
top-level generic/registry capabilities above.

| Observed mechanic | State | Evidence boundary |
| --- | --- | --- |
| `chainIdentity` | `VERIFIED_RUNTIME` | `eth_chainId=0x66eee` / `421614` from the captured endpoint. |
| `contractCodeRead` | `VERIFIED_RUNTIME` | Pinned `eth_getCode` returned non-empty code for the recorded WETH contract. |
| `ethCallRead` | `VERIFIED_RUNTIME` | Pinned WETH `decimals()` and `balanceOf()` reads succeeded; this is not complete transaction simulation. |
| `ethCallRevertErrorEnvelope` | `VERIFIED_RUNTIME` | A controlled pinned WETH `transfer(..., 1)` call returned a real JSON-RPC code `3` envelope whose ABI `Error(string)` payload decodes to the expected controlled reason; no final Provider revert-reason semantic is inferred. |
| `ethEstimateGas` (narrow mechanic) | `VERIFIED_RUNTIME` | The pinned WETH `decimals()` estimate returned `31404`; this is the narrow `ethEstimateGas` RPC mechanic only, an estimate, not simulated gas used. Generic/registry-level gas capability remains `SUPPORTED_DOC_ONLY` (see matrix). |
| `blockContext` | `VERIFIED_RUNTIME` | The captured block number, hash, and timestamp are pinned in the fixture. |
| `provenance` | `VERIFIED_RUNTIME` | Request timestamps and the pinned block are recorded. |
| `methodNotFoundEnvelope` | `VERIFIED_RUNTIME` | A namespaced nonexistent method returned the JSON-RPC `-32601` method-not-found envelope; this is an observed `-32601` envelope only, NOT a final Provider `UNSUPPORTED` classification. |
| `eth_getBalance` | `UNKNOWN` | Not executed in the real checkpoint. Native balance-read qualification must not be inferred from the recorded ERC-20 `balanceOf` `eth_call`. |

`eth_getBalance` is therefore explicitly listed as `UNKNOWN` rather than
simply omitted: it was not executed in the real checkpoint and remains a
conditional future read with no runtime qualification.

### Registry-facing consequences

The matrix currently supports these safe design conclusions:

1. `moss-kuru` may be selected only for the Monad/Kuru compatibility path it actually supports.
2. Tenderly is **not yet** a runtime-selectable verified Provider for Arbitrum Sepolia.
3. Native RPC now has a runtime-verified controlled partial RPC surface, but no
   `NativeRpcProvider` implementation exists and it is not a verified complete
   simulation Provider. Any future adapter must advertise a narrower
   capability set than Tenderly.
4. `quote` and unsigned transaction construction must not become requirements that force future Tenderly/Native Providers to own Protocol responsibilities.
5. Required capability mismatch must fail closed; registry selection must never silently downgrade a required full-simulation request to partial Native RPC evidence.
6. Enso is not a current registry candidate.

## 5. Current evidence inventory

### 5.1 Moss real response evidence

#### Success — available

Source:

```text
fixtures/chain-evidence/kuru/live-success-mon-to-usdc/
```

Classification:

```text
REAL / LIVE_SIMULATION
```

Useful BE-011 facts:

- request Intent is preserved;
- `chainId=143`, `protocol=kuru`;
- runtime identity is preserved;
- quote and unsigned action were built;
- simulation ran against an explicit pinned block;
- simulation coverage is complete;
- asset changes and gas are captured;
- result is reproducible as a sanitized repository fixture;
- no credential or private key is stored.

#### Unsupported — deterministic local evidence available

`MossProvider.supports` and the provider evaluation guard only accept Monad/Kuru. Unsupported Intent must remain `UNSUPPORTED` and must not call the live runner.

For BE-011 this can be represented by an offline fixture/test; a paid/live external request is unnecessary.

#### Failure — real Provider response coverage incomplete

Repository mock/rule fixtures already exercise integration failures, but they are **not real Provider responses** and must remain labelled as such.

Required action:

```text
record explicit unavailable-evidence note
or
capture a sanitized real failure in a controlled non-destructive probe
```

#### Timeout — real Provider response coverage unavailable

Current code classifies timeout failures, but BE-011 does not yet have a catalogued real timeout response.

Required action: explicit unavailable-evidence note unless a safe bounded runtime probe can produce one without destabilizing the environment.

#### Revert / revert reason — real response coverage unavailable

The existing `fixtures/chain-evidence/kuru/reverted/` entry is a `RULE_TEST_INPUT` with `real=false`. It proves rule/normalization behavior only and must not be promoted to a real Provider observation.

#### Stale/incomplete — real stale path unavailable

Moss exposes block/time provenance. Current Moss evaluation does not itself produce a generic `STALE` status. Missing/incomplete evidence fixtures exist for deterministic fail-closed testing but must not be called real Provider observations.

### 5.2 Tenderly real response evidence

Current state:

```text
NO CREDENTIALED RESPONSE CAPTURED
```

Therefore all runtime response slots remain unavailable:

- success;
- unsupported;
- provider failure;
- timeout/network failure;
- stale/incomplete.

No fabricated Tenderly JSON may be committed.

### 5.3 Native RPC real response evidence

Current state:

```text
REAL CONTROLLED PARTIAL SURFACE QUALIFICATION CAPTURED
```

Canonical guarded capture (section 7.2):

```text
fixtures/provider-registry/be-011/native-rpc/arbitrum-sepolia-public-2026-09-10T12-19-45-890Z/
```

The pre-guard capture below is retained as `HISTORICAL_PRE_GUARD_CAPTURE`: its
recorded `repositoryHeadAtCapture` does not contain the probe source, its
recorded observation values are unchanged, and its provenance defect is not
retroactively fixed:

```text
fixtures/provider-registry/be-011/native-rpc/arbitrum-sepolia-public-2026-09-08/
```

Observed facts at pinned block `307414719`:

- endpoint class `arbitrum-official-public`;
- endpoint client identity
  `nitro/v3.12.0-rc.2+19e94c6-20260901T094258Z/linux-amd64/go1.25.12`
  (metadata only, not a `NativeRpcProvider` version);
- `eth_chainId=0x66eee` / `421614`;
- block hash and timestamp captured with `eth_getBlockByNumber`;
- non-empty code at the official Arbitrum Sepolia L2 WETH address;
- WETH `decimals()` returned `18` through pinned `eth_call`;
- deterministic probe sender WETH `balanceOf()` returned zero at the same
  block;
- controlled WETH `transfer(..., 1)` through `eth_call` returned JSON-RPC error
  code `3`; the message contains the expected semantic and the ABI
  `Error(string)` payload decodes to the expected controlled reason. No
  separate Provider revert-reason semantic is inferred;
- pinned `eth_estimateGas` for `decimals()` returned `31404` (narrow
  `ethEstimateGas` mechanic only; generic gas evaluation remains
  `SUPPORTED_DOC_ONLY`);
- a Parallax-namespaced nonexistent method returned the JSON-RPC `-32601`
  method-not-found envelope; this is an observed envelope, NOT a final Provider
  `UNSUPPORTED` classification;
- `eth_getBalance` was not executed and remains `UNKNOWN`.

The success, controlled revert, and method-not-found envelopes are real and
sanitized. They do not prove Provider outage, natural network timeout, rate
limit, stale evidence, Camelot V3 evaluation, complete transaction simulation,
hypothetical receipt/logs, state diff, or complete asset/balance changes. Those
remain explicit unavailable/`UNKNOWN` evidence rather than fabricated cases.

## 6. Authentication / rate / timeout inventory

| Provider | Authentication | Rate limits | Timeout semantics |
| --- | --- | --- | --- |
| Moss | local runtime path + environment-supplied RPC; RPC auth is endpoint-specific | `UNKNOWN` as a universal Moss value | classified in code; no universal numeric timeout claimed |
| Tenderly Node | secret network-specific RPC URL/access key | `UNKNOWN` actual account throttling until probe | `UNKNOWN`; client probe must enforce deadline |
| Tenderly Simulation API | `X-Access-Key` + account/project path | `UNKNOWN` actual account throttling until probe | `UNKNOWN`; client probe must enforce deadline |
| Native RPC | official public endpoint required no credential for this capture; other endpoints remain vendor-specific | not intentionally exercised; `UNKNOWN` | no natural timeout observed; client uses an 8-second deadline that is not Provider-timeout evidence |
| Enso | deferred | `UNKNOWN` | `UNKNOWN` |

Secrets must never appear in:

- fixtures;
- PR text;
- issue comments;
- screenshots/log captures;
- normalized Provider output.

## 7. Probe plan

### 7.1 Tenderly — once credentials are available through environment configuration

Hard guards:

```text
chainId == 421614
no signing
no broadcast
no wallet mutation
save = false where API mode allows it
prepared unsigned transaction only
```

Required observations:

1. chain identity / endpoint qualification;
2. one successful pinned-block simulation;
3. one verified revert;
4. actual gas field shape;
5. actual asset/balance-change shape;
6. actual simulation block/provenance fields;
7. controlled unsupported or invalid request;
8. controlled auth/provider failure only if it can be observed without exposing credentials;
9. client-enforced timeout/network failure;
10. rate-limit headers/status only if safely observable.

Sanitize before committing.

### 7.2 Native RPC — completed real public-endpoint checkpoint

Implemented read-only sequence:

```text
web3_clientVersion
eth_chainId
eth_blockNumber
eth_getBlockByNumber(pinnedBlock, false)
eth_getCode(target, pinnedBlock)
eth_call(WETH decimals(), pinnedBlock)
eth_call(WETH balanceOf(probeSender), pinnedBlock)
eth_call(WETH transfer(...), pinnedBlock)  # controlled revert, never broadcast
eth_estimateGas(WETH decimals(), pinnedBlock)
parallax_be011_nonexistentMethod
```

Probe source:

```text
scripts/provider-probes/arbitrum-sepolia-native-rpc.ts
```

All calls were sequential with unique request IDs and request timestamps. The
chain ID was a hard gate before contract calls. No endpoint URL, header,
credential, wallet secret, signing material, or authorization value was
persisted. The probe remains a surface qualification only; it did not receive a
Protocol/Backend prepared transaction.

Capture safety guards:

- HTTPS-only endpoint, sequencer endpoints rejected, fixed read-only method
  allowlist, `eth_send*` prohibited, `chainId == 421614` hard gate,
  same-pinned-block zero-WETH-balance precondition, no signing, no broadcast,
  no faucet, no state mutation, endpoint value scrubbed, sensitive-key
  scrubber, 8-second client deadline (explicitly NOT Provider-timeout
  evidence).
- Unique capture directory per run:
  `arbitrum-sepolia-public-YYYY-MM-DDTHH-MM-SS-mmmZ`. Environment-supplied
  endpoint captures use the endpoint class only, never the endpoint value.
  Writes fail if the capture already exists (exclusive-create), and the final
  capture directory is created only after all required live observations
  passed validation.
- Controlled revert is `VERIFIED_RUNTIME` only when HTTP is OK, the JSON-RPC
  error code is exactly `3`, the message contains the expected semantic, and
  the ABI `Error(string)` payload decodes to the expected controlled reason;
  otherwise the probe fails closed.
- The method-not-found envelope is `VERIFIED_RUNTIME` only when HTTP is OK and
  the JSON-RPC error code is exactly `-32601`; otherwise the probe fails
  closed. The observation stays a JSON-RPC method-not-found envelope and is
  never mapped to a final Provider `UNSUPPORTED` status.
- `eth_getBalance` is not called and is recorded as `UNKNOWN`
  (`NOT_EXECUTED_IN_REAL_CHECKPOINT`).

## 8. Offline fixture plan

BE-011 should reuse existing truthful Moss fixtures rather than duplicating them.

Planned manifest categories:

```text
moss/success-real
moss/unsupported-offline
moss/failure-mock-or-unavailable-note
moss/timeout-unavailable-note
moss/revert-mock-or-unavailable-note
tenderly/success-real        [pending]
tenderly/revert-real         [pending]
tenderly/unsupported-real    [pending]
tenderly/failure-real        [pending]
tenderly/timeout-real        [pending]
native-rpc/success-real                      [available: controlled partial RPC reads]
native-rpc/revert-real                       [available: controlled eth_call revert envelope]
native-rpc/method-not-found-envelope-real    [available: observed JSON-RPC -32601 envelope]
native-rpc/eth-get-balance                   [not executed: UNKNOWN]
native-rpc/failure-real                      [pending]
native-rpc/timeout-real                      [pending]
```

Each provider entry in `manifest.json` carries a machine-readable
`fixtureIndex` so Backend can discover the deterministic evidence set without
hardcoding paths or reading prose. Entries identify an observation case id,
whether it is real, its existing fixture path (or `null` when unavailable),
its evidence classification, chain/protocol where legitimately known, and a
truthful note for mock/unavailable/documentation-only cases. `fixtureIndex`
entries describe evidence cases and observations only; they do not freeze final
Provider status mappings.

Every fixture/entry must carry:

- Provider identity;
- version/client identity if known;
- Intent / chain / protocol;
- retrieval time;
- provenance;
- support-state classification;
- `real` flag;
- reproducibility statement;
- redaction statement;
- expected observation case (evidence case, not a frozen Provider status).

## 9. Open blockers / dependencies

The following are not Provider Owner decisions:

- final `PreparedExecution` type;
- final `camelot-v3` Contract addition;
- final cross-Provider Evidence field names;
- final Risk use of gas / total-cost / state-diff fields;
- final freshness threshold;
- final ProviderRegistry algorithm.

Provider Owner will supply observations and capability facts. Contract Owner owns canonical semantics; Backend Owner owns registry selection and composition.

## 10. Source inventory

Repository evidence:

- `packages/moss-bridge/src/provider.ts`
- `packages/moss-bridge/test/provider.test.ts`
- `docs/integration/moss-kuru-live-runtime.md`
- `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/`
- `fixtures/chain-evidence/kuru/reverted/metadata.json`
- `scripts/provider-probes/arbitrum-sepolia-native-rpc.ts` (guarded probe source)
- `fixtures/provider-registry/be-011/native-rpc/arbitrum-sepolia-public-2026-09-10T12-19-45-890Z/`
  (canonical guarded capture)
- `fixtures/provider-registry/be-011/native-rpc/arbitrum-sepolia-public-2026-09-08/`
  (`HISTORICAL_PRE_GUARD_CAPTURE`, superseded for canonical qualification)
- PR #42 `docs/research/arbitrum-evidence-provider-feasibility.md`
- `docs/planning/arbitrum-open-house/02-B-provider-implementation.md`

Current public references retained from the feasibility work:

- Tenderly Arbitrum support: `https://tenderly.co/blog/changelog/tenderly-node-arbitrum-support/`
- Tenderly Node / simulation documentation: `https://docs.tenderly.co/node-rpc/overview`
- Tenderly Simulation API: `https://docs.tenderly.co/api-reference/simulator/simulate-transaction`
- Ethereum JSON-RPC: `https://ethereum.org/developers/docs/apis/json-rpc/`

## 11. Completion gate for BE-011 Provider Owner input

Provider Owner input is ready for Backend Registry implementation only when:

- the matrix covers every current Provider candidate;
- every capability is explicitly classified;
- real vs mock vs documentation-only evidence is unmistakable;
- success / unsupported / failure / timeout has either representative evidence or an explicit unavailable-evidence note;
- deterministic fixtures do not require external services or secrets;
- no Provider-specific raw type leaks into Core;
- no final Contract semantics are frozen by this package.
