# Durable Decision Log

## Frozen Product / P0 semantics

- Issue #67: canonical Arbitrum Sepolia × Camelot V3 P0 target accepted; controlled P0 Gate evidence accepted; closed.
- Issue #70: Expectation Baseline / diagnosis / Verdict semantics frozen; closed.
- Selected quote is an expectation baseline, not an implicit user tolerance.
- Transaction Protection (`minimumReceived` / calldata `amountOutMinimum`) is distinct from explicit User Economic Constraints.
- Insufficient evidence remains fail-closed / UNKNOWN.
- P0 remains unsigned; no signing, broadcasting, or custody.

## Ownership

Repository write permission does not transfer semantic ownership. Owner/reviewer boundaries come from `.github/CODEOWNERS`, the active Issue/PR, and accepted specifications.

## Operational decision — 2026-09-19

All agent-assisted writes require local identity preflight.

History rewrites require explicit authorization, exact old SHA, `--force-with-lease`, and post-rewrite exact-head validation.


## 2026-09-27 — Final Sprint v3 execution scope

Product Owner Issue #96 now defines the active Final Sprint execution model with four
independent gates: Product P0, Asset Coverage, Evidence Federation, and Verified Remediation.

For current final Product P0 acceptance, Issues #96/#73 define the user-facing path as
Arbitrum Sepolia × Camelot V3 × ETH → USDC with real quote, exact prepared unsigned
transaction, Native RPC `basicSimulation`, persisted Run / `getRun`, and re-check.

This does not rewrite the historical #67 accepted evidence record and does not reopen #70.
The frozen semantic boundaries remain unchanged: Expectation Baseline is not implicit tolerance,
Transaction Protection is distinct from explicit Economic Constraints, insufficient Evidence
fails closed to `UNKNOWN`, raw Provider payloads stay isolated, and P0 remains unsigned/read-only.

Provider execution ordering is now:

- #106 — reusable supplementary `TraceRpcEvidenceSource`;
- #110 — Backend consumption/integration of that source;
- #91 — same-transaction Native RPC vs Trace supplementary Evidence portability proof;
- #92 — Product capability/provenance UX;
- #103 — USDC → WETH real-chain feasibility only after Product P0 #73 prerequisite;
- #108/#109 — optional/stretch and not active critical-path work.

Native RPC remains the primary baseline. Trace Evidence is supplementary and must not become
provider ranking, voting, consensus, scoring, or automatic fallback.

## 2026-09-27 — Final Sprint v3 durable reconciliation

- GitHub Issue #96 is the authoritative Final Sprint execution tracker; linked GitHub Issues
  are the implementation/acceptance records, while Notion is supporting reference material only.
- Full Best Case is the conjunction of Product P0, Asset Coverage, Evidence Federation, and
  Verified Remediation. These gates remain independently reportable; a kill switch stops
  investment but does not lower an acceptance standard retroactively.
- PR #113 merged at `542d5c685d259b5ee6d5aa55098bb2dad900f230`; #101 is CLOSED / COMPLETED.
  #100 and #102 remain open for their explicit application-entrypoint and historical-replay
  acceptance evidence.
- The Evidence Federation decomposition is #106 → #110 → #91 → #92. Native RPC remains the
  primary baseline, Trace is supplementary, and no ProviderRegistry rewrite, ranking, scoring,
  voting, consensus, or automatic fallback is introduced.
- #107 is a separate Verified Remediation gate with Backend, Provider/Risk, Frontend, Product,
  and conditional Contract ownership as recorded in the durable context.
- #94 is `BEST CASE SHOULD`; #93 Enso and #95 Receipt UX are CLOSED / NOT_PLANNED Final Sprint
  cuts retained for post-sprint history.
- No Product, Risk, Provider, or Contract semantics changed in this documentation sync.

## 2026-09-28 — #106 completion and PR-FS-D Backend boundary

PR #112 is merged into `main` at `b6d48c5f2223d1888231a5eb7810ec2a04006111`; Issue #106 is
CLOSED / COMPLETED with the accepted qualification capture retained under
`fixtures/provider-registry/be-106/trace-rpc-source-qualification-2026-09-28T10-06-13-121Z/`.

PR-FS-D / Issue #110 is being implemented on branch `feat/backend-fs-d-trace-integration`.
The Backend composition decision is:

- evaluate the qualified `TraceRpcEvidenceSource` only after the primary Native/Tenderly
  Provider execution has produced the exact prepared transaction;
