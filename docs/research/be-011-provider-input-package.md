# BE-011 Provider Owner Input Package

> **Status:** Draft checkpoint v0  
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

The intended minimum probe surface is:

```text
eth_chainId
eth_blockNumber
eth_call
eth_estimateGas
eth_getBalance
eth_getCode
```

plus protocol-aware ERC-20 `balanceOf` / `allowance` calls only where the caller supplies trusted addresses / ABI semantics.

Standard RPC does not itself produce a hypothetical receipt, generic hypothetical logs, state diff, or complete asset-change set.

### 3.4 EnsoProvider — deferred

Enso remains optional Strong/Best-stage work. It is not a P0 prerequisite and must not be silently inserted into current ProviderRegistry selection logic before a separate scope/qualification decision.

## 4. Capability matrix

| Capability | `moss-kuru` | Tenderly / Arbitrum Sepolia | Native RPC / Arbitrum Sepolia | Enso |
| --- | --- | --- | --- | --- |
| Provider identity/version | `VERIFIED_RUNTIME` for observed Moss fixture | `UNKNOWN` runtime version | `UNKNOWN` until vendor/client selected | `UNKNOWN` |
| Swap/check Intent | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` via future PreparedExecution | `SUPPORTED_DOC_ONLY` via future PreparedExecution | `UNKNOWN` |
| Chain | `143` `VERIFIED_RUNTIME` | `421614` `SUPPORTED_DOC_ONLY` | `421614` `SUPPORTED_DOC_ONLY` | `UNKNOWN` |
| Protocol | `kuru` `VERIFIED_RUNTIME` | `camelot-v3` `SUPPORTED_DOC_ONLY` project target | `camelot-v3` `SUPPORTED_DOC_ONLY` project target | `UNKNOWN` |
| Quote | `VERIFIED_RUNTIME` compatibility path | `UNSUPPORTED` by Provider ownership | `UNSUPPORTED` by Provider ownership | `UNKNOWN` |
| Unsigned tx construction | `VERIFIED_RUNTIME` compatibility ACTION stage | `UNSUPPORTED` by Provider ownership | `UNSUPPORTED` by Provider ownership | `UNKNOWN` |
| Simulation/evaluation | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY`, partial | `UNKNOWN` |
| Execution result | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY`, `eth_call` only | `UNKNOWN` |
| Asset changes | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `UNSUPPORTED` on standard hypothetical RPC | `UNKNOWN` |
| Balance changes | `UNKNOWN` as a distinct capability | `SUPPORTED_DOC_ONLY` | `UNSUPPORTED` as generic hypothetical post-state change; balance reads are separate | `UNKNOWN` |
| Gas | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` estimate only | `UNKNOWN` |
| Revert reason | `UNKNOWN` for **real** BE-011 response coverage | `SUPPORTED_DOC_ONLY` | `UNKNOWN` provider/client shape | `UNKNOWN` |
| Block context | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` | `UNKNOWN` |
| Provenance | `VERIFIED_RUNTIME` | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` | `UNKNOWN` |
| Freshness evidence | `VERIFIED_RUNTIME` block/time provenance; no universal stale threshold | block provenance `SUPPORTED_DOC_ONLY`, policy `UNKNOWN` | head/block lag `SUPPORTED_DOC_ONLY`, policy threshold external | `UNKNOWN` |

### Registry-facing consequences

The matrix currently supports these safe design conclusions:

1. `moss-kuru` may be selected only for the Monad/Kuru compatibility path it actually supports.
2. Tenderly is **not yet** a runtime-selectable verified Provider for Arbitrum Sepolia.
3. Native RPC is **not yet** a runtime-selectable verified Provider and, even after qualification, must advertise a narrower capability set than Tenderly.
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
NO QUALIFYING ARBITRUM SEPOLIA RPC RESPONSE CAPTURED
```

A future probe must identify the actual RPC vendor/client endpoint class before any vendor-specific failure, rate-limit, or timeout semantics are claimed.

## 6. Authentication / rate / timeout inventory

| Provider | Authentication | Rate limits | Timeout semantics |
| --- | --- | --- | --- |
| Moss | local runtime path + environment-supplied RPC; RPC auth is endpoint-specific | `UNKNOWN` as a universal Moss value | classified in code; no universal numeric timeout claimed |
| Tenderly Node | secret network-specific RPC URL/access key | `UNKNOWN` actual account throttling until probe | `UNKNOWN`; client probe must enforce deadline |
| Tenderly Simulation API | `X-Access-Key` + account/project path | `UNKNOWN` actual account throttling until probe | `UNKNOWN`; client probe must enforce deadline |
| Native RPC | vendor-specific endpoint credential, if any | vendor-specific `UNKNOWN` | vendor/client-specific `UNKNOWN` |
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

### 7.2 Native RPC — once an Arbitrum Sepolia RPC endpoint is configured

Minimum read-only sequence:

```text
eth_chainId
eth_blockNumber
eth_getCode(target, pinnedBlock)
eth_call(preparedTx, pinnedBlock)
eth_estimateGas(preparedTx, pinnedBlock where supported)
```

Optional same-block reads:

```text
eth_getBalance
ERC-20 balanceOf via eth_call
ERC-20 allowance via eth_call
```

Record provider/client-specific error envelopes exactly before normalization.

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
native-rpc/success-real      [pending]
native-rpc/revert-real       [pending]
native-rpc/unsupported       [pending]
native-rpc/failure-real      [pending]
native-rpc/timeout-real      [pending]
```

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
- expected control state.

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

