# Arbitrum Evidence Provider Feasibility

Date: 2026-09-01

Scope: Provider Owner feasibility only. No Chain Adapter, Protocol Adapter,
registry, backend composition, signing, transaction broadcast, or chain write
was performed.

## Executive result

Tenderly is a viable document-supported P0 simulation provider for Arbitrum
Sepolia. Its current Node RPC documentation describes an unsigned transaction
simulation surface with an explicit block context and decoded execution, gas,
logs, trace, asset changes, and balance changes. The current Simulation API
reference additionally documents failed execution fields and state diffs.
Tenderly's current Arbitrum announcement explicitly includes Arbitrum Sepolia
for both platform tools and Tenderly Node.

This checkout cannot promote any Tenderly capability to
`SUPPORTED_VERIFIED`: no Tenderly credentials are configured. It also cannot
verify the native Arbitrum Sepolia RPC surface because no repository-equivalent
RPC setting or `ARBITRUM_SEPOLIA_RPC_URL` is configured. No request was sent,
and no fixture was fabricated.

The current provider contract is not sufficient for the future Camelot V3
path. `protocolSchema` does not represent Camelot V3, and
`EvidenceEvaluationInput` has no prepared unsigned transaction or protocol
quote. A simulation-only provider cannot reconstruct Camelot calldata without
crossing into Protocol Adapter ownership. These are Contract Owner proposals,
not changes made by this spike.

## Evidence and epistemic boundary

Repository facts and current environment were inspected directly. Product
capabilities below are `SUPPORTED_DOC_ONLY` unless a real configured provider
call was made. There were no real calls in this spike.

Primary sources, accessed 2026-09-01:

