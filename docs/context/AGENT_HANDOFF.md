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

`542d5c685d259b5ee6d5aa55098bb2dad900f230`

This is historical checkpoint truth, not a permanent equality requirement.

GitHub Issue #96 is the canonical Final Sprint execution tracker. Linked GitHub Issues are
implementation/acceptance records; `docs/context/*` is the durable handoff; Notion is supporting
planning/reference material and must not override GitHub or frozen #70 semantics.

## Current live execution model

```text
Final Sprint v3

Product P0
#100 + #102
        +
       #73

Asset Coverage
#103 → #104 → #105

Evidence Federation
#98 → #106 → #110 → #91 → #92

Verified Remediation
#107
```

The four gates are independently reportable. Full Best Case requires all four:

```text
Product P0 PASS
+ Asset Coverage PASS
+ Evidence Federation PASS
+ Verified Remediation PASS
```

Optional work must not become a blocker. A kill switch stops investment; it does not lower
acceptance retroactively.

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
→ truthful checked / unknown
→ persisted Run / getRun
→ re-check
```

P0 does not require successful `VERIFIED` remediation. A truthful `UNKNOWN` / `INCOMPLETE`
result with remediation `NOT_RUN` / `UNVERIFIED` / `UNKNOWN` and child verification
`unknown` / `unavailable` is valid when required Evidence is unavailable.

#101 exact binding is CLOSED / COMPLETED through merged PR #113. #100 and #102 remain open for
their explicit application-entrypoint and historical-replay acceptance evidence.

The earlier #67 controlled WETH → test-USDC target remains historical accepted evidence.
Do not erase or rewrite it, but do not use it to override the current #96/#73 final Product P0
acceptance path.

## Provider owner state

`@jzhao0` has these relevant issues:

- #106 — active next task: productionize provider-neutral `TraceRpcEvidenceSource`;
- #110 — Backend supplementary integration after the minimum #106 interface is agreed;
- #91 — follows #106/#110 for same-transaction Native vs Trace portability;
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

Current parallel handoff is Clare on #100/#102 and Antony on #73; #101 is complete through
PR #113. After Product P0, proceed through #103 → #104 → #105 for Asset Coverage and
#106 → #110 → #91 → #92 for Evidence Federation, then #107 Verified Remediation and #94
Minimal SDK as a SHOULD. Optional #90/#108/#109 work remains outside the critical path.

The Asset Coverage order is #73 → #103 → #104 → #105. #103 has a four-hour feasibility
kill switch; #104 is non-blocking for ETH → USDC P0 but enabling MUST for ERC-20 reverse support;
#105 is the Asset Coverage PASS proof.

#110 owns Backend composition, exact context binding, persistence, public projection, and
historical consistency. It does not block Product P0. Native RPC remains primary; Trace is
supplementary. No ProviderRegistry rewrite, ranking, scoring, voting, consensus, or fallback.

After P0, #107 is the separate Verified Remediation gate. Its ownership is Backend child Run
and re-check (`@brightheartma`), Provider/Risk Evidence boundary (`@jzhao0`), Frontend
presentation (`@antony819`), Product acceptance (`@chin0312`), and Contract review only when
canonical representation changes (`@rainypilgrimage`). The Frontend states are
`PROPOSED`, `VERIFIED`, `FAILED`, `UNKNOWN`, and `UNAVAILABLE`.

#94 Minimal SDK is `BEST CASE SHOULD`, after the four gates. #90, #108, and #109 are bounded
optional/stretch work. #93 and #95 are CLOSED / NOT_PLANNED Final Sprint cuts.

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

`brightheartma <brightheartma@gmail.com>`

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
