# Current Agent Handoff

Checkpoint: 2026-09-29

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

`811e2b80fd6d6db6ccee5da6f4a518a6b66ba6c7`

This is historical checkpoint truth, not a permanent equality requirement.

GitHub Issue #96 is the canonical Final Sprint execution tracker. Linked GitHub Issues are
implementation/acceptance records; `docs/context/*` is the durable handoff; Notion is supporting
planning/reference material and must not override GitHub or frozen #70 semantics.

This file is a durable snapshot, not a live issue tracker. Always fresh-fetch #96 and the target
Issue/PR before acting; fresh GitHub state wins when it differs from this snapshot.

## Current live execution model

```text
Final Sprint v3

Product P0
#126 MERGED → Product Owner acceptance pending on #73

Asset Coverage
#103 QUALIFIED_REAL + #104 COMPLETE → #105 active end-to-end acceptance

Evidence Federation
#106 + #110 + #91 + #92 = PASS

Verified Remediation
#107 OPEN / NOT COMPLETE / not currently reachable under frozen semantics
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

#101 exact binding is CLOSED / COMPLETED through merged PR #113. #100 and #102 have complete
Backend scope but remain open pending explicit Product acceptance of the merged #126 path.

Merged PR #126 contains the real browser path and observed `eth_call=SUCCEEDED`,
`gasEstimate=AVAILABLE`, Provider `UNKNOWN`, execution `SUCCESS`, Evidence `INCOMPLETE`, Risk
`UNKNOWN`, persisted recovery, and a distinct child re-check. It is implementation evidence, not
Product Owner acceptance; refer to live #73 for the final decision.

The earlier #67 controlled WETH → test-USDC target remains historical accepted evidence.
Do not erase or rewrite it, but do not use it to override the current #96/#73 final Product P0
acceptance path.

## Provider owner state

`@jzhao0` has these relevant issues:

- #103 — real USDC → WETH qualification is `QUALIFIED_REAL` through PR #127;
- #106 — CLOSED / COMPLETED provider-neutral `TraceRpcEvidenceSource`;
- #110 — CLOSED / COMPLETED Backend supplementary integration;
- #91 — CLOSED / COMPLETED same-transaction Native vs Trace portability;
- #108 — optional/stretch draft PR #120 Explorer feasibility;
- #109 — optional/stretch additional-asset feasibility.

## Evidence Federation boundary (complete)

PR #112 delivered only the reusable supplementary Trace Evidence source.

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

Backend integration is complete through #110. Do not reopen this lane without a new concrete
defect; Native RPC remains primary and Trace remains supplementary.

## Coordination

#110, #91, and #92 are complete. Asset Coverage acceptance is #103 `QUALIFIED_REAL` + #104
support + #105 end-to-end acceptance, but this is not a mandatory serial engineering order:
#73 does not block #105 implementation, and #103 qualification does not block deterministic
#105 work. #105 remains the active Asset Coverage lane. #107 is a separate NOT COMPLETE gate;
#94 is SHOULD; #90/#108/#109 are optional and outside the critical path.

#110 owns Backend composition, exact context binding, persistence, public projection, and
historical consistency. The current implementation evaluates Trace after the primary Provider,
keeps supplementary Evidence out of Core/Decision/Risk, and projects only normalized allowlisted
facts into the public RunResult. It does not block Product P0. Native RPC remains primary; Trace
is supplementary. No ProviderRegistry rewrite, ranking, scoring, voting, consensus, or fallback.

Generic gas estimation is preflight; the pinned NativeRpcProvider gas check is execution Evidence.
`INSUFFICIENT_NATIVE_BALANCE` is an execution-readiness fact, not a Risk verdict or economic
Cause. Risk remains independent, and partial `call=SUCCEEDED` / `gas=UNAVAILABLE` remains
incomplete Evidence / `UNKNOWN`.

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

## Historical 2026-09-28 implementation handoff

- Current merged `main`: `f8cc7beb4f899e0b8283e1e30a67814a4989c73e` (PR #118, with #112 in history).
- Current branch: `feat/backend-fs-d-trace-integration`.
- This feature branch is not yet synchronized onto the newer merged `main`; before merge, reconcile
  current `main` and rerun exact-head CI/review as required by the merge gate.
- PR-FS-D / #110 now has a Backend-local supplementary evaluator and public projector. The
  qualified Trace source receives the exact prepared unsigned transaction, Run ID, chain,
  protocol, quote, and pinned block context from the same execution that Native evaluates.
- Trace failures preserve Native facts and expose unknown/unavailable scopes. Trace success does
  not alter the existing Risk verdict. POST `/api/check` and GET `/api/runs/:runId` expose the
  same normalized Trace summary without raw RPC payloads or endpoint details, and historical
  reads do not re-query the source. Public failure reasons are allowlisted; invalid diagnostics
  fail closed at the projection boundary. Bootstrap rejects an unconsumable Trace source rather
  than silently dropping it, and Action-Gate verification children explicitly suppress
  supplementary Trace evaluation.
- The follow-up review fix is committed at `cd1793267d4354c21785b878e1f17870e2411418`: Native
  and Trace now share one prepared-transaction fingerprint, the live gate asserts equality, and
  Trace preserves the observed chain scope when pinned-block context fails. Public projection
  validation and regression coverage match the stage-aware scope semantics.
- Validation completed for the implementation and gate: API tests 617/617, repository tests 1308
  passed with 2 skipped, repository typecheck, repository lint, targeted formatting, and
  `git diff --check`; the exact-head live-gate runner also passed Biome and API typecheck.
  The read-only live Backend Trace gate passed from clean implementation commit `cd17932`
  (`cd1793267d4354c21785b878e1f17870e2411418`) with Native primary success, equal Native/Trace
  transaction fingerprints, exact prepared-transaction matching, complete Trace scope, public
  redaction, persisted round-trip, and historical no-requery assertions. The current sanitized
  capture is at
  `fixtures/provider-registry/be-110/backend-trace-integration-20260928133255854/capture.json`.
- The capture records the implementation commit/tree and `origin/main =
  f8cc7beb4f899e0b8283e1e30a67814a4989c73e`. This is current qualification evidence for the
  implementation commit, not a claim that #110 has been merged or accepted; no GitHub review
  mutation has been performed.

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

Do not infer a default implementation target from this historical note. Fresh GitHub state and
the owning Issue determine the next action.

## 2026-09-28 — #107 verified remediation handoff

`feat/verified-remediation-107` is the Verified Remediation lane branch. It carries a
read-only live feasibility gate plus its blocker record; it changes no production semantics
and claims no gate.

State to carry forward:

- Verified Remediation: `NOT COMPLETE` / `VERIFIED_REMEDIATION_NOT_REACHABLE`.
- The merged mechanism (solver, `verificationBound`, child Runs, `p0.remediation`
  projection) is real but reachable only with a caller-injected `providerEvidenceMapper`,
  i.e. synthetic Evidence. Do not present that as #107 acceptance.
- The live gate is `pnpm --filter @parallax/api probe:verified-remediation`; its sanitized
  capture is under `fixtures/provider-registry/be-107/`.
- Exact blocker detail and the four owner decisions that would unblock the gate are in
  [verified-remediation-107-blocker.md](../integration/verified-remediation-107-blocker.md).

Do not resolve this blocker by weakening `backendEvidenceState`, reclassifying a partial
Native RPC surface as `SUCCESS`, mapping `UNKNOWN` to `VERIFIED`, or deriving
`simulated_token_out` from an unqualified trace state diff. Each is a Product/Contract/
Provider semantic decision owned outside this branch.