- [Tenderly Arbitrum support announcement](https://tenderly.co/blog/changelog/tenderly-node-arbitrum-support/)
  explicitly names Arbitrum One, Nova, and Arbitrum Sepolia and says Simulator
  and Tenderly Node are available on all three.
- [Tenderly Node RPC overview](https://docs.tenderly.co/node-rpc/overview)
  describes standard EVM RPC plus custom `tenderly_` methods and says Node RPC
  is a paid-plan capability.
- [Tenderly simulate transaction JSON-RPC guide](https://docs.tenderly.co/node-rpc/guides/simulate-json-rpc)
  defines the request, block/state overrides, response, and gas semantics.
- [Tenderly Simulation API reference](https://docs.tenderly.co/api-reference/simulator/simulate-transaction)
  defines the project-scoped endpoint, `X-Access-Key`, full/quick/ABI modes,
  failed simulation shape, block number, state diff, asset changes, and balance
  changes.
- [Tenderly Node RPC pricing](https://docs.tenderly.co/node-rpc/pricing) defines
  current per-method Tenderly Unit categories. Account capacity and actual
  throttling are not published as a universal numeric limit.
- [Ethereum JSON-RPC API](https://ethereum.org/developers/docs/apis/json-rpc/)
  defines the standard read/state/call/log methods and their block parameter.
- [Offchain Labs Arbitrum monitoring configuration](https://github.com/OffchainLabs/arbitrum-monitoring/blob/main/config.example.json)
  identifies Arbitrum Sepolia as chain ID `421614`.

The former `Tenderly/tenderly-docs` repository is archived. It was consulted
only as corroborating historical material; the conclusions above use current
Tenderly documentation and the current Tenderly changelog.

## Current Parallax contract summary

The authoritative local contract is in
`packages/contracts/src/evidence-provider.ts` and
`packages/contracts/src/generic-evidence.ts`.

### EvidenceProvider

- `providerId: string` identifies the provider.
- `supports(intent)` must be cheap and side-effect-free.
- `evaluate(input)` returns `Promise<GenericEvidence>` or throws
  `EvidenceProviderError` when it cannot produce evidence.
- `EvidenceEvaluationInput` contains exactly `runId`, `intent`,
  `tokenInDecimals`, and `tokenOutDecimals`.
- `intent` contains `chainId`, `protocol`, `sender`, `tokenIn`, `tokenOut`,
  `amountIn`, optional `minimumReceived`, and its boundary source.
- `protocolSchema` currently accepts only `kuru` and `pancake`.

### GenericEvidence

- Required top-level fields are `intent`, `provider`, `execution`, `quote`,
  `action`, `receipt`, `outcome`, `assetChanges`,
  `assetChangeAssessment`, `warnings`, `simulation`, `blockNumber`,
  `capabilities`, `provenance`, `checkedScope`, `unknownScope`, and
  `providerData`.
- Provider evaluation status is one of `SUCCESS`, `UNKNOWN`, `UNSUPPORTED`,
  `FAILED`, or `STALE`.
- Integration status is independently one of `OK`, `INTEGRATION_ERROR`,
  `UNAVAILABLE`, or `TIMEOUT`.
- Execution status is independently one of `SUCCESS`, `NO_ROUTE`, `REVERTED`,
  or `UNKNOWN`. Risk verdict is a third, downstream axis and is not stored in
  the evidence.
- `capabilities` is a free `string[]`; no contract expansion is needed for
  tokens such as `simulate`, `trace`, `asset_changes`, or `state_diff`.
- Generic provenance contains optional `observedChainId`, optional
  `fetchedAt`, truthfulness `mode`, `source`, optional `simulationBlock`, and
  optional provider runtime identity.
- Freshness is represented by field/global `fetchedAt`, field/global block
  provenance, and provider status `STALE`; the contract does not define a
  universal age threshold.
- A classified provider failure is `provider.status=FAILED` with
  `provider.failure`; `provider.errors` carries normalized errors. A verified
  execution revert remains `provider.status=SUCCESS` and
  `execution.status=REVERTED`.
- Provider-only data is isolated under `providerData`. Current Risk does not
  inspect it, and it must not become a decision dependency.
- Evidence field source already allows `external` and `rpc`. Normalized error
  source is narrower (`moss`, `rpc`, `quote`, `unknown`), so Tenderly Node
  failures can use `rpc`; Simulation API failures can conservatively use
  `unknown` while provider identity remains `tenderly`.

Current Risk completeness requires trusted quote, action, simulation, block,
warnings, and a healthy integration. A successful execution additionally
requires trusted receipt, outcome, and explained or not-applicable asset
changes. Therefore a Native RPC result that only has `eth_call` and
`eth_estimateGas` is intentionally partial and cannot be promoted to complete
P0 evidence.

## Tenderly feasibility

### Network and product surfaces

| Item | Classification | Finding |
| --- | --- | --- |
| Arbitrum Sepolia platform support | `SUPPORTED_DOC_ONLY` | Tenderly explicitly lists Simulator and Node support. |
| Network identifier | `SUPPORTED_DOC_ONLY` | Arbitrum Sepolia chain ID / Simulation API `network_id` is `421614`. |
| Simulation API | `SUPPORTED_DOC_ONLY` | Project-scoped HTTPS `POST /api/v1/account/{account}/project/{project}/simulate`. |
| Node simulation RPC | `SUPPORTED_DOC_ONLY` | Network-specific Node URL with `tenderly_simulateTransaction`. |
| Actual availability in this checkout | `BLOCKED` | No account/project/access key or Tenderly Node URL/key is configured. |

### Authentication and minimum request

Simulation API authentication uses an `X-Access-Key` header plus account and
project slugs in the path. Node RPC uses a unique network-specific node URL;
the access key is part of that secret URL. Neither secret form may be logged or
stored in fixtures.

The Simulation API request documented minimum for a useful full transaction
probe is:

```text
network_id = "421614"
from       = sender address
to         = target contract
input      = calldata
value      = wei value (zero is valid)
simulation_type = "full"
save = false
save_if_fails = false
```

`gas`, `gas_price`, `block_number`, transaction index, access list, state
overrides, and block-header overrides are conditional controls rather than
universal semantic requirements.

The Node RPC method accepts one transaction object (`to` required; `from`,
`gas`, fee fields, `value`, `data`, and access list optional), followed by an
optional block number/tag, state overrides, and block overrides. It executes
without broadcasting. For Parallax, `from`, `to`, `data`, and `value` must be
explicit even where Tenderly marks some fields optional; omitting them would
make the evidence ambiguous or simulate a different transaction.

### Response capabilities

| Capability | Classification | Documented evidence / limitation |
| --- | --- | --- |
| Transaction success/failure | `SUPPORTED_DOC_ONLY` | `status` is success or failure on both surfaces. |
| Revert | `SUPPORTED_DOC_ONLY` | Failed Simulation API examples return `status=false`; Node RPC trace defines `error`. |
| Revert reason | `SUPPORTED_DOC_ONLY` | Node trace defines `errorReason`; Simulation API defines `error_message`, `error_info`, and stack trace. |
| Gas used | `SUPPORTED_DOC_ONLY` | `gasUsed` / `gas_used` is returned. |
| Gas estimate | `SUPPORTED_DOC_ONLY` | `tenderly_estimateGas` returns recommended gas and actual gas used; API has estimate mode. |
| Asset changes | `SUPPORTED_DOC_ONLY` | Transfer/mint/burn with asset metadata and raw amount. |
| Balance changes | `SUPPORTED_DOC_ONLY` | Cumulated asset-change references by address; its USD values are enrichment, not execution truth. |
| Logs | `SUPPORTED_DOC_ONLY` | Raw and decoded logs are documented. |
| Internal calls / decoded calls | `SUPPORTED_DOC_ONLY` | Decoded trace/call trace is documented. |
| State diff | `SUPPORTED_DOC_ONLY` | Full Simulation API documents decoded and raw state diff. Current Node RPC simulation guide does not promise a state-diff field. |
| Block provenance | `SUPPORTED_DOC_ONLY` | Request can pin block; response includes simulated block number. |
| Simulation timestamp | `SUPPORTED_DOC_ONLY` | Simulation API documents transaction timestamp and `created_at`; Node RPC result does not document a timestamp. |
| Freshness policy | `UNVERIFIED` | Tenderly returns block provenance, but Parallax must define acceptable head lag/age and compare it to an independently observed head. |
| Actual Arbitrum Sepolia shape | `BLOCKED` | Credentials are missing; no real response was captured. |

Tenderly asset metadata such as names, symbols, logos, and current USD values
is not canonical swap outcome evidence. Parallax should use address, standard,
decimals (validated against its token registry), direction, and raw amount; USD
enrichment remains provider-specific.

### Failure and rate-limit semantics

- Successful provider request that proves a revert: provider `SUCCESS`,
  integration `OK`, execution `REVERTED`.
- HTTP/auth/transport failure: provider `FAILED`; integration status is
  `INTEGRATION_ERROR`, `UNAVAILABLE`, or `TIMEOUT` as observed.
- Response lacks a requested, contract-required capability: provider
  `UNKNOWN`, not execution `REVERTED`.
- Unsupported chain/transaction: provider `UNSUPPORTED`.
- Evidence beyond the future Parallax freshness threshold: provider `STALE`.

Current Node RPC pricing is plan gated and usage based: read, compute,
debug/trace, and advanced simulation methods have different TU costs, with
`tenderly_simulateTransaction` in the highest documented category. The
documentation sends account-specific capacity questions to sales. Actual
HTTP status, rate-limit headers, retry-after semantics, and burst/sustained
limits remain `UNVERIFIED` until a configured account is probed safely.

## Native RPC feasibility

No configured Arbitrum Sepolia RPC was found, so every method is unverified in
this environment. Standard EVM JSON-RPC documentation supports the following
implementation plan, but node/provider availability must be probed per method.

| Method | Relevance | Classification | What it can prove |
| --- | --- | --- | --- |
| `eth_chainId` | Required guard | `SUPPORTED_DOC_ONLY` | Endpoint is the intended chain; expect hex chain ID `421614`. |
| `eth_blockNumber` | Required provenance | `SUPPORTED_DOC_ONLY` | Observation head used for lag/freshness calculation. |
| `eth_call` | Required simulation fallback | `SUPPORTED_DOC_ONLY` | Return data or RPC revert at a specified block for one unsigned call. |
| `eth_estimateGas` | Required gas fallback | `SUPPORTED_DOC_ONLY` | Node-estimated gas or failure; not the same as an execution receipt. |
| `eth_getBalance` | Conditional | `SUPPORTED_DOC_ONLY` | Native balance snapshot at a block. |
| `eth_getCode` | Conditional guard | `SUPPORTED_DOC_ONLY` | Target/token has bytecode at a block. |
| `eth_getTransactionCount` | Not needed for unsigned evidence | `NOT_APPLICABLE` | Nonce is a broadcast concern unless protocol semantics explicitly depend on it. |
| `eth_getStorageAt` | Conditional / discouraged | `SUPPORTED_DOC_ONLY` | Raw known storage slot only; token layouts are not generic. |
| `eth_getLogs` | Historical only | `SUPPORTED_DOC_ONLY` | Logs already committed in a block; not logs from hypothetical `eth_call`. |

ERC-20 balance and allowance are ABI calls (`balanceOf` and `allowance`) made
through `eth_call`; they are not dedicated JSON-RPC methods. The eventual
Protocol Adapter or token metadata boundary must supply token addresses,
spender, owner, and trusted ABI semantics. For reproducible evidence, native
balance, token balance, allowance, code, call, and gas queries must all use the
same explicit block tag where the endpoint permits it.

## Capability matrix

| Evidence | Tenderly | Native RPC | Boundary |
| --- | --- | --- | --- |
| Execution success | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` | Tenderly status is explicit; `eth_call` success only proves the call returned at the selected state. |
| Revert | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` | Both can expose a revert; neither was real-probed here. |
| Revert reason | `SUPPORTED_DOC_ONLY` | `UNVERIFIED` | Native reason format is client/provider dependent and may be only raw revert data. |
| Gas estimate | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` | Tenderly distinguishes exact executed gas and recommended limit; native is an estimate. |
| Asset changes | `SUPPORTED_DOC_ONLY` | `UNVERIFIED` | Standard RPC has no hypothetical asset-change set; must derive from protocol-aware calls/logs or tracing extensions. |
| Balance changes | `SUPPORTED_DOC_ONLY` | `UNVERIFIED` | Native can read before-state but standard `eth_call` has no post-state snapshot. |
| Internal calls | `SUPPORTED_DOC_ONLY` | `UNVERIFIED` | Requires non-standard trace RPC natively. |
| State diff | `SUPPORTED_DOC_ONLY` | `UNVERIFIED` | Tenderly full API documents it; standard RPC does not. |
| Block provenance | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` | Pin a block and record it; validate the returned chain separately. |
| Freshness | `UNVERIFIED` | `SUPPORTED_DOC_ONLY` | Native head plus pinned block enables lag calculation; policy threshold is still a Parallax decision. |
| Allowance / balance | `SUPPORTED_DOC_ONLY` | `SUPPORTED_DOC_ONLY` | Tenderly state diff may show touched allowance; native reads require explicit ABI calls and addresses. |

Native RPC is a controlled partial-evidence fallback, not a semantic substitute
for full Tenderly simulation. Standard `eth_call` does not create a receipt,
does not persist or return transaction logs, does not expose a generic state
diff, and cannot by itself produce a trustworthy complete asset-change set.

## Provider-specific to Generic Evidence mapping

### Tenderly

| Tenderly field | Classification | Generic target |
| --- | --- | --- |
| Request `network_id` / observed Node chain | A | `intent.chainId`, `provenance.observedChainId` after equality check. |
| Request block / response block | A | `blockNumber`, field block numbers, `provenance.simulationBlock`. |
| Acquisition time | A | `provenance.fetchedAt` and field `fetchedAt`; provider `created_at` stays provider metadata. |
| `status` | A | `execution.status=SUCCESS` or `REVERTED`; completed request keeps provider `SUCCESS`. |
| Provider transport/auth result | A | Provider and integration statuses; normalized failure/errors. |
| `assetChanges` raw address/amount/direction | A | `assetChanges`; derive `assetChangeAssessment` only with deterministic reconciliation. |
| Response transaction/call result | A | `receipt` and `outcome`, explicitly labelled simulated rather than on-chain receipt. |
| Request transaction(s) | A | `action`; must originate from Protocol Adapter, not be invented by provider. |
| Protocol quote supplied with action | A | `quote`; Tenderly does not create a Camelot route quote. |
| Simulation count/completion | A | `simulation` coverage fields. |
| Trace, decoded logs, state diff, Tenderly IDs, timing, USD enrichment | B | `providerData.tenderly`; Core/Risk must not inspect it. |
| Gas used / recommended gas | B | `providerData.tenderly.gas`; no current generic consumer requires a typed field. |
| Revert reason | B | Simulated receipt/outcome plus `providerData.tenderly`; generic execution status is sufficient for current Risk. |
| Tenderly secret URL, access key, account/project identifiers | D | Never map, log, or fixture. |

Use evidence source `external` for Simulation API-derived fields and `rpc` for
Tenderly Node-derived fields. Preserve `mode=LIVE` only for live responses;
future sanitized recorded fixtures must use `RECORDED_REPLAY` when replayed.

### Native RPC

| RPC result | Classification | Generic target |
| --- | --- | --- |
| `eth_chainId` | A | `provenance.observedChainId`; mismatch is provider failure. |
| Pinned block and observed head | A | `blockNumber`, field block numbers, `simulationBlock`, `fetchedAt`; lag calculation can classify `STALE`. |
| `eth_call` success/revert | A | `execution.status`; raw return/revert data in simulated `receipt`/`outcome`. |
| `eth_estimateGas` | B | `providerData.nativeRpc.gasEstimate`; no typed generic consumer exists. |
| Native/ERC-20 balance and allowance reads | B | `providerData.nativeRpc.stateReads` unless reconciled into generic asset changes by a generic algorithm. |
| Protocol-provided transaction | A | `action`. |
| Protocol-provided quote | A | `quote`; RPC does not create route economics. |
| Missing receipt/log/trace/state-diff/asset changes | A | Null evidence fields, incomplete simulation, provider `UNKNOWN`, and explicit `unknownScope`. |
| Endpoint URL | D | Never map, log, or fixture. |

## Contract delta proposals

No Generic Evidence output field was changed. Provider output already has
adequate direct fields and an isolated metadata boundary. Two changes are
required before a complete Camelot/Tenderly implementation can satisfy the
current provider interface.

### CONTRACT_DELTA_PROPOSAL 1 — Camelot protocol identity

- Provider: TenderlyProvider and NativeRpcProvider on the Camelot V3 path.
- Real response evidence: `BLOCKED`; this requirement comes from the accepted
  target architecture and the current local schema, not a claimed provider
  response.
- Field: `GenericSwapIntent.protocol` / `protocolSchema`.
- Meaning: identifies the protocol whose quote/action was evaluated.
- Why insufficient: current enum contains only `kuru` and `pancake`; it cannot
  encode Camelot V3.
- Actual consumer: Protocol Adapter dispatch, provider `supports`, evidence
  intent, Risk/Orchestrator audit output.
- Backward compatibility: additive enum member; existing payloads remain valid,
  exhaustive switches must be updated by their owners.
- Recommended change: Contract Owner chooses one canonical additive identifier,
  such as `camelot-v3`, and publishes its spelling/version semantics.
- Alternative: none that preserves truthful protocol identity; mislabelling it
  as `pancake` is prohibited.

### CONTRACT_DELTA_PROPOSAL 2 — prepared protocol evidence input

- Provider: TenderlyProvider and NativeRpcProvider.
- Real response evidence: Tenderly's documented request requires an unsigned
  transaction (`from`, `to`, calldata, value, chain/block context). Real local
  validation is `BLOCKED` by credentials/RPC and Protocol Adapter output.
- Field: `EvidenceEvaluationInput`.
- Meaning: the protocol-selected quote plus ordered unsigned transaction plan
  to simulate.
- Why insufficient: current input contains only swap intent and decimals. A
  provider cannot reconstruct Camelot routing/calldata without becoming the
  Protocol Adapter, and Tenderly does not create the route quote consumed by
  current Risk.
- Actual consumer: TenderlyProvider/NativeRpcProvider map `action`, `quote`, and
  simulation results into `GenericEvidence`; current Risk consumes trusted
  quote/action/simulation evidence.
- Backward compatibility: add an optional structured member for existing Moss
  callers, then require it in `supports/evaluate` for simulation-only
  providers. Exact schema needs Contract Owner review.
- Recommended change: add a provider-agnostic prepared evidence member carrying
  protocol quote and ordered unsigned EVM transactions. Each transaction needs
  `from`, `to`, `data`, `value`, and optional gas/fee/access-list fields; the
  envelope needs chain ID and optional requested block context.
- Alternative without contract change: inject a Protocol Adapter callback into
  each provider during Backend composition. This avoids input expansion but
  couples Provider and Backend ownership and still leaves quote/action
  provenance coordination implicit.

Do not add typed trace, state-diff, gas, USD, or Tenderly-ID fields now. There
is no current Core/Risk consumer, so `providerData` is the correct boundary.

## Protocol transaction requirements and blocking state

Backend Owner's eventual Camelot V3 Protocol Adapter must supply, without
signing:

```text
chainId = 421614
protocol = Contract Owner canonical Camelot V3 identifier
quote = estimated amount out plus minimum amount out and provenance
transactions[] = ordered unsigned calls
  from
  to
  data
  value
  optional gas / fee / access list
requested block context (optional, if policy chooses a pinned block)
token and spender identities needed for balance/allowance checks
```

The provider must reject chain mismatch, preserve ordering, pin all related
reads to one block, and never sign or broadcast. A real Camelot-specific
simulation is `BLOCKED_BY_PROTOCOL_TRANSACTION`. Once credentials exist, an
independent harmless provider capability probe can verify Tenderly mechanics,
but it cannot be presented as Camelot path validation.

## Fixtures and next implementation scope

Fixture counts for this spike:

- `REAL_SANITIZED`: 0 — real calls were blocked.
- `RECORDED_RESPONSE`: 0 — official examples were not relabelled as local
  captures.
- `SYNTHETIC`: 0 — no parser/code was introduced, so synthetic fixtures would
  add no verified capability.

Next Provider implementation should remain narrowly scoped:

1. Contract Owner resolves the two proposals.
2. Configure secrets out-of-repo and add an Arbitrum Sepolia RPC variable name
   to the approved configuration surface without committing values.
3. Build a read-only probe with an explicit allowlist; reject every signing or
   `eth_send*` method.
4. Capture sanitized Tenderly success and verified-revert responses plus native
   method availability, response error shape, latency, block provenance, and
   rate-limit headers/429 behavior.
5. Add parser/mapping tests for success, revert, provider failure, missing
   capability, unknown evidence, provenance, sanitization, and `providerData`
   isolation.
6. Implement TenderlyProvider only after the prepared transaction boundary is
   available. Implement NativeRpcProvider as explicitly partial/fail-closed,
   not as equivalent complete evidence.

P0 recommendation: proceed with Tenderly as the primary Arbitrum Sepolia
provider, conditional on real credentialed success/revert probes and Contract
Owner resolution. Retain Native RPC for independent chain/block/state/call/gas
checks and controlled partial fallback.
