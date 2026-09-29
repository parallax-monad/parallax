# Mutation / Incident Ledger

## 2026-09-19 — #69 Git identity attribution incident

Old commits:

- `9be5e8190f25516c46f2bf0713766d2e95cfa9eb` — merge main into #69;
- `503545b2a8c4e72596665a0840340a89578233af` — Provider mode/provenance + failure-text fix;
- `8e1f28bec2f10f3b8134c85498cc74f534d00748` — merge updated main into #69.

Root cause: repo-local Git config `jie <jie@users.noreply.github.com>` overrode the actual operator identity, and GitHub mapped that noreply address to existing account `@jie`.

Integrity review:

- first merge delta exactly matched contemporaneous #79 main delta;
- second merge delta exactly matched contemporaneous #76/#77 main delta;
- no extra conflict-resolution delta;
- Provider fix matched intended #69 scope.

Repair rebuilt the same trees/messages/timestamps/topology with corrected author/committer:

- `9be5e8190f25516c46f2bf0713766d2e95cfa9eb` → `72b683fad84282c8fab165130adcad7b8df58e04`
- `503545b2a8c4e72596665a0840340a89578233af` → `4f5c0f3091ecb495a62f7d440bad992325a81d4e`
- `8e1f28bec2f10f3b8134c85498cc74f534d00748` → `8d97e7536110a10955a48e5825988f96ec15c08f`

Remote update used exact `--force-with-lease` against `8e1f28bec2f10f3b8134c85498cc74f534d00748`.

## 2026-09-19 — project control plane

Added durable takeover/context recovery files and local identity preflight. Feature development remains paused until the repaired #69 head and this control change are validated.

## 2026-09-19 — proportional gating supersedes blanket development freeze

Policy update, appended. The earlier "Feature development remains paused" note is retained
unchanged above as the historical state at the time it was written.

- The blanket development freeze is superseded by proportional gating (`AGENTS.md`,
  `RUNBOOK.md`): gate depth is keyed to risk, reversibility, and semantic reach, not to the
  number of unrelated open PRs or reviewers.
- Routine, scoped, low-risk, reversible work in an already-clear owner boundary may proceed
  after preflight, following `preflight → implement → validate → normal push → scoped review
  if needed`.
- Hard-stop categories that still require an explicit owner/gate decision: Product/Contract
  semantic changes, architecture-wide changes, history rewrite / force push, destructive Git
  operations, security/secrets incidents, signing/broadcasting/custody/wallet mutation, owner
  authority conflicts, accepted-evidence rewrite or meaning change, large cross-owner public
  API changes, and uncertain frozen-boundary impact.
- #82 no longer blocks routine #69/#81 development or review fixes.

The #69 identity-attribution incident history above is unchanged.

## 2026-09-20 — post-#81 takeover state sync

Fresh GitHub state confirmed that #69, #76, #77, #80, #81, and #82 are merged into
`main = bd98013dc956bfa4ff15ff95959f6cb614bf8c9b`. The remaining P0 work is recorded as
#78 final Backend convergence (canonical NativeRpcProvider exercise, minimum public P0
projection, and independent assembled Golden Path evidence) in parallel with #73 Frontend
integration. No Product semantics from #67/#70 were changed.

## 2026-09-20 — checkpoint ancestry semantics correction

Stale equality semantics identified: `PROJECT_STATE.md`, `AGENT_HANDOFF.md`, and
`CONTEXT_RECOVERY.md` recorded the main checkpoint as `main = <sha>` and instructed a fresh fetch
to confirm current `main` equalled that value, and #81's historical PR head was described as a
merged main head.

Wording corrected to checkpoint ancestry semantics: a recorded `checkpoint_head` is the
known-good main tip at checkpoint time, not a claim about current main. Takeover validates after a
fresh fetch that `checkpoint_head` is an ancestor of current main; equality is neither required
nor expected, and non-ancestry means history divergence/rewrite requiring explicit reconciliation
before `TAKEOVER_READY=YES`. This ancestry rule applies to main checkpoints only. #81 is now
recorded with its squash merge/main commit `bd98013dc956bfa4ff15ff95959f6cb614bf8c9b` and its
historical PR head `8700726cc43b9e61b8c3f47558211c2a4c07185d` explicitly labeled as non-ancestral.

