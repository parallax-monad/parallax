# Recorded replay fixtures

`mon-to-usdc.json` and `usdc-to-mon.json` are canonical `RunResult` representations of the sanitized recorded baselines under `fixtures/chain-evidence/kuru/mon-to-usdc/` and `fixtures/chain-evidence/kuru/usdc-to-mon/`, supported by `docs/adr/0001-kuru-baseline-and-erc20-simulation-boundary.md`.

The replay endpoint reads these snapshots without calling Moss, RPC, Risk, Quote, or Action logic and without recomputing the recorded result.
