# Backend P0 Acceptance Matrix

Status: DELIVERY GATE FOR DETERMINISTIC CHECK APPLICATION / RUN LIFECYCLE PATHS — LIVE SIMULATION SUCCEEDED ON THE TEMPORARY MOSS PIN; EVIDENCE REGENERATED ON NODE v22.23.2

Owner: Clare (backend / `apps/api`)
Command: `pnpm test:acceptance`

This is the delivery-facing backend acceptance entry. It does not replace unit
tests. It organizes the P0 Check Application / Run lifecycle claims that backend
can prove without a frontend owner. A real live Kuru MON → USDC simulation has
succeeded on the temporary Moss pin ef15448e (fixture
`fixtures/chain-evidence/kuru/live-success-mon-to-usdc/`); see
[moss-kuru-live-runtime.md](./moss-kuru-live-runtime.md).

## Scope

In scope:

- Check Application outcomes backing `POST /api/check`
- Integration Error classification and retryability
- Live vs Replay provenance separation
- Re-run single-condition and Child Run failure preservation
- Fail-closed unverified `ADJUST`
- Verified `ADJUST` via fixture Action Gate (`amountIn` only)

Out of scope for this gate:

- Frontend Analyze UI and CTA routing
- Live Kuru MON → USDC evidence regeneration under Node v22.23.2
  (`pnpm smoke:kuru:live`)
- Database, SSE, Queue, signing, or PancakeSwap
- Full TV-ECO-006 / §3.3.1 `ACTION_GATE` / CrossRun locator Shared Contract
  expansion (this gate's verified `ADJUST` path uses interim
  `action_verification` Evidence only)

## Matrix

This gate asserts the Check Application boundary with deterministic stubs. It
does not execute Moss `discover → load → action → simulate`, and it does not
claim recorded-fixture or live SUCCESS coverage. Rows below match
`p0-acceptance.test.ts` one-to-one; do not read more into a row than its
Expected public outcome column. Public outcomes may surface under transport-level
`body.error` or Run-level `body` / `body.run.error`; see Frontend consumer notes.

| ID | Criterion | Expected public outcome | Acceptance test | Deeper coverage |
| --- | --- | --- | --- | --- |
| A1 | `PROCEED` | Completed Run, `verdict = PROCEED`, stored | `p0-acceptance` A1 | `agent-flow` live Evidence → PROCEED |
| A2 | `STOP` | Completed Run, `verdict = STOP` (unattested ADJUST fail-closed only) | `p0-acceptance` A2 | `agent-flow` NO_ROUTE → STOP |
| A14 | `ADJUST` | Completed Run, `verdict = ADJUST` with verified `recommendedActions` (fixture Action Gate) | `p0-acceptance` A14 | `application` fixture Action Gate using interim Shared Contract `action_verification`; full TV-ECO-006 / `ACTION_GATE` contract deferred |
| A3 | `UNKNOWN` | Completed Run, `verdict = UNKNOWN` | `p0-acceptance` A3 | recorded Replay fixtures |
| A4 | Integration Error | Response body `status = integration_error`, `verdict = UNKNOWN` (store record may be `completed` when the error Run was stored successfully) | `p0-acceptance` A4 | moss-bridge / agent-flow |
| A5 | Stage evidence preserved | `QUOTE` / `ACTION` / `SIMULATE` Evidence stages round-trip through Check Application | `p0-acceptance` A5 | `agent-flow`, moss-bridge live adapter for real stage execution |
| A6 | Timeout | `error.code = TIMEOUT`, `retryable = true` | `p0-acceptance` A6 | moss-bridge errors |
| A7 | RPC unavailable | `error.code = RPC_UNAVAILABLE`, `retryable = true` | `p0-acceptance` A7 | agent-flow RPC mapping |
| A8 | Moss unavailable | `error.code = MOSS_UNAVAILABLE`, `error.stage = unknown`, `retryable = true` | `p0-acceptance` A8 | agent-flow Moss mapping; public `error.stage` mapping for non-QUOTE/ACTION/SIMULATE stages is unresolved |
| A9 | Unsupported live runtime | `error.code = UNSUPPORTED`, `retryable = false` | `p0-acceptance` A9 | bootstrap / server integration |
| A10 | Provenance | deterministic gate requires and preserves simulator pinned-block fields | `p0-acceptance` A10 | agent-flow provenance fail-closed |
| A11 | Replay / Live separation | run-level Replay rejection: Replay Run cannot be a Re-run baseline; live Agent Flow cannot return `replayMode` | `p0-acceptance` A11 | `application/replay` |
| A12 | Re-run one condition | Multi-field Intent change rejected as `INVALID_RERUN` with `reason: NOT_EXACTLY_ONE_CHANGE` | `p0-acceptance` A12 | `application/rerun` |
| A13 | Child Run failure | Failed child still keeps `parentRunId` and `diff` with atomic `amountInAtomic` before/after | `p0-acceptance` A13 | API application Re-run tests |

## Frontend consumer notes

Recorded from API-consumption review; not additional gate rows.

1. **Two Integration Error envelopes.** A4 returns HTTP 200 with
   `body.status = integration_error`. A6–A9 return HTTP 502 with nested
   `body.run` plus top-level `body.error`. Unification is out of scope for this
   gate; frontend Analyze must branch on both shapes.
2. **Two error-code namespaces.** Run integration errors use
   `integrationErrorSchema.code` (`TIMEOUT`, `MOSS_UNAVAILABLE`, … on the Run).
   Transport/application failures use top-level `body.error.code`
   (`INVALID_RERUN`, `INVALID_AGENT_FLOW_RESPONSE`, …). A10/A11 enforce
   provenance via transport-level `INVALID_AGENT_FLOW_RESPONSE`, not a Run
   integration code.
3. **`error.stage` is not yet a reliable diagnostic.** A8 pins LOAD-stage Moss
   failure to `stage: "unknown"`. Do not surface stage as the primary
   user-facing failure cause until Contracts expands the enum.
4. **Re-run Diff values are atomic.** A13 pins `amountInAtomic` before/after as
   atomic strings; display-unit formatting is frontend work.

## How to run

```bash
pnpm test:acceptance
```

Companion commands (not part of this gate):

```bash
pnpm test                 # full deterministic suite
pnpm test:integration     # real Node listener
pnpm smoke:kuru:live      # live Moss/RPC; success not claimed here
```

## Live SUCCESS note

`pnpm smoke:kuru:live` remains the live path. A real Monad mainnet Kuru MON →
USDC live simulation **succeeded** on the temporary Parallax fork pin
`ef15448e`: FlipOrderUpdated and Trade were observed and parsed, warnings were
empty, pinned-block provenance was proven end-to-end
(`simulatorPinnedBlock=94112902`), and the 24-gate acceptance passed
(`liveSuccess=true`, `P0_LIVE_READY`). The historical "FlipOrderUpdated
unsupported" blocker is closed **for this exact pin only**.

Merge state: the committed fixture was **regenerated under Node v22.23.2** by
a real live smoke (2026-08-08, runId `kuru-live-1786163979273`), resolving the
Node drift against the runtime contract pin. Failures and configuration
artifacts under `.smoke-live/` remain diagnostic, not delivery success
evidence.
