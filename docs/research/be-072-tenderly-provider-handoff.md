# BE-072 Tenderly Arbitrum Provider handoff

Captured 2026-09-17 against `origin/main` `b09bc771a2517aa0d67006c9b0914b36fc7ca21f`. Issue: [#72](https://github.com/parallax-monad/parallax/issues/72). This is a Provider-owned adapter and provisional mapping proposal. Backend owns composition and controlled selection; Contract owns generic Evidence semantics. Native RPC first P0 is independent.

## Qualification boundary

`CREDENTIALED_PROBE=BLOCKED_NO_LOCAL_CREDENTIAL`, `CREDENTIALS_PRESENT=NO`, `REAL_TENDERLY_REQUEST_SENT=NO`, `REAL_TENDERLY_FIXTURES=NONE`. A presence-only check found no `TENDERLY_ACCESS_KEY`, `TENDERLY_ACCOUNT_SLUG`, or `TENDERLY_PROJECT_SLUG` in the local process environment. Legacy names `TENDERLY_API_KEY`, `TENDERLY_ACCOUNT`, and `TENDERLY_PROJECT` were also absent. No value was printed, credential store opened, or Tenderly request sent. The Backend integration now exposes these names in `.env.example` and consumes them only through validated runtime configuration; no credential is committed or implicitly read by the adapter. The absence of local credentials still blocks runtime qualification.

The canonical #63 Camelot V3 exact unsigned swap is unavailable in this main snapshot. `git ls-remote origin` and the open/merged pull-request list were checked at capture time: no #63 real-evidence branch or pull request is published, so no cross-worktree copy was made and no #63 path is referenced here as a dependency. `fixtures/provider-registry/be-041/camelot-v3/target-scenarios.json` explicitly has an unconfigured pair, pool, quote, and transaction. No noncanonical Tenderly probe was run. There are no real Tenderly success, revert, auth, unsupported, rate, timeout, or incomplete fixtures. See [unavailable fixture note](../../fixtures/provider-registry/be-072/tenderly/README.md). Deterministic HTTP tests are synthetic and prove only adapter behavior; deterministic fixtures and tests are not real runtime qualification. The BE-011 Tenderly manifest remains documentation only for runtime capability. Every documentation-supported field below stays documentation-only until a real credentialed probe observes it.

## Current official API surface

Reviewed 2026-09-17:

* [Tenderly Simulate transaction API](https://docs.tenderly.co/api-reference/simulator/simulate-transaction): `POST https://api.tenderly.co/api/v1/account/{accountSlug}/project/{projectSlug}/simulate`, `X-Access-Key`, JSON. Full simulation uses `network_id`, `from`, `to`, `input`, `value`, optional `gas`, `block_number`, `simulation_type: full`, and `save`/`save_if_fails`. The adapter pins the prepared decimal block and sets both save flags false. There is no implicit latest-block substitution.
* [Tenderly Arbitrum Node support](https://tenderly.co/blog/changelog/tenderly-node-arbitrum-support/): Arbitrum Sepolia is supported; the chain ID `421614` is also the repository's `ARBITRUM_SEPOLIA_CHAIN_ID`. Simulation API support on that network is **documentation only here** until a credentialed response verifies it.
* [Tenderly balance changes changelog](https://tenderly.co/blog/changelog/balance-changes-added-to-simulation-api-and-node-rpc-endpoints/): documents `transaction.transaction_info.balance_changes`; the API example also lists `asset_changes`, logs, state diff, gas and status. Shape and semantics on Arbitrum Sepolia are unverified.

The API reference documents HTTP 200, 400, 401, 403, 404, 429, 500 with example error slugs. Actual account quotas, retry headers, service timeouts, and response completeness remain unknown. `block_number` selects state; the example response includes `transaction.block_number`, `simulation.block_number`, and a potentially empty `transaction.block_hash`. The adapter requires a prepared hash and an equal nonempty response hash for `success`. This deliberately leaves a hashless real response `unknown`; runtime qualification must determine whether another trustworthy hash field exists. `observedAt` is local capture time, not chain finality or a freshness decision.

## Adapter contract

`createTenderlyProvider` returns the existing `ProviderAdapter` for `providerId=tenderly-arbitrum`. It accepts `BackendPipelinePreparedExecution` unchanged. Before HTTP, it checks the run ID, Intent chain/protocol/sender, outer chain/protocol/Intent identity, prepared chain/protocol, quote presence, unsigned kind, exact transaction fields, and positive pinned block number with block hash. Allowed payload fields are `from`, `to`, `data`, `value`, optional `gas`, and optional `chainId`. `chainId` is binding metadata: when present it must resolve to Arbitrum Sepolia and is not forwarded to Tenderly; other fields are rejected because silently dropping nonce/fees/access lists would change transaction semantics. Hex or decimal quantity conversion preserves the numeric value; calldata and addresses are forwarded as supplied. No quote, route, calldata, sender, recipient, value, block, signature, or user transaction is produced by this adapter. It sends one simulation request, never a broadcast or share request.

The response must bind both `transaction` and `simulation` to the request's from/to/input/value/network/block, plus the prepared hash. When the prepared unsigned transaction contains `gas`, the adapter forwards that exact value and requires both `transaction.gas` and `simulation.gas` to be present, safely parseable, and exactly equal before either status can be bound. This dual gas echo is the current conservative adapter contract pending a real credentialed probe; `gas_used` remains an observed execution result, not the prepared gas-limit binding. When prepared gas is absent, no gas is invented and response gas is not required. Only matching boolean statuses can yield `success` or controlled `failed`. `success` additionally requires safe integer gas used and asset/balance arrays. Partial or divergent response becomes `unknown`; malformed JSON throws `UNKNOWN`. Response binding compares exact strings and quantities, so any encoding difference (address checksum case, a numeric `network_id`, a differently encoded `value`, a missing hash, or an unsafe/mismatched gas echo) is treated as `unknown`, never `success`. The runtime response shape is not credential-qualified: a real Tenderly request and fixture are still absent, and no capability may be promoted to `VERIFIED_RUNTIME`. Raw Tenderly types and the response body remain private. The provisional result includes an allowlisted snapshot and candidate fields marked `pending_review`. The Backend integration adds a conservative provider-neutral Evidence mapper: it preserves live provenance, quote/action binding, and execution status, while keeping receipt, outcome, asset changes, and complete simulation unknown until those fields receive reviewed semantic mapping. With complete validated Tenderly configuration, the Arbitrum composition registers exactly one Tenderly provider and routes Arbitrum requests to it; without that configuration, the existing Native RPC provider remains the default.

### Capability matrix

| Capability | State | Basis / limit |
| --- | --- | --- |
| Simulation/evaluation | SUPPORTED_DOC_ONLY | Official endpoint; deterministic adapter tests only |
| Execution result | SUPPORTED_DOC_ONLY | `transaction.status` and `simulation.status` documented; no real response |
| Gas estimate / gas used | SUPPORTED_DOC_ONLY | `gas` request and `gas_used` response documented; gas estimate is Backend input, not newly inferred |
| Revert | SUPPORTED_DOC_ONLY | False status documented; no real Arbitrum Sepolia revert captured |
| Revert reason | UNKNOWN | `error_message` documented but encoding/semantics unqualified and intentionally not exposed |
| Asset changes | SUPPORTED_DOC_ONLY | Response path documented; array presence only in adapter, no semantic decoding |
| Balance changes | SUPPORTED_DOC_ONLY | Response path documented; array presence only in adapter, no semantic decoding |
| State diff | SUPPORTED_DOC_ONLY | Documented path; not exposed by adapter |
| Logs | SUPPORTED_DOC_ONLY | Documented path; not exposed by adapter |
| Block context | SUPPORTED_DOC_ONLY | Pinned request and response block fields; hash availability unqualified |
| Provider identity/runtime | UNKNOWN | Static provider ID is code-derived; no credentialed runtime identity |
| fetchedAt | UNKNOWN | Local `observedAt` implemented; real capture absent |
| Freshness inputs | UNKNOWN | No head-lag observation or approved policy |
| Final generic Evidence mapping | SUPPORTED_DOC_ONLY | Deterministic Backend mapper exists; semantic qualification and real response fixtures remain open |
| Signing / broadcast / share | UNSUPPORTED | Only the `simulate` endpoint is called; no signer or broadcast request exists |
| Chains or protocols other than Arbitrum Sepolia × Camelot V3 | UNSUPPORTED | `supports` is false; no fallback chain and no automatic selection |
| Automatic Provider routing / voting | SUPPORTED_DOC_ONLY | Configuration-gated exact Tenderly selection exists; no voting or fallback is introduced |

No row is `VERIFIED_RUNTIME`, because no credentialed response was captured. `UNSUPPORTED` rows are code- and scope-derived capability refusals, not documentation claims. `SUPPORTED_DOC_ONLY` rows are not promoted to runtime merely because official documentation describes them.

### Field mapping proposal

All paths below are from the official example, not a real fixture. `D` means directly documented, `I` means adapter inference. Candidate paths are provisional and require Contract Owner review.

| Raw path | Meaning / units | Source; required? | Qualification; missing behavior | Direct/inferred | Candidate → proposed generic destination / open question |
| --- | --- | --- | --- | --- | --- |
| request `network_id` | EVM chain ID decimal string | Prepared chain; required | D only; reject mismatch | D + I binding | none → provider.chainId; confirm chain identity contract |
| request `from`,`to`,`input`,`value` | EVM addresses, hex bytes, atomic wei decimal | Exact unsigned payload; required | D only; reject missing/extra fields | D + I binding | none → execution binding; decide canonical tx digest |
| request `block_number` | Arbitrum block height integer | Prepared block; required | D only; reject missing/hashless prepared context | D + I binding | none → requestedBlock; decide hash pin mechanism |
| `transaction.status` + `simulation.status` | Boolean simulated outcome | API response; required | D only; mismatch/missing → `unknown` | D + I joint rule | `tenderly.execution.status` → execution.status; decide dual-status authority |
| `transaction.gas_used` | EVM gas units integer | API response; required for success | D only; missing/invalid → `unknown` | D | `tenderly.gas.used` → execution.gasUsed; distinguish estimate |
| `transaction.error_message`,`error_info.error_message` | Provider text, encoding unspecified | API response; optional | D only; never returned until sanitized/qualified | D | none → revertReason; decide safe text policy and authority |
| `transaction.transaction_info.asset_changes` | Provider decoded asset changes; units vary by token | API response; required array for success, contents optional | D only; missing → `unknown` | D + I completeness | `tenderly.assetChanges.available` → assetChanges; decide token identity/decimals |
| `transaction.transaction_info.balance_changes` | Balance changes; units/encoding unqualified | API response; required array for success, contents optional | D only; missing → `unknown` | D + I completeness | `tenderly.balanceChanges.available` → balanceChanges; decide owner and unit semantics |
| `transaction.transaction_info.logs` | Event logs; shape unqualified | API response; optional | D only; missing retained as unavailable | D | none → logs; decide if required |
| `transaction.transaction_info.state_diff` | State delta; shape unqualified | API response; optional | D only; missing retained as unavailable | D | none → stateDiff; decide if required |
| `transaction.block_number`,`simulation.block_number` | Simulated block height integers | API response; required | D only; mismatch → `unknown` | D + I binding | `tenderly.block.number` → blockContext.number; decide L2/L1 distinction |
| `transaction.block_hash` | 32-byte block hash if provided | API response; required by current adapter | D example may be empty; missing → `unknown` | D + I rule | `tenderly.block.hash` → blockContext.hash; determine available hash source |
| local `observedAt` | UTC ISO capture instant | Adapter clock; required | Code-derived; real clock unqualified | I | provider.observedAt → fetchedAt; decide clock trust/freshness |

### Error and control matrix

`Result` means a provisional `ProviderEvaluationResult` exists. Every non-success outcome disallows downstream generic evidence promotion; even `success` candidates need Contract approval and explicit Backend projection.

| Case | Provider status/code | Retryable | Result | Basis |
| --- | --- | --- | --- | --- |
| Auth 401/403 | `FAILED` | no | no | docs + deterministic |
| Network failure / HTTP 5xx | `FAILED` | yes | no | deterministic; live unknown |
| Client timeout | `TIMEOUT` | yes | no | deterministic; live unavailable |
| Rate 429 | `FAILED` | yes | no | docs + deterministic; retry-after unqualified |
| Invalid request / unknown resource 400/404 | `UNKNOWN` | no | no | docs + deterministic; exact cause unqualified |
| Unsupported chain/protocol or transaction fields | `UNSUPPORTED` before HTTP | no | no | deterministic |
| Invalid prepared request / chain mismatch | `UNKNOWN` or `UNSUPPORTED` | no | no | deterministic |
| Simulated revert with fully bound response | `failed` | no | yes | deterministic only; no real revert reason |
| Provider internal error 500 | `FAILED` | yes | no | docs + deterministic |
| Malformed JSON | `UNKNOWN` | no | no | deterministic |
| Partial body or status mismatch | `unknown` | no | yes | deterministic |
| Missing/mismatched block provenance | `UNKNOWN` before HTTP, `unknown` after HTTP | no | only after HTTP | deterministic |
| Stale/unverifiable evidence | `unknown` | no | yes | code-derived; no real head-lag test |

## Promotion decision

`DEFERRED`. The adapter and optional Backend wiring are reviewable, but credentialed simulation, real sanitized fixtures, canonical #63 transaction binding, reliable block-hash provenance, and Contract Owner mapping decisions remain open. Revisit runtime qualification only after the required credentialed probe and real fixture capture are available. This integration does not claim `VERIFIED_RUNTIME`, does not add provider voting or fallback, and does not change the final Evidence Contract.
