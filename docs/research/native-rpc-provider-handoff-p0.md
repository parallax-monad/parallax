# Native RPC Provider Owner handoff — issues #63 and #66

Status: **PARTIALLY_QUALIFIED** for the Arbitrum Sepolia × Camelot V3 scenario as of 2026-09-16. Provider code is real-capable; a canonical Product target and executable swap path are not yet established. This handoff is stacked on PR #68 at `24e17189008f04cf7a13efd7920cd94bc48dde22`. It does not decide final GenericEvidence, Risk, Product, or Receipt semantics.

## Integration boundary

`providerId` is `native-rpc-arbitrum`. Construct through `createNativeRpcProvider({ rpcUrl, mode: "LIVE" })`, or inject a `NativeRpcClient` for deterministic tests, then register its factory-created adapter. The endpoint is explicit: Backend may pass its validated `ARBITRUM_RPC_URL` into `nativeRpc.rpcUrl`; the Provider does not read environment variables or choose a fallback. `ARBITRUM_SEPOLIA_RPC_URL` is only the existing research probe override. Never log either value. No wallet, signer, or broadcast method exists.

The Provider accepts one Backend-prepared unsigned transaction for chain 421614 and protocol `camelot-v3`. The payload must include exact `from`, `to`, `data`, and hex `value`; `from` must match the prepared intent sender. The Provider forwards the payload unchanged to both methods. It does not derive a sender or zero value, rebuild calldata, quote, or select a route. A missing field or inconsistent run, intent, chain, block, or transaction returns `unknown` before transaction evaluation. Both `eth_call` and `eth_estimateGas` use the prepared block number as an explicit second parameter. There is no `latest` fallback.

Before evaluating, `eth_getBlockByNumber` verifies the pinned number and hash. A supplied preparation hash must match the RPC observation. The RPC methods then use the block **number**, not an EIP-1898 hash reference. A reorganization between verification and evaluation could therefore change the block at that height; hash-anchored execution is not claimed. The preparation block, verified RPC block, optional observed head, and freshness policy are distinct. `observedAt` is the Provider result time. `checkFreshness` opts into `eth_blockNumber`; `maxBlockLag` is caller policy, not a universal Provider threshold. Missing head evidence remains `not_checked` or `unknown`, never `fresh`.

The Provider's `success` means the two RPC methods returned valid values at the verified block. It is **partial evidence**: no receipt, full asset-change set, state diff, outcome, or economic-constraint verdict is established. The provisional GenericEvidence mapping keeps `provider.status = UNKNOWN` and those scopes unknown. Backend owns Registry, pipeline, system composition, and this provisional projection. Contract Owner decides its final semantics.

## Capability matrix

| Surface | Scope and input | Output and units | Provenance and current evidence | Limit / failure |
| --- | --- | --- | --- | --- |
| `eth_call` | Exact prepared transaction, verified pinned block number | Hex return bytes, including valid `0x` | Runtime-capable; live WETH `decimals()` read at block 309542712; controlled Provider tests | No swap call or complete simulation observed; malformed hex is `unknown` |
| `eth_estimateGas` | Same exact transaction and explicit block parameter | Hex RPC quantity normalized to decimal gas units | Runtime-capable; public endpoint accepted pinned parameter for WETH `decimals()`, returned 31300 gas units | Acceptance for a read call does not prove swap support on every endpoint; rejection stays `unknown`, never retries at latest |
| Pinned block | Decimal preparation number, optional 32-byte hash | Verified number and hash | `eth_getBlockByNumber` checked before transaction calls; live hash in fixture | Missing block or mismatched hash fails closed |
| Call return data | `eth_call` result | Even-length hex bytes | Controlled tests and live token metadata read | Return bytes alone do not imply receipt, output amount, or asset changes |
| Revert/error | JSON-RPC error code and bounded semantic message | `rpcCode` number; sanitized message | Live historical controlled revert in BE-011 fixture; deterministic current tests | Full revert data and ABI reason are not promoted to a generic verdict |
| Freshness inputs | Result time, pinned block, optional head | ISO time, decimal block heights and lag | Deterministic tests; live pinned block; no live lag policy qualification | `maxBlockLag` is configured policy; absent head is unknown/not checked |
| Rate limits and key | Explicit HTTP(S) endpoint | None in result | Official public endpoint used for qualification without key | Rate limits and private endpoint requirements are unknown; endpoint URL, headers and query are never captured |

`supports()` is true only for chain 421614, `camelot-v3`, and `simulate`, `eth_call`, `estimateGas`, or `pinned-block`. `simulate` denotes the partial RPC evaluation seam, not a full simulation receipt. Sender semantics are identical for call and estimate: both use the supplied `from`; a different sender is rejected before either request.