No runtime, preflight, Product, Contract, Provider, Backend, Risk, or Frontend behavior changed;
`scripts/agent-preflight.sh` was not modified.

## 2026-09-22 — BE-078 assembled Backend Golden Path exercise

Added the scoped BE-078 live evidence runner and regression assertions. The runner is bound to
the exact local `origin/main` head, uses the accepted BE-063 baseline, starts the injected
production Arbitrum composition, and performs a real read-only Backend API check plus persisted
Run query. It records request/baseline identity, a verified live Provider handoff,
expectation-only baseline binding, public redaction, persistence round-trip, and a hashed
Backend/runtime source manifest without storing RPC credentials or raw provider payloads.

Final capture:

- `fixtures/provider-registry/be-078/backend-golden-path-20260922032144325/capture.json`
- repository head: `1fe17e0bc1292b2a64b196f2dd5182acd17f9145`
- run result: assembled exercise complete and review-required;
  `evidenceState=INCOMPLETE`, `quoteFidelity=UNKNOWN`, `verdict=UNKNOWN`, and
  `expectedFailClosedUnknown=true`;
- source manifest: 102 runtime files, unchanged during execution;
- remediation was intentionally not configured by this exercise and was observed as
  `NOT_RUN`; this is not a solver failure.

No Product/Risk/Contract semantics, Provider implementation, signing, broadcasting, or custody
behavior changed. The capture does not by itself close #78 or constitute final Product Gate
approval; owner review remains required.

## 2026-09-24 — P0 completion and Strong-stage control-plane transition

Fresh GitHub state verified `origin/main` and the GitHub API at
`6f04f84a8c7b2edb995d17c646f03c9d481017cd`. The lineage includes the merged #86 public P0
projection, #87 canonical NativeRpcProvider exercise, #88 assembled Backend Golden Path
evidence, #75 Tenderly Provider handoff, and #89 Tenderly Backend wiring. Issue #78 is now
CLOSED / COMPLETE for Backend P0 convergence; its captured `INCOMPLETE` / `UNKNOWN` result
remains truthful fail-closed Evidence behavior and is not final Product Demo Gate approval.

Issue #74 was refreshed to keep #73 as the remaining Product P0 critical path and to record
#72 as parallel, non-blocking credentialed Tenderly qualification. PR #84 was closed without
merge as an experimental/reference-only Frontend spike. Strong tracker #96 and scoped child
Issues #90–#95 were opened as PLANNED / PREPARED work; Strong activation remains gated by the
final #73 Product P0 Demo Gate. No runtime Product/Risk/Contract semantics changed.

## 2026-09-24 — Tenderly qualification blocker reclassified

After checking the available Tenderly account, the #72 blocker was reclassified from missing
local credentials to external Console/API entitlement: the account cannot self-generate the
Simulation API Access Token required for real Backend qualification. PR #75 and PR #89 remain
merged; no token or secret was recorded. Issue #72 stays open and non-blocking for Native-RPC
P0.

## 2026-09-25 — PR #98 QuickNode capability evidence merge

PR #98 was squash-merged into main at `dfee93dc5271b38fa89a2e032bd4f8a97a9719ee`.
It adds real, unsigned/read-only QuickNode Arbitrum Sepolia canonical capability evidence for
the accepted BE-063 Camelot V3 transaction on Node `v22.23.2`. Existing NativeRpcProvider
canonical checks passed; `debug_traceCall` observed `callTracer` and `prestateTracer` diff mode.
The P1 JSON-RPC response-envelope finding was fixed before merge by routing the chain, block,
and both trace requests through the existing fail-closed `createNativeRpcClient()`. CI was green;
Antony819 and brightheartma approved, with brightheartma's approval after the P1 fix.

