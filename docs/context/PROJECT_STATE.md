# Project State

Last checkpoint: 2026-09-28

## Main checkpoint

`checkpoint_head = b6d48c5f2223d1888231a5eb7810ec2a04006111`

This is the verified `main` tip at this checkpoint. Future takeovers must fresh-fetch and
verify that this checkpoint is an ancestor of current `main`; equality is not required.

At checkpoint time:

- current `main` includes merged PR #112 at `b6d48c5f2223d1888231a5eb7810ec2a04006111`;
- #106 is CLOSED / COMPLETED by PR #112, with the accepted qualification capture retained
  under `fixtures/provider-registry/be-106/`;
- #101 is CLOSED / COMPLETED by PR #113; #100 and #102 remain open for their explicit
  application-entrypoint and historical-replay acceptance evidence;
- PR-FS-D / #110 is implemented through exact-head commit
  `93a1084c0cfc5a741e8c6d4251290ef86ed6f605` on `feat/backend-fs-d-trace-integration`; it is
  not yet merged or accepted;
- live Product execution scope is represented by Issues #73, #96, and #100–#110.

## Final Sprint v3 control-plane transition

Issue #96, authored and owned by Product Owner `@chin0312`, is now the authoritative
Final Sprint execution tracker. It supersedes the earlier operational description of #96
as a Strong/P1 tracker that remained dormant until #73.

The Final Sprint contains four independent gates:

1. Product P0;
2. Asset Coverage;
3. Evidence Federation;
4. Verified Remediation.

Minimal SDK is SHOULD. Explorer, Asset 3, and Arbitrum One remain optional/stretch work.

This transition changes the active execution plan. It does not silently rewrite the frozen
Product/Risk/Contract semantics recorded under #70.

## Source-of-truth hierarchy

- GitHub Issue #96 is the canonical Final Sprint execution tracker.
- The linked GitHub execution Issues are the implementation and acceptance records.
- `docs/context/*` is the durable handoff, recovery, and historical representation.
- Notion pages are supporting planning/reference material only; they must not override the
  live GitHub control plane or frozen repository semantics.
- Issue #70 remains authoritative for the frozen Product/Risk/Contract semantic domain.

Full Best Case is an explicit conjunction, not a single generic status:

```text
Full Best Case PASS
= Product P0 PASS
+ Asset Coverage PASS
+ Evidence Federation PASS
+ Verified Remediation PASS
```

Each gate is independently reportable. A kill switch stops engineering investment; it does
not retroactively lower the acceptance standard.

## Frozen semantic boundaries

Preserve:

- selected quote as Expectation Baseline, not implicit user tolerance;
- `minimumReceived` / `amountOutMinimum` as Transaction Protection, distinct from explicit
  User Economic Constraints;
- separate Observation / Cause / Constraint / Evidence State;
- fail-closed `UNKNOWN` when required Evidence is missing, stale, incomplete, or unverifiable;
- raw Provider payload isolation;
- no signing, broadcasting, custody, or autonomous user transaction execution.

Issue #67 remains a closed historical acceptance/evidence decision. Its earlier controlled
WETH → test-USDC target is not rewritten or falsified. For the current Final Sprint's final
Product P0 acceptance, Issues #96 and #73 define the active user-facing path as ETH → USDC.

## Product P0 — active

Authoritative Product P0 path:

```text
Arbitrum Sepolia
→ Camelot V3
→ ETH → USDC
→ real quote
→ exact prepared unsigned transaction
→ real Native RPC check
→ basicSimulation
→ truthful checked / unknown
→ persisted Run
→ getRun / recovery
→ re-check path
```

Active acceptance items:

- #73 — Frontend final Product P0 / Demo Gate, owned by `@antony819`;
- #100 — `basicSimulation` and partial Native RPC execution facts, owned by `@brightheartma`;
- #102 — persistence and historical Run semantics, owned by `@brightheartma`.

2026-09-29 local #73 acceptance audit, pending PR review and Product Owner acceptance:
the active browser path reached a real Camelot V3 ETH → USDC quote and a persisted
Arbitrum Sepolia Native RPC Run (`0d5d68d3-01c8-414f-bc10-3023e212cefb`). The UI
recovered that Run after reload and created child re-check Run
`71721898-4b14-4f81-8a93-914d039ec931`. The observed check had `eth_call=SUCCEEDED`,
`gasEstimate=AVAILABLE`, Risk `UNKNOWN`, Evidence `INCOMPLETE`, and remediation
`NOT_RUN`; no Product P0 PASS is inferred from call success. A separate counted-RPC
historical GET on Run `def2b539-e536-48b5-b65e-6f9b709ea14f` made zero RPC
requests. The gas-unavailable partial-evidence branch is regression-tested, not claimed
as a live observation. The local audit supports #100/#102 consumption closure review
after this change is merged; those owner-owned Issues remain open until their owners act.

