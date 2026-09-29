# Issue #109 — one additional asset feasibility

Status: `QUALIFIED_REAL_FEASIBILITY` for the read-only Arbitrum Sepolia
Camelot V3 **USDC → GRAIL** scenario. This does not establish Asset Coverage
PASS or production support.

Capture: [grail-usdc-2026-09-29T13-31-53-975Z/capture.json](grail-usdc-2026-09-29T13-31-53-975Z/capture.json)

Capture SHA-256: `450fdb8d6adf4ed0c49b351cc8ab75614e589edb96bca01b7933ed3f8c4728d7`

The bounded discovery considered only the two token addresses in
[Camelot's Arbitrum Sepolia contract list](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/).
Pinned contract calls verified both symbols and 18 decimals. GRAIL had a
direct USDC pool with active liquidity, nonzero token balances, and a real
quote. xGRAIL had no direct WETH or USDC pool at the pinned block, so it was
rejected. The selected input is the already qualified test USDC, allowing
reuse of the public third-party EOA discovered in #103. Its balance,
router allowance, and native balance were read again at the #109 pinned block.

The existing Camelot adapter constructed the unsigned transaction, and the
existing binding decoder checked its calldata against the Intent and quote.
Pinned `eth_call` and `eth_estimateGas` both succeeded; the pinned block hash
was rechecked. The official public RPC did not provide `debug_traceCall`.
The actual USDC `transferFrom` spender is therefore linked to the prior
qualified #103 trace for the same input token and router, while current
allowance is a separate #109 observation. No state override, approval,
signing, broadcast, or write RPC was used.

The protocol adapter and binding accept this pair with trusted output
decimals. No Backend composition or Frontend change is included. Runtime
registry configuration and any later Product acceptance remain separate
owner decisions; this feasibility capture does not activate a third pair.
