# BE-063 hardened real Camelot Sepolia swap evidence (v2)

`QUALIFIED_REAL` under the PR #77 hardened validator for one **read-only, pinned-block** WETH-input Camelot V3 scenario. `CANONICAL_TARGET=ACCEPTED` by the Product Owner; **controlled P0 Gate acceptance is still pending** this evidence-integrity review. This is neither a signed/broadcast transaction nor a NativeRpcProvider end-to-end test.

This is the hardened replacement for the historical [`../camelot-sepolia-real-2026-09-17T13-05-18-025Z/`](../camelot-sepolia-real-2026-09-17T13-05-18-025Z/) capture, which stored `method`/`params` but never a request JSON-RPC `id`. The historical capture is preserved unchanged and is no longer sufficient final controlled-Gate evidence.

## Reproduce and provenance

From the repository root with Node 22:

```bash
node scripts/provider-probes/camelot-sepolia-real-swap.mjs
```

The script uses only the official public, keyless Arbitrum Sepolia RPC and a fixed read-only method allowlist. It chooses a fresh head, pins every contract/quote/evaluation read to that block, and creates a new timestamped directory (it never overwrites an existing capture). It embeds no endpoint credential or authentication header. The committed probe source is `fix(provider): bind Camelot evidence to RPC requests` / `30f4ebf`; `repositoryHeadAtCapture` records the repository HEAD at the moment of capture (`6c555cf37cc4fa68ac8c1b2f7e40c7e2a450564b`), which is the parent of that hardening commit because the capture was taken from the hardened working tree immediately before committing.

Pinned block: number `310131879` (`0x127c3ca7`), hash `0x715bfaca417a25ed4d317748ecf0cfbd0ad38d4e14c2e1c0fb42ac0c8e60feff`, timestamp `2026-09-18T08:47:42Z`. Requests ran from `2026-09-18T08:47:39.091Z` to `2026-09-18T08:47:56.321Z`. `eth_chainId=0x66eee` (421614). The observed head, quote block, prepared-transaction context and evaluation block are all the pinned block; no general freshness guarantee follows.

## Hardened evidence-integrity rules (schema v2)

The capture adds two P1 rules on top of the four earlier rules (2xx HTTP + JSON-RPC envelope + no `error` + expected result type; non-null prepared swap; sender pinned by `blockNumber` and `blockHash`; exactly one 32-byte `eth_call` word).

1. **Complete JSON-RPC request/response id binding.** Every record persists a sanitized request object `{ jsonrpc, id, method, params }`. A response is usable only when it carries an `id` that strictly equals the request `id`; a missing or mismatched id on either side fails the record.
2. **Every qualifying observation is bound to its actual request.** The qualifying quote must be the `eth_call` to the pinned Quoter with the exact `quoteProbes` calldata and pinned block; the prepared `eth_call` and `eth_estimateGas` params must equal the exact `preparedSwap.tx` `from`/`to`/`data`/`value` and the pinned block; the sender must be the `eth_getTransactionByHash` response for exactly `senderTransactionHash`; and the prepared calldata is decoded against the canonical target.

`revalidateCapture` in `scripts/provider-probes/camelot-sepolia-real-swap.mjs` replays the hardened audit and qualification offline over this `capture.json`; `scripts/provider-probes/camelot-sepolia-real-swap.test.mjs` asserts it re-derives to `QUALIFIED_REAL` with no reasons and that every request/response id matches.

## Deployment and pool

