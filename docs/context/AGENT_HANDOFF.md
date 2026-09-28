# Current Agent Handoff

Checkpoint: 2026-09-28

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

`b6d48c5f2223d1888231a5eb7810ec2a04006111`

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
#103 qualification + #104 completed → #105

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

- #106 — CLOSED / COMPLETED by merged PR #112, historical PR head `dc84dd3`;
- #110 — Backend supplementary integration after the minimum #106 interface is agreed;
- #91 — follows #106/#110 for same-transaction Native vs Trace portability;
- #103 — first bounded attempt is NOT COMPLETE due real sender USDC balance and router allowance
  both zero; it remains independent of #73;
- #108 — Explorer feasibility, optional/stretch, not active;
- #109 — additional asset feasibility, optional/stretch, not active.

## #106 completed execution boundary

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

#110 may consume the qualified #106 source; its own Backend integration and acceptance remain
separate.

#91 is the portability proof after the reusable source/integration exists.

#92 is the Frontend capability/provenance consumer.

#103 must not be promoted into production support before its bounded real-chain qualification.
#73 remains an independent Product P0 acceptance gate, not a development prerequisite for
#103/#105/#107 under Kai's 2026-09-28 clarification. #73 OPEN does not mean Product P0 PASS.

Current parallel handoff is Clare on #100/#102 and Antony on #73; #101 is complete through
PR #113. #103 feasibility may run in parallel with #73 acceptance. #104 is complete; #105
remains blocked until #103 qualification PASS. #106 is complete; #110 → #91 → #92 continue
the Evidence Federation lane. #107 development may proceed independently but requires its
own real VERIFIED acceptance. #94 Minimal SDK remains a SHOULD. Optional #90/#108/#109 work
remains outside the critical path.

The Asset Coverage order is #103 qualification PASS plus completed #104 → #105. #103 has a
four-hour feasibility kill switch; #105 is the Asset Coverage PASS proof. #73 is separately
accepted for Product P0 and does not determine #103 feasibility.

#110 owns Backend composition, exact context binding, persistence, public projection, and
historical consistency. It does not block Product P0. Native RPC remains primary; Trace is
supplementary. No ProviderRegistry rewrite, ranking, scoring, voting, consensus, or fallback.

#107 is the separate Verified Remediation gate. Its ownership is Backend child Run
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

For this Provider workspace, use the verified local Git identity:

`jzhao0 <181855088+jzhao0@users.noreply.github.com>`.

Every write must pass `./scripts/agent-preflight.sh --write`. Do not reuse the historical
incorrect identity.

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

For Provider work, draft PR #116 on `feat/usdc-weth-camelot-feasibility` records the first
bounded #103 attempt from `b6d48c5f2223d1888231a5eb7810ec2a04006111`.
Capture `fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-28T11-39-14-324Z/capture.json`
is `BLOCKED_ACCOUNT_STATE`, not qualification PASS. The selected public sender's USDC balance
and router allowance were both zero at the pinned block; quote and unsigned construction passed,
but `eth_call` and `eth_estimateGas` failed. Keep #103 OPEN / NOT COMPLETE, Asset Coverage NOT
COMPLETE, and #105 blocked. A new real sufficient account context would require a fresh pinned
qualification. No separate context PR is needed.
