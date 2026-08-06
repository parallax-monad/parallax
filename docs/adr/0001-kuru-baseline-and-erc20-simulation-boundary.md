# Kuru baseline and ERC-20 simulation boundary

## Context

Parallax needs a reproducible, pre-signing evidence boundary for Monad Kuru swaps. The first recorded evidence was produced against Moss commit `d09b38cbc44ee7f5722c5d09e7224f7750187762`.

## Verified facts

- Kuru supports both MON to USDC and USDC to MON capability discovery, quote, and action construction in the recorded baseline.
- MON input has no ERC-20 approval action. USDC input constructs an exact-amount approval action before the swap action.
- The recorded simulator synthetic-prefunds native MON only. It does not establish ERC-20 balance, allowance, or wallet affordability.
- Moss stable main is `2e7c1db` at review time. Its published `0.1.0` packages do not match the recorded Capability and Receipt API baseline.
- Moss PR #109 adds initial `stateOverrides`; it is not merged. Moss PR #138 handles `FlipOrderUpdated`; it is not merged.

## Current Moss baseline

The stable published packages are not a safe runtime dependency for this baseline. The backend now selects the live Agent Flow when a pinned Moss checkout is configured; the adapter validates that checkout and fails closed when the runtime cannot provide all required provenance. Recorded raw evidence, normalization, replay, and deterministic rules remain independent of live runtime availability.

## MON to USDC status

Recorded at block `91383505`: quote and action were constructed, but receipt parsing encountered `FlipOrderUpdated`. The result is `UNKNOWN`, not a protocol-risk verdict.

## USDC to MON status

Recorded at block `91383528`: capability, quote, action, and exact approval construction succeeded. The simulator halted on a generic revert, so coverage is incomplete and execution remains `UNKNOWN`. The root cause is unproven; no balance-insufficiency claim is made.

## Initial ERC-20 state problem

ERC-20 simulation needs balance and allowance state in addition to native gas/value. Synthetic state can show execution under supplied preconditions, but cannot prove that a real wallet can pay.

## Solution matrix

| Option | Technical confidence | Stability | Mainnet fidelity | Real funds | Private key | Effort | P0 treatment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Public holder | PARTIALLY VERIFIED | Low | High | Existing holder balance | No | Low | Not a stable demo |
| Controlled funded sender | PARTIALLY VERIFIED | Medium | High | Yes | No for simulation | Medium | Follow-up gate |
| Initial state overrides | PARTIALLY VERIFIED | Low | Synthetic | No | No | Medium | Do not depend on unmerged work |
| Mainnet fork injection | NOT TESTED | Medium | Medium | No | No | High | Research only |
| Chained self-funding | PARTIALLY VERIFIED | Medium | High | Initial MON only | No | Medium | Preferred next experiment |

## Security and trust boundaries

No private key, signing, broadcast, custody, or wallet mutation is used. Replay retains evidence source and marks replay mode. Synthetic state never proves live wallet affordability.

`PROCEED` means no blocking evidence was found within the checked scope. It does not mean the transaction, token, protocol, or future outcome is safe.

## P0 decision

Use MON to USDC as the recorded baseline. Preserve USDC to MON bidirectional construction evidence, but do not promise complete USDC simulation. Do not rely on random third-party holders or unmerged overrides for P0.

## Follow-up gates

1. Verify chained self-funding with a receipt parser that accepts `FlipOrderUpdated`.
2. Or verify a team-approved public sender's balance and allowance read-only.
3. Re-evaluate a released Moss API once state overrides and receipt support are stable.

## Evidence and reproduction commands

`pnpm test` replays recorded evidence. `pnpm test:acceptance` is the
delivery-facing backend P0 acceptance gate for deterministic API / Run
lifecycle claims. `pnpm smoke:kuru:live` is the live path; it requires all
Moss/RPC inputs, exercises the real POST `/api/check` boundary, and fails
closed when acceptance is incomplete. It must not be represented as a live
smoke success until the full gate passes.

## Delivery stages

| Stage | Inputs | Deliverables | Dependencies | Acceptance | Blockers | Workload | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Recorded evidence | This pipeline, fixtures, rules, ADR, draft PR | Review | Merge-ready after review | Portable Moss dependency | Completed | PARTIALLY VERIFIED |
| 2 | Team contracts | Frozen evidence and reason-action contract | Clare and Rei | One reviewed interface | Shared schema decision | Small | OPEN |
| 3 | Sender or chained state | Bidirectional simulation gate | Receipt support and state evidence | Reproducible USDC path | ERC-20 prestate | Medium | OPEN |
| 4 | Vertical slice | Intent to verdict re-run flow | API and web owners | Before/after evidence view | Cross-module integration | Medium | OPEN |

## Re-verification (2026-08-03)

Both old claims were re-checked against the live remotes and are confirmed:

- Published `@themoss/*@0.1.0` uses a Plan-based API (`plan`/`finalizePlan`/
  `computePlanHash`/`Event`) that does not match the recorded Capability/Receipt
  baseline. It is not a usable runtime for this adapter.
- Moss PR #138 (`55f7ad9` + `d3b1695`) handles `FlipOrderUpdated`, but it is
  still not merged into `upstream/main` (`2e7c1db`) and not published.

The pinned runtime is now the local fork `main` commit
`d09b38cbc44ee7f5722c5d09e7224f7750187762` (exact `@themoss/*@0.1.0`
workspace, reproducible via frozen lockfile under Node 22 / pnpm 11.10.0).
The repository currently has no configured Moss/RPC environment, so its
verified status remains `P0_LIVE_BLOCKED_PORTABLE_RUNTIME`; when the runtime is
configured, `FlipOrderUpdated` is expected to block the simulation/receipt path
on this revision. Details, the runtime matrix, and the raw→normalized mapping live in
[docs/integration/moss-kuru-live-runtime.md](moss-kuru-live-runtime.md).
`pnpm smoke:kuru:live` replaces the previous unconditional `UNAVAILABLE` smoke:
it is a real live smoke that fails with a persisted configuration artifact until
all required Moss/RPC inputs are configured, and fails non-zero if a live run
does not pass acceptance.

### Provenance boundaries (2026-08-04)

Runtime, RPC, and block provenance carry three distinct trust levels and must
not be conflated:

1. **Smoke execution environment inputs** — the smoke harness receives
   `MOSS_RUNTIME_PATH`, `MOSS_RUNTIME_VERSION`, and `MOSS_RUNTIME_REVISION`
   from the operator. The adapter independently checks the checkout Git
   revision and every loaded `@themoss/*` package manifest.
2. **Adapter-verified runtime provenance** — `runKuruLiveSwap` fails closed
   when the checkout revision or package versions disagree with the configured
   runtime identity, then records the verified identity as provenance.
3. **RPC-observed chain and stage blocks** — `chainId` is read from the RPC
   client and passed to Agent Flow, which enforces Chain ID 143. Each stage
   block is observed through RPC before the stage call. Agent Flow and the live
   acceptance gate additionally require an explicit, valid
   `simulatorPinnedBlock`; an observed stage block is not a substitute for the
   Moss simulator's internally pinned block (Moss ADR 0002).

The current pinned d09b runtime does not expose `simulatorPinnedBlock`, so it
cannot produce an authoritative production Agent Flow result until that runtime
surface is added or a runtime revision exposing it is approved. A consumer must
still independently verify any stronger deployment or production-readiness
claim.