#101 — exact Intent → prepared transaction → RPC request binding — is CLOSED / COMPLETED by
merged PR #113 for the native ETH → USDC P0 scope. Its reverse ERC-20 extension remains under
#105 and does not reopen #101.

P0 does not require successful VERIFIED remediation. A truthful real Native RPC check may
remain `INCOMPLETE` / `UNKNOWN`, with remediation `NOT_RUN`, `UNVERIFIED`, or `UNKNOWN`, and
child verification `unknown` / `unavailable`.

## Asset Coverage — Best Case gate

Dependency:

```text
#73 Product P0
        ↓
#103 real USDC → WETH feasibility
        ↓
#104 ERC-20 account-state / allowance
        ↓
#105 end-to-end reverse asset flow
```

- #103 is Provider-owned by `@jzhao0` and is a bounded real-chain feasibility task.
- #104 is Backend-owned, non-blocking for Product P0 but enabling MUST for qualified ERC-20
  reverse support.
- #105 composes the qualified reverse path and represents Asset Coverage PASS.

Do not begin production reverse-path integration before #103 qualifies the actual
transaction semantics. #103 itself remains gated by Product P0 #73.

#103 has a focused four-hour feasibility kill switch. If it cannot qualify the real path:

```text
STOP reverse-path investment
Product P0 = retained
Asset Coverage = NOT COMPLETE
Full Best Case = NOT COMPLETE
```

The acceptance standard is not lowered.

## Evidence Federation — active Best Case lane

Native RPC remains the primary baseline.

Trace RPC is supplementary deeper Evidence only:

```text
#98 accepted live trace capability evidence
        ↓
#106 TraceRpcEvidenceSource
        ↓
#110 Backend supplementary integration
        ↓
#91 same-transaction Native RPC vs Trace portability proof
        ↓
#92 capability / provenance Product UX
```

#106 is owned by `@jzhao0`.

`TraceRpcEvidenceSource` must:

- consume the exact prepared unsigned transaction;
- bind run, transaction fingerprint, Intent/chain/protocol, and block context;
- normalize checked / unknown / unavailable capabilities and provenance;
- keep raw QuickNode/RPC structures outside Risk/Core/UI;
- fail closed when trace data is incomplete or unverifiable;
- remain supplementary to Native RPC;
- introduce no provider ranking, voting, scoring, consensus, or automatic fallback.

#106 is CLOSED / COMPLETED by merged PR #112. Its accepted qualification capture is:

`fixtures/provider-registry/be-106/trace-rpc-source-qualification-2026-09-28T10-06-13-121Z/capture.json`

#110 is the Backend consumer, owned by `@brightheartma`, covering composition, exact context
binding, persistence, public projection, and historical consistency. The current PR-FS-D
implementation keeps Trace outside `ProviderRegistry`, Core, Decision, and Risk; Native RPC
remains primary. A read-only live Backend gate now passes against the environment-supplied
Arbitrum endpoint, with sanitized capture retained at
`fixtures/provider-registry/be-110/backend-trace-integration-20260928133255854/capture.json`.
It is not yet a merged Evidence Federation acceptance, and #110 does not block Product P0.

#91 depends on #106 and the integrated same-transaction execution path.

This decomposition does not change the Product architecture. Native RPC remains the primary
execution baseline and Trace remains supplementary. No ProviderRegistry multi-provider rewrite,
voting, consensus, ranking, scoring, or automatic fallback is permitted.

## Verified Remediation — separate Best Case gate

#107 owns one real:

```text
diagnosis
→ quantified remediation
→ child Run
→ real re-check
→ VERIFIED outcome
```

This is intentionally separate from Product P0 and must not weaken Risk thresholds or
convert `UNKNOWN` into `VERIFIED`.

Ownership:

- `@brightheartma` — Backend orchestration, child Run, re-check execution, and public projection;
- `@jzhao0` — Provider/Risk Evidence boundary;
- `@antony819` — Frontend remediation / child-Run presentation and integration;
- `@chin0312` — Product acceptance;
- `@rainypilgrimage` — Contract review only if canonical shared representation changes.

Frontend must distinguish `PROPOSED`, `VERIFIED`, `FAILED`, `UNKNOWN`, and `UNAVAILABLE`.
Antony does not own Risk logic or remediation generation.

## Optional / stretch

Do not start these ahead of the active critical path:

- #90 — bounded Arbitrum One feasibility;
- #108 — ExplorerEvidenceSource two-hour feasibility;
- #109 — one additional verified asset.

#94 is `BEST CASE SHOULD` and wraps only the public API (`quote()`, `check()`, `getRun()`,
`recheck()`, and `getAccountState()` only when available). It must not duplicate Risk, Provider,
QuickNode, or Explorer logic, and its absence does not invalidate any of the four gates.

