# Project State

Last checkpoint: 2026-09-29

## Main checkpoint

`checkpoint_head = 811e2b80fd6d6db6ccee5da6f4a518a6b66ba6c7`

This is the verified `main` tip at this checkpoint. Future takeovers must fresh-fetch and
verify that this checkpoint is an ancestor of current `main`; equality is not required.

At checkpoint time:

- current `main` includes merged PR #126 at `811e2b80fd6d6db6ccee5da6f4a518a6b66ba6c7`;
- PR #127 is merged and records the real reverse-path qualification;
- #101 is CLOSED / COMPLETED by PR #113; #100 and #102 remain open pending explicit Product
  acceptance of the merged #126 path;
- #106, #110, #91, and #92 are closed/completed; Evidence Federation is PASS;
- live Product execution scope is represented by Issues #73, #96, and #100–#110.

This file is a durable checkpoint, not the live execution tracker. Always fresh-fetch Issue #96
and the target Issue/PR before acting; fresh GitHub state wins when it differs from this snapshot.

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

PR #125 boundary: generic gas estimation is preflight; the NativeRpcProvider pinned gas check is
execution Evidence consumed independently by Risk. `INSUFFICIENT_NATIVE_BALANCE` is an
execution-readiness/integration fact, not a Risk verdict. Partial `call=SUCCEEDED` /
`gas=UNAVAILABLE` remains incomplete Evidence and does not become a Risk PASS.

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

Current state:

- PR #126 is MERGED and contains the real browser/Backend path; explicit Product Owner
  acceptance is NOT YET RECORDED;
- #73 remains the final Product P0 gate, owned by `@antony819` with Product acceptance by
  `@chin0312`;
- #100 and #102 have complete Backend scope but remain open pending explicit Product acceptance.

Merged PR #126 records a real Arbitrum browser path, persisted Run recovery, and an explicit
child re-check. The observed result was `eth_call=SUCCEEDED`, `gasEstimate=AVAILABLE`, Provider
`UNKNOWN`, execution `SUCCESS`, Evidence `INCOMPLETE`, Risk `UNKNOWN`, and remediation
`NOT_RUN`. This is implementation evidence, not Product P0 PASS; `UNKNOWN` is not a pass.

#101 — exact Intent → prepared transaction → RPC request binding — is CLOSED / COMPLETED by
merged PR #113 for the native ETH → USDC P0 scope. Its reverse ERC-20 extension remains under
#105 and does not reopen #101.

P0 does not require successful VERIFIED remediation. A truthful real Native RPC check may
remain `INCOMPLETE` / `UNKNOWN`, with remediation `NOT_RUN`, `UNVERIFIED`, or `UNKNOWN`, and
child verification `unknown` / `unavailable`.

## Asset Coverage — Best Case gate

Acceptance requires:

```text
#103 QUALIFIED_REAL
+ #104 account-state / allowance support
+ #105 end-to-end Product acceptance
→ Asset Coverage PASS
```

These are acceptance dependencies, not a mandatory serial engineering order. Independent work
may proceed when no concrete interface/data dependency exists:

- #103 is Provider-owned and `QUALIFIED_REAL` through PR #127;
- #104 is Backend-owned and COMPLETE through PR #115; it is non-blocking for Product P0 but
  enabling MUST for qualified ERC-20 reverse support;
- #105 is ACTIVE and owns the remaining end-to-end reverse-path acceptance. #73 does not block
  #105 implementation, and #103 qualification does not block deterministic #105 work;
- #103 qualification gates real reverse-path qualification/activation claims; #105 still gates
  Asset Coverage PASS.

#103 has a focused four-hour feasibility kill switch. If it cannot qualify the real path:

```text
STOP reverse-path investment
Product P0 = retained
Asset Coverage = NOT COMPLETE
Full Best Case = NOT COMPLETE
```

The acceptance standard is not lowered.

Historical #103 transition: PR #123 completed bounded feasibility but recorded
`BLOCKED_ACCOUNT_STATE` with qualification incomplete at that time. PR #127 later added a new
real read-only qualification and established `QUALIFIED_REAL`. The old blocker remains historical;
the current result does not make Asset Coverage PASS.