- keep supplementary Trace Evidence outside `ProviderRegistry`, Core, Decision, and Risk, so it
  cannot become a competing Provider, fallback, ranking, vote, or verdict upgrade;
- project only normalized, allowlisted Trace provenance, binding, capability, and scope facts
  into the existing public `providerEvidence.providerData.traceRpc` shape;
- preserve the Native projection when Trace fails, and persist the same normalized facts for
  `getRun` without re-querying RPC or exposing raw payloads/endpoints.

This is an implementation checkpoint, not an Evidence Federation PASS or a claim that #110 has
been merged/accepted. Frozen Product/Risk/Contract semantics, the unsigned/read-only boundary,
and Native-primary behavior remain unchanged.

## 2026-09-28 — PR-FS-D three-round self-review checkpoint

Three Standards/Spec self-review rounds were completed against the current working tree. Each
round's P1/P2 findings were repaired before the next round. The final boundary fixes include:

- route-level coverage for Trace context mismatch, timeout, unsupported, malformed, and partial
  outcomes;
- explicit `primary` versus `verification_child` execution-purpose wiring, with supplementary
  Trace disabled for Action-Gate children and internal remediation paths;
- shared public Trace projection with raw output excluded and failure reasons restricted to the
  normalized allowlist;
- bootstrap validation that rejects a qualified Trace source when no Arbitrum route can consume
  it, instead of silently dropping the source; and
- a read-only live Backend gate proving Native primary success, exact prepared-transaction
  matching, persisted round-trip, and historical no-requery, with sanitized capture retained at
  `fixtures/provider-registry/be-110/backend-trace-integration-20260928122150385/capture.json`.

Final working-tree validation is API tests 612/612, repository tests 1303 passed with 2 skipped,
repository typecheck, lint, targeted formatting, and `git diff --check`. The live run emitted the
environment's pre-existing `NODE_TLS_REJECT_UNAUTHORIZED=0` warning; this is recorded as a local
transport-security limitation and does not upgrade the #110 acceptance state. No commit, push,
merge, or GitHub review mutation was performed.

## 2026-09-28 — PR-FS-D Standards/Spec P1 remediation

The latest self-review identified two remaining P1 concerns:

- Standards: the live gate checked repository cleanliness at start but read HEAD/tree only after
  execution, so a repository change during the run could be misattributed to the capture.
- Spec: the prior v1 live capture predated the final gate fix and was not current exact-head
  qualification evidence.

The live runner now records a clean repository snapshot before execution and rechecks clean
status plus HEAD/tree immediately before writing the capture. If the repository changes during
the run, the gate fails closed and emits no valid qualification capture. Commit
`93a1084c0cfc5a741e8c6d4251290ef86ed6f605` contains this Standards fix.

The real read-only live gate was rerun from that exact clean commit against the environment-
supplied Arbitrum endpoint. It passed Native primary success, exact prepared-transaction matching,
complete Trace scope, public redaction, persisted round-trip, and historical no-requery checks.
The v2 capture is retained at
`fixtures/provider-registry/be-110/backend-trace-integration-20260928131317584/capture.json` and
records the exact implementation HEAD/tree, clean worktree, runner hash, and `origin/main`.
The old v1 captures were moved out of the repository as recoverable stale evidence and are not
the current qualification source of truth. This closes the two review findings for the current
implementation checkpoint without changing Product/Risk/Contract semantics or the unsigned,
read-only boundary.

## 2026-09-28 — PR-FS-D fingerprint and context-scope review remediation

The follow-up review identified one Spec P1 and one Standards/P2 boundary issue in the Backend
Trace integration:

- Native and Trace computed different fingerprints for the same prepared transaction because Trace
  hashed a source-specific `{ kind, payload }` wrapper while Native hashed the transaction payload;
- Trace context failure results discarded the verified chain scope when the pinned-block request or
  block-context validation failed.

Commit `cd1793267d4354c21785b878e1f17870e2411418` adds a shared canonical transaction fingerprint,
requires Native/Trace fingerprint equality in the live gate, preserves `trace-rpc.chain` on
pinned-block failure, and updates public invariant validation plus regression tests. The exact-head
read-only gate passed and wrote
`fixtures/provider-registry/be-110/backend-trace-integration-20260928133255854/capture.json`;
the capture proves equal fingerprints, exact transaction matching, complete Trace scope, public
redaction, persisted round-trip, and historical no-requery. No Product/Risk/Contract semantics,
signing, broadcasting, or custody behavior changed.