#90 is `OPTIONAL / BOUNDED STRETCH` with a maximum four-hour read-only feasibility window.
#108 is `OPTIONAL` with a two-hour ExplorerEvidenceSource feasibility window; Explorer evidence
does not provide simulation, trace, or state diff. #109 is `OPTIONAL` with a two-hour feasibility
window for at most one additional asset. None is on the four-gate critical path.

#93 Enso is CLOSED / NOT_PLANNED and #95 Decision Receipt is CLOSED / NOT_PLANNED. Both are
Final Sprint cuts retained for post-sprint history.

## Provider owner queue

For `@jzhao0`:

```text
NOW:
#91 Native RPC + Trace supplementary portability proof

AFTER #73 Product P0:
#103 USDC → WETH real-chain feasibility

NOT ACTIVE:
#108 Explorer
#109 Asset 3
```

## Historical merged baseline

Still valid:

- #69 — NativeRpcProvider;
- #76 — P0 diagnosis / remediation;
- #77 — controlled real Camelot Sepolia evidence;
- #81 — Arbitrum Golden Path integration baseline;
- #86 — public P0 projection;
- #87 — canonical NativeRpcProvider exercise;
- #88 — assembled Backend exercise;
- #75 / #89 — Tenderly implementation/wiring;
- #98 — QuickNode trace capability evidence;
- #99 — control-plane reconciliation after #98.
- #113 — basicSimulation, exact binding, and historical Run implementation; merged at the
  current `main` checkpoint.
- #112 — qualified supplementary `TraceRpcEvidenceSource`; merged at the current `main`
  checkpoint.

Tenderly #72 remains CLOSED with implementation retained and external entitlement blocking
real credentialed qualification. It is removed from the Final Sprint critical path.

## Current gate status