Final accepted current capture:

- `fixtures/provider-registry/be-078/quicknode-canonical-2026-09-25T03-40-05-885Z/capture.json`.

The earlier `quicknode-canonical-2026-09-24T14-28-41-070Z/capture.json` remains only as
pre-fix historical/superseded evidence. Classification remains
`ALTERNATIVE_ENDPOINT_CAPABILITY_EVIDENCE`. Tenderly #72 qualification and production Provider
selection/wiring are unchanged. #98 neither replaces Tenderly nor completes #72 or #78;
it does not establish full Moss/Tenderly compatibility or validate `callTracer.withLog` or
`stateOverrides`. No Product/Contract semantic or Provider-selection decision changed, and
there was no signing, broadcasting, or custody.

## 2026-09-26 — PR #99 reconciled onto the #97 canonical control plane

PR #99 (`codex/pr98-control-plane-sync`) merged `origin/main` at
`ace5893ed5b4390a0fc6a352b9485f8abe1687a2` (#97) after #98 had already entered main. This was a
normal merge with no rebase, force push, or history rewrite. Conflicts were limited to
`docs/context/PROJECT_STATE.md`, `docs/context/AGENT_HANDOFF.md`, and
`docs/context/MUTATION_LEDGER.md`.

The resolution keeps the #97 control plane as the canonical baseline: #78 Backend P0 convergence
is complete, the final Product Demo Gate remains pending on #73, #84 stays closed without merge,
#96 stays PLANNED / PREPARED until Product P0 acceptance, and the fail-closed `UNKNOWN` /
`INCOMPLETE` semantics plus the #67/#70 frozen boundaries are unchanged. The #98 QuickNode
increment is retained only as additive `ALTERNATIVE_ENDPOINT_CAPABILITY_EVIDENCE`. No Provider
selection or wiring, signing, broadcasting, custody, or Product/Contract semantic changed.

Issue #72 was reconciled with its live GitHub state: the issue is CLOSED, while its recorded
status remains `IMPLEMENTATION COMPLETE / EXTERNAL API ENTITLEMENT BLOCKED`. Real credentialed
Tenderly qualification was never completed, so closure is not a qualification PASS and not
Product Gate completion. The 2026-09-24 entry above recording #72 as open is retained as the
historical state at the time it was written; #72 was not reopened and no credential was recorded.


## 2026-09-27 — Final Sprint v3 control-plane reconciliation

Fresh GitHub state at `main = c4eb2f23b1c41cc4974fdec4d68491cc965e101a` showed that
the live Product execution plan had moved materially beyond the merged 2026-09-26 context
checkpoint while runtime code/main had not moved.

Product Owner Issue #96 had been rewritten from a dormant Strong/P1 tracker into the active
Final Sprint v3 tracker. Issue #73 now defines final Product P0 as the real
Arbitrum Sepolia × Camelot V3 × ETH → USDC path, with Backend hardening split into
#100–#102. Best Case work is split into Asset Coverage (#103–#105), Evidence Federation
(#106/#110/#91/#92), and Verified Remediation (#107).

This control-plane mutation records that live state without claiming implementation completion.
It preserves the frozen #70 semantic boundaries and the historical #67 evidence record.
No runtime code, Provider selection, Risk logic, signing, broadcasting, custody, or accepted
Evidence payload is changed by this documentation sync.

Provider next executable work is recorded as #106. #91 follows #106/integration; #103 remains
gated by Product P0 #73; #108/#109 remain optional/stretch.

## 2026-09-27 — PR #111 Final Sprint v3 durable documentation sync

Fresh GitHub state advanced `main` to `542d5c685d259b5ee6d5aa55098bb2dad900f230` through
merged PR #113. PR #113 closes #101 for the native ETH → USDC P0 binding scope; #100 and #102
remain open for their explicitly recorded application-entrypoint and historical-replay evidence.

The durable context was reconciled to the live Final Sprint v3 control plane:

- #96 is the canonical GitHub execution tracker;
- GitHub execution Issues govern implementation/acceptance, while Notion is supporting reference
  material only;
- the four gates remain Product P0, Asset Coverage, Evidence Federation, and Verified Remediation;
- #106 → #110 → #91 → #92 is the Evidence Federation decomposition, with Native RPC primary and
  Trace supplementary;
- #107 Frontend child-Run presentation ownership is explicit;
- #94 remains SHOULD;
- #93 and #95 are CLOSED / NOT_PLANNED Final Sprint cuts;
- #72 remains CLOSED with implementation retained but credentialed Tenderly qualification
  externally entitlement-blocked.

Issue #110's conflicting Notion authority sentence was corrected to make #96 and the linked
GitHub execution Issues authoritative. This PR changes documentation/control-plane truth only;
no implementation completion, Product/Risk/Provider/Contract semantic change, or runtime/test
change is claimed.

## 2026-09-28 — PR-FS-D Backend supplementary integration in progress

The working tree was prepared from current `main` at `b6d48c5f2223d1888231a5eb7810ec2a04006111`
on branch `feat/backend-fs-d-trace-integration` after PR #112 merged the qualified #106
`TraceRpcEvidenceSource`. The implementation mutation is limited to the #110 Backend boundary:

- added an optional Backend-local supplementary evaluator/projector seam;
- wired the qualified Trace source through the Arbitrum composition without registering a second
  Provider;
- bound Trace to the exact prepared unsigned transaction, Run, chain, protocol, and pinned block
  context used by the primary execution;
- preserved Native facts and existing Risk verdicts on Trace failure;
- added normalized public/persisted `traceRpc` projection and historical no-requery coverage;
- added route-level failure/partial coverage, Action-Gate purpose coverage, public failure-reason
  allowlisting, bootstrap source-consumption validation, and a sanitized live qualification
  capture;
- kept raw RPC payloads, endpoint details, signing, broadcasting, custody, and Product/Risk
  semantic changes out of scope.

Validation in the working tree: API tests 612/612, repository tests 1303 passed with 2 skipped,
repository typecheck, targeted formatting, repository lint, and `git diff --check` passed. The
read-only live Backend Trace gate passed and wrote the sanitized capture at
`fixtures/provider-registry/be-110/backend-trace-integration-20260928122150385/capture.json`.
The run emitted the environment's pre-existing `NODE_TLS_REJECT_UNAUTHORIZED=0` warning; this
is a transport-security limitation of the local test environment, not a qualification claim.
No commit, push, GitHub review mutation, or secret mutation was performed. #110 remains an
unmerged implementation checkpoint pending exact-head review and acceptance.

## 2026-09-28 — PR-FS-D exact-head gate remediation

The Standards review finding was repaired in commit
`93a1084c0cfc5a741e8c6d4251290ef86ed6f605`: the live runner now captures the clean repository
HEAD/tree before execution and rechecks them before writing evidence, failing closed if the
repository changes during the run. The commit was pushed to
`feat/backend-fs-d-trace-integration`.

The Spec review finding was repaired by rerunning the real read-only Backend Trace gate from that
exact clean commit. The v2 capture at
`fixtures/provider-registry/be-110/backend-trace-integration-20260928131317584/capture.json`
records the implementation HEAD/tree, clean worktree, runner hash, and `origin/main`; the gate
passed exact prepared-transaction binding, complete Trace scope, public redaction, persisted
round-trip, and historical no-requery. The two stale v1 captures were moved to
`/private/tmp/parallax-be-110-stale.nmO38f/` without deletion. No signing, broadcasting, secret,
merge, or GitHub review mutation occurred.

## 2026-09-28 — PR-FS-D fingerprint and Trace scope remediation

Implementation commit `cd1793267d4354c21785b878e1f17870e2411418` changed only the Backend Trace
integration boundary and its regression/live-gate coverage. It introduced one shared canonical
prepared-transaction fingerprint for Native and Trace, added an exact equality assertion to the
live gate, and preserved observed chain scope on pinned-block context failure. The public Trace
projection invariant was extended to accept the stage-aware checked/unknown scope shape.

Validation passed with API tests 617/617, repository tests 1308 passed with 2 skipped, repository
typecheck/lint/format checks, and the read-only live gate. The new sanitized capture is
`fixtures/provider-registry/be-110/backend-trace-integration-20260928133255854/capture.json`;
it records equal Native/Trace fingerprints, exact prepared-transaction matching, complete Trace
scope, public redaction, persisted round-trip, and historical no-requery. This mutation does not
change Product/Risk/Contract semantics, Provider selection, signing, broadcasting, custody, or
accepted evidence meaning; no GitHub review mutation was performed.

## 2026-09-28 — #107 verified remediation feasibility gate (read-only)

Branch `feat/verified-remediation-107` added a read-only live feasibility gate
(`scripts/backend-gates/verified-remediation-live.ts`), its pure feasibility classification
and offline coverage (`scripts/backend-gates/verified-remediation-assertions.ts`,
`verified-remediation-assertions.test.ts`), and one sanitized capture under
`fixtures/provider-registry/be-107/`. The gate ran from a clean committed source head with
production runtime source unchanged and recorded `VERIFIED_REMEDIATION_NOT_REACHABLE`.

No signing, broadcasting, custody, wallet mutation, secret, history rewrite, force push,
merge, or GitHub review mutation occurred. No accepted evidence was rewritten: the accepted
BE-063 source capture digest is asserted and unchanged. No prior capture was moved or
deleted. No Product, Risk, Contract, or Provider semantic was changed.

## 2026-09-29 — #73 local Product P0 acceptance implementation

Branch `feat/product-p0-final-73` was created in an isolated worktree from fresh
`origin/main` `9dacb484d10f7fce06654511b176be0886cdbe49`. The change exposes the
configured trusted ETH/test-USDC metadata, includes the quote observation time for
selected-quote baseline binding, consumes the public Backend `basicSimulation` and
separate Provider/Execution/Evidence/Risk/remediation states in the active UI, and
connects the selected quote, persisted recovery, and explicit re-check. The shared
worktree was not modified.

Local read-only Arbitrum Sepolia/Camelot V3 ETH → USDC browser acceptance observed
real quote and Run `0d5d68d3-01c8-414f-bc10-3023e212cefb`, reload recovery, and
child re-check `71721898-4b14-4f81-8a93-914d039ec931`. The observed facts were
call `SUCCEEDED`, gas `AVAILABLE`, Risk `UNKNOWN`, Evidence `INCOMPLETE`, and
remediation `NOT_RUN`. A separate historical GET for Run
`def2b539-e536-48b5-b65e-6f9b709ea14f` produced zero RPC requests through a
read-only method counter. Controlled tests cover the distinct call-success/gas-failure
branch. Full repository tests passed 1393 with 2 skipped, web tests passed 89,
API tests passed 654, disposable PostgreSQL integration passed 16, and typecheck,
lint, web build, diff check, and added-line secret scan passed. These are local
implementation observations, pending exact-head PR CI and owner acceptance; they do
not change Product/Risk/Contract semantics or certify a Product P0 PASS.

## 2026-09-29 — current-main Final Sprint reconciliation

Current `main` advanced to `811e2b80fd6d6db6ccee5da6f4a518a6b66ba6c7` through merged PR #126;
PR #127 separately established real USDC → WETH `QUALIFIED_REAL`. PRs #118/#119/#121/#122
completed the Evidence Federation lane (#106/#110/#91/#92), while PR #123's
`BLOCKED_ACCOUNT_STATE` remains historical and PR #124 leaves Verified Remediation NOT COMPLETE.
PR #125 preserves the execution-readiness/preflight versus Provider Evidence boundary.
Product acceptance remains pending on #73; this entry records a durable snapshot only and does
not claim Asset Coverage or Product P0 PASS.
