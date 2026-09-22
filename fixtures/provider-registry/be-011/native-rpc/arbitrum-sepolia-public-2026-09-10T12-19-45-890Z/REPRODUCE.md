# Reproduce the BE-011 Native RPC surface probe

This fixture is a sanitized real snapshot. Re-running the probe performs only
the fixed read-only JSON-RPC sequence in the source and selects the current
Arbitrum Sepolia head, so block-dependent values will change.

Run with Node 22 from the repository root:

```bash
node --experimental-strip-types scripts/provider-probes/arbitrum-sepolia-native-rpc.ts
```

The embedded default is the official public Arbitrum Sepolia endpoint. An
approved HTTPS override may be supplied through `ARBITRUM_SEPOLIA_RPC_URL`.
The override value is never printed or persisted. Sequencer endpoints are
rejected.

Every successful run writes a new UTC-timestamped capture directory such as
`arbitrum-sepolia-public-YYYY-MM-DDTHH-MM-SS-mmmZ`. The probe fails closed
instead of overwriting an existing capture, and the final capture directory is
created only after all required live observations passed validation.

Safety: the probe has a fixed read-only method allowlist. It never signs,
broadcasts, submits a transaction, transfers tokens, requests faucet funds, or
writes chain state. The WETH transfer probe is an `eth_call` from a
deterministic address whose zero balance is first verified at the same pinned
block.