## Evidence Federation — PASS

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

#106 is CLOSED / COMPLETED through PR #112 and is owned by `@jzhao0`.

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

#110 is CLOSED / COMPLETED through PR #119. It keeps Trace outside `ProviderRegistry`, Core,
Decision, and Risk; Native RPC remains primary. #91 is CLOSED / COMPLETED through PR #118 and
#92 is CLOSED / COMPLETED through PR #122. The completed lane preserves exact transaction/run,
chain/protocol, fingerprint, compatible block context, checked/unknown/unavailable capability
states, provenance, and historical no-requery behavior. Trace does not upgrade Risk.

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

PR #124 records `VERIFIED_SCENARIO_FOUND = NO`: the result is not currently reachable under
frozen semantics because of evidence insufficiency plus the current rule structure. Keep #107
OPEN / NOT COMPLETE; details remain in
`docs/integration/verified-remediation-107-blocker.md` and no semantic changes are adopted here.

## Optional / stretch

Do not start these ahead of the active critical path:

- #90 — bounded Arbitrum One feasibility;
- #108 — ExplorerEvidenceSource two-hour feasibility;
- #109 — one additional verified asset.

#94 is `BEST CASE SHOULD` and wraps only the public API (`quote()`, `check()`, `getRun()`,
`recheck()`, and `getAccountState()` only when available). It must not duplicate Risk, Provider,
QuickNode, or Explorer logic, and its absence does not invalidate any of the four gates.

#90 is `OPTIONAL / BOUNDED STRETCH` with a maximum four-hour read-only feasibility window.
#108 is `OPTIONAL / STRETCH` with bounded feasibility in draft PR #120; credentialed Etherscan V2
qualification is currently blocked. Explorer evidence does not provide simulation, trace, or
state diff. #109 is `OPTIONAL` with a two-hour feasibility window for at most one additional
asset. None is on the four-gate critical path.

#93 Enso is CLOSED / NOT_PLANNED and #95 Decision Receipt is CLOSED / NOT_PLANNED. Both are
Final Sprint cuts retained for post-sprint history.

## Provider owner queue

For `@jzhao0`:

```text
COMPLETE:
#103 USDC → WETH real-chain qualification
#106 TraceRpcEvidenceSource
#110 Backend Trace integration
#91 Native RPC + Trace supplementary portability proof
#92 capability / provenance UX

OPTIONAL / NOT ACTIVE:
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

- Product P0: FINAL OWNER REVIEW — PR #126 MERGED; Product Owner acceptance not yet recorded;
  #73/#100/#102 remain open.
- Asset Coverage: IN PROGRESS — #103 `QUALIFIED_REAL`, #104 complete, #105 end-to-end acceptance
  pending.
- Evidence Federation: PASS — #106/#110/#91/#92 complete.
- Verified Remediation: NOT COMPLETE — currently not reachable under frozen semantics (#107 / PR
  #124).
- Minimal SDK: SHOULD / NOT STARTED (#94).
- Explorer: OPTIONAL / BOUNDED FEASIBILITY IN PROGRESS — draft PR #120 / #108.
- Asset 3: OPTIONAL / NOT STARTED (#109).
- Arbitrum One: OPTIONAL / NOT STARTED (#90).

## Current execution ordering

Product P0 work proceeds in parallel:

- Clare / Backend: #100 and #102; #101 is the completed binding slice from PR #113.
- Antony / Frontend: #73, converging on the reviewed public P0 surface.

Asset Coverage acceptance depends on #103 qualification, #104 support, and #105 end-to-end
acceptance, but those arrows do not mandate serial engineering: #105 may proceed independently
when its concrete interfaces/data are available. Evidence Federation is complete through
#106/#110/#91/#92. #107 remains the separate Verified Remediation gate, #94 is SHOULD, and
#90/#108/#109 remain optional/outside the critical path.

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

Current Product gate:

```text
#73 — explicit Product Owner acceptance of the merged PR #126 path
```

In parallel, #105 may continue its end-to-end Asset Coverage implementation against #103
`QUALIFIED_REAL` and #104 support. Consult the live Issues for detailed acceptance state; do not
default to #110 or treat #103 as waiting for #73.

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

## 2026-10-04 — Decision Registry MVP implementation and testnet anchor

An isolated worktree `feat/decision-commitment-registry` was advanced from its recorded
starting point to `origin/main` tip `fafa36f54f36bfc02e1bb8ed06f54d3fdab9caa8` by a safe
fast-forward from `5f4e500d916c6c392147344e2bcc6f39c49fc4f6`; the intervening commit only
changed demo/Pages files and all local task edits were preserved.
The feature branch adds the optional Arbitrum Sepolia Decision Registry contract,
versioned off-chain Run commitment preparation, and deploy/anchor/verify CLI commands. Before
an anchor write, the CLI now resolves the selected Foundry account and fails closed unless its
address matches the Registry's immutable attestor, avoiding a predictable reverted transaction.
It also rejects zero attestor/Registry addresses and has a standalone read-only deployment
verifier for chain ID, exact runtime bytecode, and the configured immutable attestor.
The anchor command also re-fetches the selected Run from the Backend API and refuses to sign
unless the persisted result recomputes to the exact bundle commitment.
This is an auditability commitment only: it does not certify Evidence authenticity or safety
and does not change Risk, Frontend, swap signing, or transaction execution.

Docker validation passed: Foundry contract tests 6/6; API decision-record tests 15/15, including
a fixed V1 Run-key, record-hash, and commitment vector plus persisted-API-source matching; API
typecheck, targeted Biome, and CLI help smoke passed. Anchoring is explicitly operator-triggered
on a persisted Run rather than automatic for each `/api/check`, preserving separation from the
opaque Receipt lifecycle. The
shared project `.env` has an RPC endpoint, and a read-only `eth_chainId` check returned
Arbitrum Sepolia `421614`; that secret was not copied to this worktree or printed.
At that implementation checkpoint, the attestor and Registry were not configured here and live
deployment/anchoring had not occurred. No deployment address, transaction hash, or commitment
proof was recorded at that time.
This local implementation checkpoint is superseded by the live deployment and anchor evidence
recorded below.

The user-provided public attestor `0x1d6e2221af2a0ecea9e497e65bef31f3912a3633` deployed the
Registry at `0xdfc1f61e75fd551b9c309ec0bfae015adf6fe359` on Arbitrum Sepolia (`421614`). Deployment
transaction `0x46cd3fd97086a40c157be0cdc50baa9a40db9c24417d723cc5dd6f08e6e000f6` was mined at
block `315701144`; the read-only deployment verifier returned `MATCH`. The RPC credential was not
printed or copied into this worktree.

One completed persisted Run was anchored. Independent verification returned `MATCH` for runKey
`0x105baed92e95a4ac1c4345f14ae6965671a7d721836db79aabe265dd9836061a`, record hash
`0x6fa9fb5aab04497f65a28340b3a381c7c8cab848e27b83f23bc532559313a055`, and commitment
`0x8ebcbeb7aa0f6c27c68e3a20f9f963f3268acf1a1c1e87f4618328bcd8f31356`. Anchor transaction
`0x3e40db4fdc33b8bf3b726fa7f8a60049e0518c19e6cbc98eb69c20932f374af0` succeeded at block
`315701961` (receipt status `true`). This proves only that the prepared decision snapshot matches
the anchored commitment; it does not prove Evidence authenticity, Risk correctness, transaction
safety, or `VERIFIED` remediation. The Run ID and private bundle are intentionally excluded from
this public project record.

Feature commit `f6873a9ac00723698b648ccb753e9b83800d98d7` was pushed on
`feat/decision-commitment-registry`; PR #163 is OPEN against `main`:
https://github.com/parallax-monad/parallax/pull/163. The CI `Checks` job and Vercel preview both
passed for the original feature head. A docs-only handoff synchronization is included in this
follow-up commit and changes the PR head; refresh the live PR for its exact current head and
checks.
Per the user's instruction, the departed Contract Owner approval is treated as granted and its
automatically generated GitHub review request was removed. This PR does not claim merge or
Product acceptance.