## Error and control matrix

| State | Provider status | Retryability | GenericEvidence in current pipeline | Evidence basis / fail-closed behavior |
| --- | --- | --- | --- | --- |
| HTTP/network failure | `failed` | Unknown, no automatic retry | None | Client and deterministic tests; sanitized, no raw URL |
| Timeout | `timeout` | Yes, caller may retry | None | Deterministic fetch cancellation; no live outage claim |
| Caller abort | `unknown` | No automatic retry | None | Deterministic cancellation; request is aborted |
| JSON parse failure | `unknown` | Unknown | None | Deterministic transport test |
| Invalid JSON-RPC envelope / ID mismatch / missing result | `unknown` | Unknown | None | Deterministic transport tests |
| Method unsupported (`-32601`) | `unsupported` | No | None | Deterministic Provider test; historical public endpoint method-not-found envelope is separate |
| RPC invalid params (`-32602`) | `unknown` | No | None | Deterministic test; pinned estimate rejection never falls back |
| RPC error or revert | `failed` or `unknown` for revert | Unknown / no automatic retry | None | Sanitized code/message; historical WETH revert, not a swap result |
| Invalid hex return or gas quantity | `unknown` | No | None | Deterministic Provider tests |
| Missing prepared material / pinned block unavailable | `unknown` or transport status | No automatic retry | None | Deterministic tests; no transaction call after mismatch |
| Partial successful call + gas | `success` | Not applicable | Provisional partial evidence with Provider `UNKNOWN` | Deterministic Provider test; cannot imply `PROCEED` |
| Stale / unverifiable head | `stale` / `unknown` | Policy-dependent / unknown | None | Deterministic tests; no universal lag threshold |

The client distinguishes HTTP, network, JSON parse, malformed envelope, ID mismatch, missing result, RPC error, timeout, and abort. It does not expose raw transport error messages because they may contain endpoint secrets. Only a bounded RPC semantic message and numeric error code cross the Provider boundary. An injected client's arbitrary error is also sanitized.

## Issue #63 live qualification

[Camelot's Arbitrum Sepolia deployment page](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/) lists chain 421614, AlgebraFactory, Quoter, SwapRouter, WETH, and a testnet USDC address. At pinned block **309542712** (`0x96f7acffd774582a051f36cef58b1ce6ec0d770aa39223ba7b044849f70ebbb8`), read-only `eth_getCode` returned nonempty code at all five listed addresses. On-chain `decimals()` returned **18** for both listed WETH and testnet USDC. Do not substitute mainnet USDC decimals. [Algebra's factory interface](https://github.com/cryptoalgebra/algebra-integral-docs/blob/main/integration-of-algebra-integral-protocol/contracts-api/Core/interfaces/IAlgebraFactory.md) documents `poolByPair(address,address)`; it returned `0x3965361ea4f9000ae3cf995f553115b2832d0e2d` for this WETH/USDC candidate, and `eth_getCode` at the same block was nonempty. The exact sanitized calls, returned values, and timestamps are in [`qualification.json`](../../fixtures/provider-registry/be-011/native-rpc/camelot-sepolia-2026-09-16/qualification.json).

This qualifies a **candidate pair and pool**, not the canonical Product target. The repository's `be-041/camelot-v3/target-scenarios.json` still has `pair` and `pool` unconfigured. No Camelot quoter call, executable quote, exact unsigned swap transaction, swap `eth_call`, or swap `eth_estimateGas` was qualified. Product Owner issue #67 must select the canonical pair, route, sender/intent, and acceptance scope. Backend must then prepare an exact unsigned transaction from a real quote before Provider evaluation can complete #63/#66 live acceptance.

## Reproduction and evidence limits

Use Node 22 and the repository's existing `scripts/provider-probes/arbitrum-sepolia-native-rpc.ts` for the basic read-only RPC surface. To reproduce this new snapshot, use the official public endpoint listed in Camelot's page or an approved explicit endpoint. First call `eth_chainId`, `eth_blockNumber`, and `eth_getBlockByNumber` with `false`, then repeat each `qualification.json` method and sanitized `params` at its pinned block. Historical state may require an archive-capable endpoint; a new head is a new capture, not the same observation. Verify each returned envelope ID and the block hash. Never record an endpoint URL, key, authorization header, or cookie. This capture used no private endpoint, signing, broadcast, or wallet.

The previous BE-011 public RPC fixtures remain historical observations. They do not prove this Provider version, a Camelot swap, a real quote, or Product acceptance. This new fixture likewise does not prove code source equivalence from code size alone. No fixed freshness threshold, rate limit, or final Evidence Contract is asserted.
