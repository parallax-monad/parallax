# BE-011 Provider Registry Fixture Manifest

This directory is an **index**, not a second Provider result model.

It exists so Backend can discover deterministic BE-011 evidence without treating mock data as a real Provider response or requiring secrets/network access.

## Truthfulness rules

- `real=true` means the referenced source was captured from a real runtime/provider interaction and sanitized.
- `real=false` means deterministic mock/rule/replay input only.
- Documentation-only capability claims are never materialized as fabricated Provider JSON.
- Missing real evidence is represented as an explicit pending/unavailable entry, not an invented response.
- Provider-specific raw types stay outside Generic Evidence/Core.
- No API keys, RPC secret URLs, private keys, cookies, access tokens, or unredacted provider identifiers may be committed.

## Existing reusable Moss evidence

| Entry | Truthfulness | Source |
| --- | --- | --- |
| Moss live success | real | `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` |
| Moss integration error | mock/rule input | `fixtures/chain-evidence/kuru/integration-error/` |
| Moss missing evidence | mock/rule input | `fixtures/chain-evidence/kuru/missing-evidence/` |
| Moss no route | inspect per-entry metadata before use | `fixtures/chain-evidence/kuru/no-route/` |
| Moss reverted | mock/rule input (`real=false`) | `fixtures/chain-evidence/kuru/reverted/` |

The BE-011 capability manifest is `manifest.json`.

Tenderly and Native RPC real-response entries remain pending until safe credentialed/read-only probes are available.