| Role | Address | Pinned observation |
| --- | --- | --- |
| AlgebraFactory | `0xaA37Bea711D585478E1c04b04707cCb0f10D762a` | Code present; `poolByPair(WETH, USDC)` returned the pool below |
| Quoter | `0xe49ef2F48539EA7498605CC1B3a242042cb5FC83` | Code present; `IQuoter` single-pool ABI returned two words |
| SwapRouter | `0x171B925C51565F5D2a7d8C494ba3188D304EFD93` | Code present; exact-input swap returned output through `eth_call` |
| WETH | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` | Code present; `decimals()=18`; pool ERC-20 balance `9880665448011860337` atomic |
| Camelot-listed testnet USDC | `0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7` | Code present; `decimals()=18`; pool ERC-20 balance `169866832475260940745` atomic |
| Pool | `0x3965361ea4f9000ae3cf995f553115b2832d0e2d` | Code present; token0=WETH, token1=USDC; active `liquidity()=42569169734279816834` |

`globalState()` returned eight words: `sqrtPriceX96=315781986584200766070007200829`, `tick=27655`, `feeZto=104`, `feeOtz=104`. Fees are in 1e-6 units; `104` is the current 0.0104% fee, not a universal future quote fee. An Integral-only `safelyGetStateOfAMM()` selector reverted; the successful eight-word directional-fee layout and V1 Quoter response are the applicable observations. The pinned token balances are ERC-20 `balanceOf(pool)` reads, not a claim of full-range reserves.

## Quote and exact unsigned transaction

Single-pool direction: **WETH → testnet USDC**, `amountIn=1000000000000000` atomic (`0.001` WETH). The probe confirmed `min(pool input-token balance / 1000, 0.001 token)` resolved to the canonical `0.001` WETH and would have failed loudly otherwise. There is **no fee-tier argument** in this Algebra single-pool quote or router function. `limitSqrtPrice=0`; the direction's fee returned by the quoter is `104`.

`IQuoter.quoteExactInputSingle(address,address,uint256,uint160)` selector `0x2d9ebd1d` returned `amountOut=15882896725531551` atomic (`0.015882896725531551` test USDC). The exact query calldata and raw two-word result are in `observations.quoteProbes` and its matching request record; the script only uses the quote after re-decoding the raw record and confirming the exact Quoter target, calldata and pinned block. The V2 selector `0x5e5e6e0f` reverted here and is **not** the observed ABI for this deployment.

`ISwapRouter.exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))`, selector `0xbc651188`, has arguments `(WETH, USDC, recipient, deadline, amountIn, amountOutMinimum, limitSqrtPrice)`. The prepared transaction in `observations.preparedSwap.tx` has all required `from`, `to`, `data`, `value`, and `chainId` fields, and the validator decodes the calldata deterministically instead of trusting a hex string. `from=recipient=0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396`; `to=SwapRouter`; `value=1000000000000000` wei (`0x38d7ea4c68000`); `chainId=421614`. `amountOutMinimum=15724067758276235` atomic (99% of the pinned quote, rounded down). The deadline is `2026-09-18T09:47:42Z`; this captured transaction becomes stale after that time.

The `from` address is from public transaction `0xb116ef6ce279668d555498e0e5a836f8ef35f997667e87a75757ec47332a644a` in the pinned block. Public `eth_getBalance` at that block was `10747790448874000` wei, above `value` plus the probe's 0.001 ETH margin. An earlier candidate transaction in the block did not meet that margin and was not used. It was used only as public read-only call context; no control of that address is claimed. The payable router path wrapped native `msg.value` for WETH input in the successful pinned `eth_call`; this path did not need an ERC-20 allowance in the observed call. An ERC-20-input transaction would require an allowance and must be qualified separately.

Pinned `eth_call` returned `15882896725531551` atomic, exactly one ABI word, equal to the quote. Pinned `eth_estimateGas` returned `0x426b4` = **272052** gas.

**`eth_estimateGas` block provenance, stated truthfully.** The probe supplied the pinned block number as the optional second `eth_estimateGas` parameter and the validator binds that recorded parameter exactly to the pinned block. This proves what was requested and accepted by the public RPC; it does **not** independently prove backend state selection at that block (no state diff is produced). `eth_call` similarly carries the pinned block as its second parameter. Neither method sent a transaction. A future actual execution can differ because price, liquidity, fees, sender balance, gas pricing, and deadline can change.

## Source and capability boundaries

- [Camelot official Sepolia deployment list](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/) supplies chain, addresses, and token listings; the pinned RPC reads independently checked contract code, token facts, and factory-to-pool linkage.
- [Official Algebra `IQuoter` interface](https://github.com/cryptoalgebra/Algebra/blob/85739e4239d3f18c9f43f74dc173b13db743d13f/src/periphery/contracts/interfaces/IQuoter.sol), [router interface](https://github.com/cryptoalgebra/Algebra/blob/85739e4239d3f18c9f43f74dc173b13db743d13f/src/periphery/contracts/interfaces/ISwapRouter.sol), and [native-payment implementation](https://github.com/cryptoalgebra/Algebra/blob/85739e4239d3f18c9f43f74dc173b13db743d13f/src/periphery/contracts/base/PeripheryPayments.sol) explain the calldata, outputs, payable function, and native wrap branch. The deployed behavior was checked through RPC; a byte-for-byte deployed-source match was not established.
- [Official Algebra V1.9 directional-fee pool-state reference](https://docs.algebra.finance/algebra-integral-documentation/algebra-v1-technical-reference/contracts/api-reference-v1.9-directional-fees/v1.9-directional-fees-core/ialgebrapoolstate) supplies the eight-word `globalState` interpretation. Pool bytecode source provenance is not independently verified.
- The official public RPC accepted this 29-request sequence without an API key. Provider-wide rate limits, timeout guarantees, error stability, archive retention, and a final freshness threshold remain `UNKNOWN`. The observed V2 and Integral-only selector errors are method-specific RPC errors, not generic Provider verdicts.
- `eth_call` and `eth_estimateGas` prove this read-only execution context only. They do not produce a receipt, logs, state diff, final asset-change set, signed transaction, NativeRpcProvider normalized Evidence, Risk verdict, or P0 Gate acceptance.

## Product handoff

`CANONICAL_TARGET=ACCEPTED`: the real deployment and pool, token precision, a reproducible on-chain quote, an exact protected unsigned transaction, and successful pinned native-input `eth_call`/`eth_estimateGas` are present, and the WETH → test-USDC Camelot V3 target is accepted by the Product Owner. **Controlled P0 Gate acceptance is still pending** this request-binding evidence review. Backend #66/P0 Golden Path must integrate and validate this scenario; this fixture alone is not system acceptance. No transaction was signed or broadcast.
