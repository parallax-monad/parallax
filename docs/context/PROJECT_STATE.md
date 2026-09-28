# Project State

Last checkpoint: 2026-09-27

## Main checkpoint

`checkpoint_head = 542d5c685d259b5ee6d5aa55098bb2dad900f230`

This is the verified `main` tip at this checkpoint. Future takeovers must fresh-fetch and
verify that this checkpoint is an ancestor of current `main`; equality is not required.

At checkpoint time:

- current `main` includes merged PR #113 at `542d5c685d259b5ee6d5aa55098bb2dad900f230`;
- PR #111 remains an unmerged documentation branch based on `c4eb2f23b1c41cc4974fdec4d68491cc965e101a`;
- PR #112 remains the open Trace Provider implementation path;
- #101 is CLOSED / COMPLETED by PR #113; #100 and #102 remain open for their explicit
  application-entrypoint and historical-replay acceptance evidence;
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

#110 is the Backend consumer, owned by `@brightheartma`, covering composition, exact context
binding, persistence, public projection, and historical consistency. Preparation may proceed
after the minimum #106 interface is agreed; real integration acceptance requires the qualified
#106 source. #110 does not block Product P0.

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
#106 TraceRpcEvidenceSource

AFTER #106 + Backend integration:
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

Tenderly #72 remains CLOSED with implementation retained and external entitlement blocking
real credentialed qualification. It is removed from the Final Sprint critical path.

## Current gate status

- Product P0: IN PROGRESS (#73, #100, #102; #101 is complete).
- Asset Coverage: NOT COMPLETE.
- Evidence Federation: NOT COMPLETE.
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
proceed once the minimum #106 interface is agreed, but real acceptance requires qualified #106
Evidence. Then #107 is the separate Verified Remediation gate, followed by #94 as a SHOULD.
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

## Recorded P2 carried forward

The following previously recorded P2 items remain open unless a later merged change explicitly
closes them:

- unpinned `eth_estimateGas`;
- time-derived transaction deadline;
- derived protocol-side fallback protection has no dedicated typed public field.

## Next executable action

Provider-side next executable task:

```text
#106 — Productionize TraceRpcEvidenceSource
```

Start with the smallest reusable source/interface slice derived from accepted #98 evidence.
Do not start #91 before #106 exists, and do not start #103 before Product P0 #73 reaches its
prerequisite gate.
