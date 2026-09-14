# BE-033 Moss Provider Handoff Fixtures

This directory is an **index and reproducibility note**, not a second Provider result model and not a new fixture store.

It exists so Backend Owner can discover the deterministic Moss evidence set, load it offline, and see exactly which cases are real, mock/rule, replay, or unavailable — without a Moss runtime, an RPC endpoint, a network connection, or a secret.

- Machine-readable index: `fixture-index.json` (`schemaVersion: be-033-moss-handoff-v1`).
- Narrative handoff: `docs/research/be-033-moss-provider-handoff.md`.
- Field mapping: `docs/research/be-033-moss-field-mapping.md`.
- Cross-Provider baseline (unchanged, still authoritative): `fixtures/provider-registry/be-011/manifest.json`.

The BE-033 schema deliberately reuses the BE-011 fixture-index convention (`id`/observation identity, `real`, `sourcePath` or `null`, `evidenceClass`, chain/protocol, and a truthful note). It adds Moss-specific capture/runtime/block context, `proves`/`doesNotProve`, and expected control states. It does **not** replace the BE-011 manifest.

## Truthfulness rules

- `real: true` means the referenced source was captured from a real runtime/provider interaction and sanitized. Only three entries are `real: true`, all real Moss/Kuru recordings: `moss-live-success-mon-to-usdc`, `moss-recorded-mon-to-usdc`, `moss-recorded-usdc-to-mon`.
- `real: false` means deterministic mock/rule/replay/unavailable evidence only. It is never promoted.
- `evidenceClass: "UNAVAILABLE"` always has `real: false` and `sourcePath: null`. No fabricated Provider JSON is committed to "complete" the index.
- The `fixtures/chain-evidence/kuru/reverted/` entry is a revert **rule input** (`fixtureType: RULE_TEST_INPUT`, `source: "mock"`). It does not prove any real Moss revert response.
- The absence of real failure/timeout/outage/auth/rate-limit/malformed/partial/stale/config samples is a factual result, not an omission to be fixed by invention.
- No API keys, RPC secret URLs, private keys, cookies, access tokens, endpoint values, or operator runtime paths may be committed.

## Canonical existing fixture paths

| Case | Path | Truthfulness |
| --- | --- | --- |
| Moss live success (canonical) | `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` | real, immutable historical observation |
| Moss recorded MON → USDC | `fixtures/chain-evidence/kuru/mon-to-usdc/` | real, historical (older baseline) |
| Moss recorded USDC → MON | `fixtures/chain-evidence/kuru/usdc-to-mon/` | real, historical (older baseline) |
| Moss revert rule input | `fixtures/chain-evidence/kuru/reverted/` | mock/rule input (`real: false`) |
| Moss integration-error rule input | `fixtures/chain-evidence/kuru/integration-error/` | mock/rule input |
| Moss missing-evidence rule input | `fixtures/chain-evidence/kuru/missing-evidence/` | mock/rule input |
| Moss no-route rule input | `fixtures/chain-evidence/kuru/no-route/` | mock/rule input |
| Replay envelopes | `fixtures/replay-data/mon-to-usdc.json`, `fixtures/replay-data/usdc-to-mon.json` | recorded-replay contract input, not live Provider evidence |

The live success capture metadata is authoritative for the real values: run `kuru-live-1786163979273`, window `2026-08-08T04:39:39.273Z`–`2026-08-08T04:39:49.599Z`, Parallax commit `938f62fe5c872626f5cfa2f0a58c975d53e4a8de`, Moss runtime `0.1.0` / `ef15448e166f31c891e80dba5073dae04a052a2b`, chain `143`, stage block `94112883`, quote/action block `94112901`, simulator pinned block `94112902`. No block hash is recorded.

## Deterministic offline loading

Load fixtures directly from the repository. Do not call a Provider, RPC, or the network.

```ts
import { readFileSync } from "node:fs";

const metadata = JSON.parse(
  readFileSync(
    new URL(
      "../../../../fixtures/chain-evidence/kuru/live-success-mon-to-usdc/metadata.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
```

Both existing consumers show the pattern: `packages/moss-bridge/test/normalize.test.ts` (recorded normalization) and `packages/moss-bridge/test/live-kuru.test.ts` (live adapter over recorded raw input). A test that validates this index loads `fixture-index.json` the same way.

Requirements for deterministic tests:

- **No secrets.** No API key, token, cookie, private key, or private RPC URL is needed or permitted.
- **No external Moss runtime.** `MOSS_RUNTIME_PATH` is required only by the opt-in live smoke (`pnpm smoke:kuru:live`), never by the default suite.
- **No network.** The default `pnpm test` run excludes `*.integration.test.ts`; nothing here adds a network dependency.
- **No mutation.** Tests read fixtures; they never rewrite them.

## Immutability and no silent overwrite

- The real captured fixtures are **immutable historical observations**. Do not regenerate them in place, "correct" their values, or retrofit newer provenance.
- The live smoke writes staging artifacts to the gitignored `.smoke-live/` directory first and promotes the formal fixture only after the 24-gate acceptance passes. The guarded Native RPC probe (BE-011) similarly writes a unique timestamped directory and fails rather than overwrite.
- If a newer Moss capture is ever needed, create a **new uniquely named directory** and index it as a separate entry with its own capture metadata. Do not replace the canonical path.
- `fixtures/chain-evidence/kuru/mon-to-usdc/` and `usdc-to-mon/` are retained as historical recordings and are **not** the canonical runtime-qualified capture.

## Why unavailable evidence is represented explicitly

An `UNAVAILABLE` entry with `sourcePath: null` is a truthful statement: "this case was not observed, and it must be handled fail-closed by the control-state mapping until real evidence exists." Fabricating a response would corrupt every downstream capability, control-state, and freshness claim, so the index records the gap instead.

## Validation

`packages/moss-bridge/test/be-033-fixture-index.test.ts` validates this file deterministically:

- parses it with the platform JSON parser;
- verifies every non-null `sourcePath` exists;
- verifies ids are unique;
- verifies `real: true` entries have a `sourcePath` and an evidence class that denotes a real observation;
- verifies `UNAVAILABLE` entries have `real: false` and `sourcePath: null`;
- verifies every `evidenceClass` is declared in the index schema;
- verifies all `providerId` values match the Moss provider identity and that `noNewLiveProbe.run` is `false`.