- Product P0: IN PROGRESS (#73, #100, #102; #101 is complete).
- Asset Coverage: NOT COMPLETE.
- Evidence Federation: IN PROGRESS / NOT ACCEPTED (#110 Backend integration is being built).
- Verified Remediation: NOT COMPLETE.
- Minimal SDK: NOT DONE / SHOULD.
- Explorer: NOT STARTED.
- Asset 3: NOT STARTED.
- Arbitrum One: NOT STARTED.

## Current execution ordering

Product P0 work proceeds in parallel:

- Clare / Backend: #100 and #102; #101 is the completed binding slice from PR #113.
- Antony / Frontend: #73, converging on the reviewed public P0 surface.

After Product P0, the Asset Coverage lane is #103 → #104 → #105. In parallel, the Evidence
Federation lane is Jie / #106 → Clare / #110 → #91 → Antony / #92. Preparation for #110 may
proceed against the now qualified and closed #106 source; #110 still requires exact-head review
and merge before #91 can consume the integrated path. Then #107 is the separate Verified
Remediation gate, followed by #94 as a SHOULD.
Optional #90/#108/#109 work starts only after the critical gates are stable.

## Retained accepted-evidence details

These facts remain durable historical/current evidence references and must survive Final Sprint
planning transitions.

### Backend P0 assembled evidence — #78 / #88

Final assembled Backend capture:

`fixtures/provider-registry/be-078/backend-golden-path-20260922032144325/capture.json`

Capture-time repository head:

`1fe17e0bc1292b2a64b196f2dd5182acd17f9145`

The real Backend exercise truthfully recorded:

- `evidenceState=INCOMPLETE`;
- `quoteFidelity=UNKNOWN`;
- `verdict=UNKNOWN`;
- `expectedFailClosedUnknown=true`;
- remediation `NOT_RUN` because remediation was not configured for that exercise.

This is accepted Backend P0 convergence evidence, not a claim that required Evidence was complete
and not final Product Demo Gate approval.

### QuickNode trace capability evidence — #98

Final accepted current capture:

`fixtures/provider-registry/be-078/quicknode-canonical-2026-09-25T03-40-05-885Z/capture.json`

The earlier:

`fixtures/provider-registry/be-078/quicknode-canonical-2026-09-24T14-28-41-070Z/capture.json`

is retained only as historical/superseded pre-fix evidence.

The accepted read-only probe used Node `v22.23.2`, the accepted unsigned Camelot V3 prepared
transaction, the canonical NativeRpcProvider checks, `callTracer`, and
`prestateTracer(diffMode=true)` through the fail-closed JSON-RPC client.

It did **not** establish:

- `callTracer.withLog` support;
- `stateOverrides` support;
- full Tenderly/Moss capability equivalence;
- a Product-level QuickNode Provider abstraction.

It remains unsigned/read-only and is the evidence baseline feeding #106.

## 2026-09-28 — PR-FS-D exact-head P1 remediation

The live Backend Trace gate now binds its capture to one clean repository snapshot: it records
HEAD/tree before execution and refuses to write qualification evidence if clean status or
HEAD/tree changes before capture. The fix is committed at
`93a1084c0cfc5a741e8c6d4251290ef86ed6f605`.

The exact-head read-only live qualification passed at that commit and produced the v2 capture:

`fixtures/provider-registry/be-110/backend-trace-integration-20260928131317584/capture.json`

The capture records `origin/main = b6d48c5f2223d1888231a5eb7810ec2a04006111`, clean worktree,
exact prepared-transaction match, complete Trace scope, public redaction, persisted round-trip,
and historical no-requery. The earlier v1 captures are stale and retained outside the repository
for recovery only. This evidence does not by itself constitute merge or Product/Evidence
Federation acceptance.

## 2026-09-28 — PR-FS-D fingerprint and context-scope remediation

The follow-up review found that Native and Trace used different prepared-transaction fingerprint
canonicalizations, and that Trace failure paths dropped the already observed chain scope when the
pinned-block request or validation failed. The implementation now uses one shared transaction
fingerprint helper, asserts Native/Trace fingerprint equality in the live gate, and preserves
`trace-rpc.chain` while marking the pinned block and dependent capabilities unknown or unavailable.
Public projection validation and regression coverage were updated for the stage-aware scope shape.

The fix is committed at `cd1793267d4354c21785b878e1f17870e2411418`. The exact-head read-only live
gate passed from that commit and produced the current capture:

`fixtures/provider-registry/be-110/backend-trace-integration-20260928133255854/capture.json`

The capture records `origin/main = f8cc7beb4f899e0b8283e1e30a67814a4989c73e`, Native primary
success, equal Native/Trace transaction fingerprints, exact prepared-transaction matching,
complete Trace scope, public redaction, persisted round-trip, and historical no-requery. This
closes the current implementation review findings without changing Product/Risk/Contract
semantics or the unsigned/read-only boundary.

## Recorded P2 carried forward

The following previously recorded P2 items remain open unless a later merged change explicitly
closes them:

- unpinned `eth_estimateGas`;
- time-derived transaction deadline;
- derived protocol-side fallback protection has no dedicated typed public field.

## Next executable action

Current next executable task:

```text
#110 — Backend supplementary Trace integration (PR-FS-D)
```

The implementation is currently on `feat/backend-fs-d-trace-integration`. After the working
tree is committed and reviewed at its exact head, #91 can consume the integrated same-
transaction Native + Trace path. Do not start #103 before Product P0 #73 reaches its
prerequisite gate.

## 2026-09-28 — #107 verified remediation live feasibility result

`feat/verified-remediation-107` exercised the merged remediation orchestration on the real
Arbitrum Sepolia × Camelot V3 × ETH → USDC path with a bounded solver configuration, from
the accepted BE-063 real quote scenario. The exercise is read-only and changed no Product,
Risk, Contract, or Provider semantics.

Result: `VERIFIED_REMEDIATION_NOT_REACHABLE`. The primary Run completed truthfully with
`eth_call = SUCCEEDED`, `gasEstimate = AVAILABLE`, Transaction Protection `PASS`,
`providerEvidence.provider.status = UNKNOWN`, `p0.evidenceState = INCOMPLETE`,
`p0.remediation = NOT_RUN`, and Risk verdict `UNKNOWN`. A declared Economic Boundary above
the live quote is rejected as an integration error rather than published as a completed
`ADJUST`, because a declared boundary is bound verbatim into the prepared calldata as
`amountOutMinimum`.

Blockers recorded by the gate: `EVIDENCE_STATE_NOT_VERIFIED`,
`LIVE_PROVIDER_STATUS_NOT_SUCCESS`, `REMEDIATION_BRANCH_NOT_ENTERED`,
`TRANSACTION_PROTECTION_IS_ECONOMIC_BOUNDARY`, `CHILD_SIMULATED_OUTPUT_UNAVAILABLE`,
`CONSTRAINT_ROUTE_NOT_SIZE_REMEDIABLE`. The blocker classes are evidence insufficiency plus
rule structure, not scenario scarcity: route, quote, exact prepared unsigned transaction,
live `eth_call`, gas estimate, pinned block, persistence, and historical read all behaved
correctly.

Durable record: [verified-remediation-107-blocker.md](../integration/verified-remediation-107-blocker.md).
Sanitized live capture: `fixtures/provider-registry/be-107/verified-remediation-<stamp>/capture.json`.
Gate command: `pnpm --filter @parallax/api probe:verified-remediation`.

Verified Remediation therefore stays `NOT COMPLETE`; #107 stays open and is not claimed.
