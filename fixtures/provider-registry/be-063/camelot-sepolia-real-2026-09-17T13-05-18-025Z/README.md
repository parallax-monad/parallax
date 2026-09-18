# BE-063 real Camelot Sepolia swap evidence

`QUALIFIED_REAL` for one **read-only, pinned-block** WETH-input Camelot V3 scenario. `CANONICAL_TARGET_CANDIDATE=YES`. Product Owner acceptance under #67 is still open. This is neither a signed/broadcast transaction nor a NativeRpcProvider end-to-end test.

## Reproduce and provenance

From the repository root with Node 22:

```bash
node scripts/provider-probes/camelot-sepolia-real-swap.mjs
```

The script uses only the official public Arbitrum Sepolia RPC and a fixed read-only method allowlist. It chooses a fresh head, pins every contract/quote/evaluation read to that block, and creates a new timestamped directory. Results will change as chain state changes. The exact snapshot is [`capture.json`](capture.json), with 29 request records, `fetchedAt`, complete JSON-RPC params and raw results/errors. It embeds no endpoint credential or authentication header. The committed probe source was at `65f22ad889e69148d3d5edfdda798d271c8e8291` at capture. The observed head, quote block, prepared-transaction context, and evaluation block are all **309847828** (`0x1277e714`) in this capture; no general freshness guarantee follows.

Pinned block hash: `0x64da70b798bd462b0949e87439e7be1fa7fe5b7e5545598f6d0c3e7ec89a61c7`; block timestamp `2026-09-17T13:05:07Z`. Capture requests ran from `2026-09-17T13:05:07.382Z` to `2026-09-17T13:05:17.693Z`. `eth_chainId=0x66eee` (421614).

## Hardened qualification criteria and offline revalidation

PR #77 review tightened four evidence-integrity rules in the probe:

1. a result counts as evidence only when the HTTP status is successful, the JSON-RPC envelope is valid, no `error` member is present, and `result` is present with the expected type — a body carrying both `result` and `error`, or a non-2xx body carrying a `result`, is rejected;
2. `QUALIFIED_REAL` explicitly requires a non-null `preparedSwap` plus the real quote, the exact prepared transaction, a successful pinned `eth_call`, a decoded `eth_call` output equal to the quote output, and a successful pinned `eth_estimateGas`;
3. the public sender taken from `eth_getTransactionByHash` is usable only when that transaction exists, carries a valid sender, and has both `blockNumber` and `blockHash` equal to the pinned block;
4. the `exactInputSingle` return value must be exactly one ABI word (32 bytes / 64 hex characters) before the `uint256` output is decoded.

**This capture was not rerun and no new live RPC read was made for that hardening.** The stored raw records already carry `httpStatus` and the complete JSON-RPC envelope for all 29 requests, so the historical evidence was revalidated offline against the tightened rules. `revalidateCapture` in `scripts/provider-probes/camelot-sepolia-real-swap.mjs` replays the hardened record audit and qualification over the committed `capture.json`, and `scripts/provider-probes/camelot-sepolia-real-swap.test.mjs` asserts the deterministic result: 29/29 records pass the audit and the capture re-derives to `QUALIFIED_REAL` with no reasons. The same tests prove the rules bind, since a non-2xx record, a cleared `preparedSwap`, a changed sender `blockNumber`/`blockHash`, a widened `eth_call` word, or a record carrying both `result` and `error` each drops the capture out of `QUALIFIED_REAL`.

The historical raw observations in `capture.json` are preserved unchanged; only the probe, its deterministic tests, and this section changed. `repositoryHeadAtCapture` stays `65f22ad889e69148d3d5edfdda798d271c8e8291`, the probe source commit at capture time.

## Deployment and pool

