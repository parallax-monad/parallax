# BE-078 canonical NativeRpcProvider exercise

This fixture area records the independent, real execution of the accepted BE-063 / PR #77
unsigned Camelot transaction through the concrete `NativeRpcProvider` and its public
`evaluateProviderAdapter` boundary. The runner pins the exact transaction to the accepted
block, requires the RPC-observed block hash to match, and writes a new timestamped capture
only after `eth_chainId`, `eth_call`, and `eth_estimateGas` all succeed with the expected
observations.

Run from the repository root:

```bash
pnpm --filter @parallax/api probe:native-rpc-canonical
```

The default endpoint is the keyless official Arbitrum Sepolia public RPC. To use an
archive-capable endpoint for the accepted historical block, set
`ARBITRUM_SEPOLIA_RPC_URL` in the process environment or in the worktree-root `.env`
before running the command. The `.env` file is ignored by Git. The endpoint value is never
written into the capture. Failed or incomplete runs do not create a PASS fixture.

This is a read-only provider exercise. A PASS confirms only the concrete Provider's
verified chain/block, pinned `eth_call`, and pinned gas estimate. It does not claim a
receipt, state diff, Risk verdict, signed transaction, broadcast, or full Backend Demo
Gate acceptance.
