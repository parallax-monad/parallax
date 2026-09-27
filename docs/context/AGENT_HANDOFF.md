# Current Agent Handoff

Checkpoint: 2026-09-27

## Takeover

1. Run `./scripts/agent-preflight.sh --read`.
2. Fresh-fetch GitHub and validate `checkpoint_head` ancestry.
3. Read `AGENTS.md`, `PROJECT_STATE.md`, `DECISION_LOG.md`, this file, `RUNBOOK.md`, and
   the live Issues named below.
4. Treat Issue #96 Final Sprint v3 as the current Product execution tracker.
5. Do not fall back to the older pre-v3 interpretation that #96 is merely dormant Strong/P1.
6. Preserve frozen #70 semantics and the unsigned/read-only boundary.
7. Run `./scripts/agent-preflight.sh --write` before every mutation sequence.

## Expected main checkpoint

`c4eb2f23b1c41cc4974fdec4d68491cc965e101a`

This is historical checkpoint truth, not a permanent equality requirement.

## Current live execution model

```text
Final Sprint v3

Product P0
#100 + #101 + #102
        +
       #73

Asset Coverage
#103 → #104 → #105

Evidence Federation
#98 → #106 → #110 → #91 → #92

Verified Remediation
#107
```

The four gates are independent acceptance items. Optional work must not become a blocker.

## Product P0

Current accepted Product execution target in #96/#73:

```text
Arbitrum Sepolia
→ Camelot V3
→ ETH → USDC
→ real quote
→ exact prepared unsigned transaction
→ Native RPC
→ basicSimulation
→ persisted Run / getRun
→ re-check
```

The earlier #67 controlled WETH → test-USDC target remains historical accepted evidence.
Do not erase or rewrite it, but do not use it to override the current #96/#73 final Product P0
acceptance path.

## Provider owner state

`@jzhao0` has these relevant issues:

- #106 — active next task: productionize provider-neutral `TraceRpcEvidenceSource`;
- #91 — follows #106 and the integrated same-transaction Trace path;
- #103 — real USDC → WETH feasibility, gated by Product P0 #73;
- #108 — Explorer feasibility, optional/stretch, not active;
- #109 — additional asset feasibility, optional/stretch, not active.

## #106 execution boundary

Build only the reusable supplementary Trace Evidence source.

Required:

- exact prepared transaction binding;
- run / fingerprint / chain / protocol / block-context binding;
- `callTracer` and `prestateTracer(diffMode=true)` only where actually qualified;
- checked / unknown / unavailable capabilities;
- provenance and freshness/block identity;
- fail-closed malformed/unsupported handling;
- provider-neutral output outside the adapter boundary.

Do not:

- create a QuickNode product abstraction;
- replace Native RPC as primary baseline;
- add provider ranking/scoring/voting/consensus/fallback;
- modify frozen Risk/Product semantics;
- sign, broadcast, or custody transactions.

Backend integration belongs to #110.

## Coordination

#110 may prepare against the minimum agreed #106 interface, but its real acceptance must use
the qualified #106 source.

#91 is the portability proof after the reusable source/integration exists.

#92 is the Frontend capability/provenance consumer.

#103 must not be promoted into production support before its bounded real-chain qualification
and must not start before #73's prerequisite stage.

## Review discipline

```text
smallest useful slice
→ owner self-review
→ one blocker scan at actual shared boundaries
→ fix P0/P1 correctness/security
→ CI green
→ merge
→ fix forward
```

Request cross-owner review only where normalized shared Evidence, Backend integration,
Product presentation, or frozen semantics actually cross boundaries.

## Historical integrity / identity note

A prior #69 incident was caused by repository-local Git identity
`jie <jie@users.noreply.github.com>`, which GitHub mapped to an unrelated `@jie` account.

The affected history was integrity-reviewed and repaired; no evidence supported outsider code
tampering. Full details remain in `docs/context/MUTATION_LEDGER.md`.

Current agent-assisted writes must continue to use the expected local identity:

`jzhao0 <181855088+jzhao0@users.noreply.github.com>`

and must pass `./scripts/agent-preflight.sh --write`. Do not reuse the historical incorrect
identity.

## Context-overflow recovery

If context is lost, ignore chat summaries until this sequence is complete:

```text
preflight --read
→ AGENTS.md
→ PROJECT_STATE.md
→ DECISION_LOG.md
→ AGENT_HANDOFF.md
→ #96
→ target issue
→ fresh PR/review/CI state
```

For Provider work, default target after this checkpoint is #106 unless live GitHub state
has superseded it.