| Role | Address | Pinned observation |
| --- | --- | --- |
| AlgebraFactory | `0xaA37Bea711D585478E1c04b04707cCb0f10D762a` | Code present; `poolByPair(WETH, USDC)` returned the pool below |
| Quoter | `0xe49ef2F48539EA7498605CC1B3a242042cb5FC83` | Code present; `IQuoter` single-pool ABI returned two words |
| SwapRouter | `0x171B925C51565F5D2a7d8C494ba3188D304EFD93` | Code present; exact-input swap returned output through `eth_call` |
| WETH | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` | Code present; `decimals()=18`; pool ERC-20 balance `9880665448011860337` atomic |
| Camelot-listed testnet USDC | `0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7` | Code present; `decimals()=18`; pool ERC-20 balance `169866832475260940745` atomic |
| Pool | `0x3965361ea4f9000ae3cf995f553115b2832d0e2d` | Code present; token0=WETH, token1=USDC; active `liquidity()=42569169734279816834` |

`globalState()` returned eight words: `sqrtPriceX96=315781986584200766070007200829`, `tick=27655`, `feeZto=104`, `feeOtz=104`. Fees are in 1e-6 units; `104` is the last known 0.0104% fee, not a universal future quote fee. An Integral-only `safelyGetStateOfAMM()` selector reverted; the successful eight-word directional-fee layout and V1 Quoter response are the applicable observations. The pinned token balances are ERC-20 `balanceOf(pool)` reads, not a claim of full-range reserves.

## Quote and exact unsigned transaction

Single-pool direction: **WETH → testnet USDC**, `amountIn=1000000000000000` atomic (`0.001` WETH). The probe chose the smaller of 0.001 token and 1/1000 of the pool's pinned input-token balance, then obtained the actual on-chain quote. There is **no fee-tier argument** in this Algebra single-pool quote or router function. `limitSqrtPrice=0`; the direction's fee returned by the quoter is `104`.

`IQuoter.quoteExactInputSingle(address,address,uint256,uint160)` selector `0x2d9ebd1d` returned `amountOut=15882896725531551` atomic (`0.015882896725531551` test USDC) at `2026-09-17T13:05:14.577Z`. The exact query calldata and raw two-word result are in `observations.quoteProbes` and its matching request record. The V2 selector `0x5e5e6e0f` reverted here and is **not** the observed ABI for this deployment.

`ISwapRouter.exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))`, selector `0xbc651188`, has arguments `(WETH, USDC, recipient, deadline, amountIn, amountOutMinimum, limitSqrtPrice)`. The prepared transaction in `observations.preparedSwap.tx` has all required `from`, `to`, `data`, `value`, and `chainId` fields. `from=recipient=0xf5d0f57f31219c04f3b56f26faa5d57274e58528`; `to=SwapRouter`; `value=1000000000000000` wei (`0x38d7ea4c68000`); `chainId=421614`. `amountOutMinimum=15724067758276235` atomic (99% of the pinned quote, rounded down). The deadline is `2026-09-17T14:05:07Z`; this captured transaction becomes stale after that time. Reproduction builds a new one.

The `from` address is from public transaction `0x6137a0fbec4f2f5012cf6067944044ccf845d7814a846869bc3b7657e078a7f2` in the pinned block. Public `eth_getBalance` at that block was `4541121463251710000` wei, above `value` plus the probe's 0.001 ETH margin. It was used only as public read-only call context; no control of that address is claimed. The payable router path wrapped native `msg.value` for WETH input in the successful pinned `eth_call`; this path did not need an ERC-20 allowance in the observed call. An ERC-20-input transaction would require an allowance and must be qualified separately.

Pinned `eth_call` at `2026-09-17T13:05:17.383Z` returned `15882896725531551` atomic, equal to the quote. Pinned `eth_estimateGas` at `2026-09-17T13:05:17.693Z` returned `0x42616` = **271894** gas. The RPC used the transaction object with the pinned block as the second parameter for both. Neither method sent a transaction. A future actual execution can differ because price, liquidity, fees, sender balance, gas pricing, and deadline can change.

## Source and capability boundaries

- [Camelot official Sepolia deployment list](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/) supplies chain, addresses, and token listings; the pinned RPC reads independently checked contract code, token facts, and factory-to-pool linkage.
- [Official Algebra `IQuoter` interface](https://github.com/cryptoalgebra/Algebra/blob/85739e4239d3f18c9f43f74dc173b13db743d13f/src/periphery/contracts/interfaces/IQuoter.sol), [router interface](https://github.com/cryptoalgebra/Algebra/blob/85739e4239d3f18c9f43f74dc173b13db743d13f/src/periphery/contracts/interfaces/ISwapRouter.sol), and [native-payment implementation](https://github.com/cryptoalgebra/Algebra/blob/85739e4239d3f18c9f43f74dc173b13db743d13f/src/periphery/contracts/base/PeripheryPayments.sol) explain the calldata, outputs, payable function, and native wrap branch. The deployed behavior was checked through RPC; a byte-for-byte deployed-source match was not established.
- [Official Algebra V1.9 directional-fee pool-state reference](https://docs.algebra.finance/algebra-integral-documentation/algebra-v1-technical-reference/contracts/api-reference-v1.9-directional-fees/v1.9-directional-fees-core/ialgebrapoolstate) supplies the eight-word `globalState` interpretation. Pool bytecode source provenance is not independently verified.
- The official public RPC accepted this 29-request sequence without an API key. Provider-wide rate limits, timeout guarantees, error stability, archive retention, and a final freshness threshold remain `UNKNOWN`. The observed V2 and Integral-only selector errors are method-specific RPC errors, not generic Provider verdicts.
- `eth_call` and `eth_estimateGas` prove this read-only execution context only. They do not produce a receipt, logs, state diff, final asset-change set, signed transaction, NativeRpcProvider normalized Evidence, Risk verdict, or P0 Gate acceptance.

## Product handoff

`CANONICAL_TARGET_CANDIDATE=YES`: real deployment and pool, token precision, a reproducible on-chain quote, exact protected unsigned transaction, and successful pinned native-input `eth_call`/`eth_estimateGas` are present. Product Owner #67 must accept the canonical pair, intended user-facing Swap Intent and economic constraints, the minimum Native RPC evidence flow, and incomplete/stale evidence behavior. Backend #66/P0 Golden Path must integrate and validate this scenario; this fixture alone is not system acceptance. No transaction was signed or broadcast.
