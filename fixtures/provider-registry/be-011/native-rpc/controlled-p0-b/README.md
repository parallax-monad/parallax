# BE-050 Native RPC controlled fixtures

`fixtures.json` contains deterministic adapter inputs for the fixture-first
Native RPC path. Every entry is `real: false`: it is an offline test input, not
a capture of Arbitrum RPC availability, a Camelot pair/pool, a quote, or a
completed simulation.

The provider uses only an injected RPC client. No endpoint, credential, signing,
broadcast, or chain write is encoded here. A successful `eth_call` and
`eth_estimateGas` fixture remains partial evidence; receipt, outcome,
asset-change, trace, log, and state-diff scopes stay explicitly unknown.

The concrete Provider Owner runtime handoff (endpoint lifecycle, live
qualification, and complete simulation coverage) remains a follow-up. Keep the
injected client seam and these controlled fixtures replaceable until that
handoff is approved.
