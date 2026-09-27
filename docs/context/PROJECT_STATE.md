# Project State

Last checkpoint: 2026-09-27

## Main checkpoint

`checkpoint_head = c4eb2f23b1c41cc4974fdec4d68491cc965e101a`

This is the verified `main` tip at this checkpoint. Future takeovers must fresh-fetch and
verify that this checkpoint is an ancestor of current `main`; equality is not required.

At checkpoint time:

- open PRs: none;
- review requests for `@jzhao0`: none;
- PR #99 is merged at `c4eb2f23b1c41cc4974fdec4d68491cc965e101a`;
- runtime/code state has not moved since #99;
- live Product execution scope has moved materially through Issues #73, #96, and #100–#110.

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
- #101 — exact Intent → prepared transaction → RPC request binding, owned by `@brightheartma`;
- #102 — persistence and historical Run semantics, owned by `@brightheartma`.

P0 does not require successful VERIFIED remediation. A truthful real Native RPC check may
remain `INCOMPLETE` / `UNKNOWN`, with remediation `NOT_RUN`, `UNVERIFIED`, or `UNKNOWN`.

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
- #104 is Backend-owned.
- #105 composes the qualified reverse path.

Do not begin production reverse-path integration before #103 qualifies the actual
transaction semantics. #103 itself remains gated by Product P0 #73.

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

#110 is the Backend consumer. Preparation may proceed after the minimum #106 interface is
agreed; real integration acceptance requires the qualified #106 source.

#91 depends on #106 and the integrated same-transaction execution path.

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

## Optional / stretch

Do not start these ahead of the active critical path:

- #90 — bounded Arbitrum One feasibility;
- #108 — ExplorerEvidenceSource two-hour feasibility;
- #109 — one additional verified asset.

#93 Enso and #95 Decision Receipt are cut from the Final Sprint critical path.

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

Tenderly #72 remains CLOSED with implementation retained and external entitlement blocking
real credentialed qualification. It is removed from the Final Sprint critical path.

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
