# #103 USDC → WETH Camelot V3 bounded feasibility

Current classification: **BLOCKED_ACCOUNT_STATE / Asset Coverage NOT COMPLETE**.
This is real, read-only Arbitrum Sepolia evidence, not a successful reverse swap,
production integration, Product P0 acceptance, or #105 unlock.

## Reproduce

From `apps/api` with Node 22 and an authorized local HTTPS
`ARBITRUM_SEPOLIA_RPC_URL` in the repository's ignored `.env`:

```bash
node --env-file=../../.env --import=tsx/esm ../../scripts/provider-probes/usdc-weth-camelot-feasibility.ts
```

The runner requires a clean committed `feat/usdc-weth-camelot-feasibility` source
head and creates a new timestamped capture. It calls only read-only RPC methods.
It never signs, approves, broadcasts, takes custody, or overrides state. It
persists normalized facts, exact unsigned transaction calldata, controlled
failure codes, hashes, and source provenance; it excludes RPC URLs, raw provider
responses, and raw error text.

Final capture in this bounded attempt:

`usdc-weth-camelot-2026-09-28T11-39-14-324Z/capture.json`

Capture SHA-256:

`44c665475d8ca88feefb91ed810fedafb7592c021b4534f7b12f973e85dd9c4e`

Clean source head at capture:

`35f6ddfd3f6c5c4f8b503c5725a05ce9c337073b`

The capture's manifest binds the runner, Camelot adapter, transaction-binding
inspector, Native RPC client, trusted-token registry, and accepted #77 Camelot
source fixture. The independent capture test recomputes those hashes and audits
the normalized assertions.

## Observed facts and limit

At pinned block `313595416` (hash
`0xb190a9ea5f727b37e7fe84741b1a37cd7bd49d5f0bc1abe2b1b8f5e2f4693520`),
the chain was `421614`, both trusted token addresses had code and onchain
`decimals() = 18`, the factory resolved the accepted WETH/USDC pool, the pool had
active liquidity and both token balances, and the reverse IQuoter call returned
`62941723964863` atomic WETH for `1000000000000000` atomic testnet USDC.

The existing Camelot adapter produced an exact unsigned
`exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))`
transaction with USDC input, WETH output, router target, `tx.value = 0`, and
`amountOutMinimum = 62312306725214` atomic WETH (99% of the pinned quote,
rounded down). The existing transaction-binding inspector passed. A pinned
`debug_traceCall` observed the router calling USDC `transferFrom`, confirming
the router as the actual allowance spender for this path. This trace is used
only to identify that call boundary; no raw trace payload is in the capture.

The selected public account had **0 USDC** and **0 router allowance** at that
block. A second public historical sender also had 0/0. The exact prepared
transaction's pinned `eth_call` and `eth_estimateGas` both failed with controlled
RPC code `3`; their raw error strings were not persisted. The account facts are
sufficient to establish a real current-state blocker. The captured revert is
not promoted into a claim about a successful executable ERC-20-input path.

Exploratory public Approval-log searches over a bounded recent block window
found one router-approved USDC owner; the runner independently verified its
public receipt, then read its current pinned balance and allowance as 0/0.
This search is not a claim that no funded, approved account exists anywhere.
The feasibility attempt stopped well before the four-hour maximum because no
available real account state could establish successful read-only execution,
and changing that state would cross the unsigned/read-only boundary.

Next gate: #103 remains NOT COMPLETE. #105 must stay blocked until a new real
qualification proves a sender with sufficient USDC and allowance, successful
pinned `eth_call` and `eth_estimateGas`, and the same exact transaction binding.
#73 remains an independent Product P0 acceptance gate and is not claimed PASS.
