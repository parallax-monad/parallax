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

## 2026-09-28 — #107 verified remediation is not reachable under frozen semantics

`feat/verified-remediation-107` proved, with a real read-only Arbitrum Sepolia × Camelot V3 ×
ETH → USDC exercise and a bounded solver configuration, that no currently reachable live
scenario can produce a `VERIFIED` remediation child re-check. The finding is recorded as
evidence insufficiency plus rule structure; no scenario, threshold, or Evidence was
fabricated to obtain it.

Recorded consequences for sequencing only:

- Verified Remediation remains `NOT COMPLETE`; #107 remains open and is not claimed.
- The merged remediation mechanism is reachable only through a caller-injected
  `providerEvidenceMapper`, which is synthetic Evidence and cannot satisfy #107.
- No Product, Risk, Contract, or Provider semantic is changed by this record. The four
  decisions that would have to be accepted by their owners are listed in
  `docs/integration/verified-remediation-107-blocker.md`.
- Read-only capture and gate: `fixtures/provider-registry/be-107/` and
  `pnpm --filter @parallax/api probe:verified-remediation`.

## 2026-09-29 — current-main durable snapshot

- Issue #96 is the canonical Final Sprint tracker; linked GitHub Issues are live implementation
  and acceptance state, PRs/captures are evidence records, and `docs/context/*` is only a durable
  snapshot/handoff. Notion is supporting reference material. Agents must fresh-fetch before acting.
- Product P0 remains final owner review: PR #126 is merged, but Product Owner acceptance is not
  recorded; #73/#100/#102 remain open. P0 does not require `VERIFIED` remediation.
- Asset Coverage acceptance is #103 real qualification + #104 support + #105 end-to-end acceptance;
  these are acceptance dependencies, not mandatory serial engineering. PR #123's
  `BLOCKED_ACCOUNT_STATE` is historical, and PR #127 later establishes `QUALIFIED_REAL`.
- Evidence Federation is PASS with #106/#110/#91/#92 complete. Native RPC is primary and Trace
  supplementary; no ranking, voting, scoring, consensus, or automatic fallback is introduced.
- `INSUFFICIENT_NATIVE_BALANCE` is an execution-readiness/integration fact, not a Risk verdict.
  Generic gas is preflight; the pinned Provider gas check is Evidence consumed independently by
  Risk.
- #107 remains NOT COMPLETE / not currently reachable under frozen semantics; details stay in
  `docs/integration/verified-remediation-107-blocker.md`.

## 2026-10-04 — Optional Decision Registry MVP boundary

Per the user's authorization, implement a minimal optional Parallax Decision Registry on
Arbitrum Sepolia (421614): a single immutable-attestor contract stores one domain-separated
commitment per persisted completed, non-replay Run. The off-chain V1 bundle contains the
versioned public decision snapshot; it excludes UI-only projection and raw `providerData`.
Anchoring proves only that the saved snapshot matches the registered commitment, not that its
Evidence is authentic or its Risk decision is correct.

This scope does not alter the public API, Risk rules, Frontend, swap transaction path, signing
or custody of user assets. Contract Owner confirmation is not to be requested; the user stated
that such approvals should be treated as granted. This authorization does not itself record a
deployment or anchoring transaction.

The anchor CLI must resolve the selected Foundry account locally and require its address to
match the Registry's immutable attestor before sending. A mismatch is rejected before any
transaction write, avoiding a predictable revert and testnet gas loss.
The deployment flow also rejects zero addresses and includes a separate read-only verification
command for chain ID, exact deployed runtime bytecode, and immutable attestor before preparing a
Run bundle.

The MVP remains an explicit operator-triggered CLI flow over a persisted Run, not automatic
anchoring from `POST /api/check`. This keeps Registry anchoring separate from the existing
opaque Receipt lifecycle, whose frozen contract still leaves payload, commitment, durable
retry, and public projection semantics unresolved; no new public lifecycle semantics are
inferred here. The current lifecycle also starts during `BackendPipeline` execution, before the
Run store marks the result completed. Reusing it directly would attempt the Registry operation
before its persisted-Run precondition holds; automatic anchoring would need a separate
post-persistence hook and durable retry design.

At the implementation checkpoint on 2026-10-04, the shared project's configured RPC was checked
read-only and `eth_chainId` returned `421614` (Arbitrum Sepolia). The RPC credential was neither
displayed nor copied into the feature worktree. At that checkpoint the attestor and deployed
Registry address were not yet configured and no transaction had occurred; the live execution
checkpoint below supersedes that temporary status.

### Live execution checkpoint — 2026-10-04

The user supplied the attestor address and explicitly authorized deployment and one commitment
anchor. Registry `0xdfc1f61e75fd551b9c309ec0bfae015adf6fe359` was deployed on Arbitrum Sepolia
(`421614`) by `0x1d6e2221af2a0ecea9e497e65bef31f3912a3633` in transaction
`0x46cd3fd97086a40c157be0cdc50baa9a40db9c24417d723cc5dd6f08e6e000f6` at block `315701144`.
The read-only verifier returned `MATCH` for chain, deployed runtime, and immutable attestor.

One completed persisted Run was then anchored. Independent bundle verification returned `MATCH`
for runKey `0x105baed92e95a4ac1c4345f14ae6965671a7d721836db79aabe265dd9836061a`, record hash
`0x6fa9fb5aab04497f65a28340b3a381c7c8cab848e27b83f23bc532559313a055`, and commitment
`0x8ebcbeb7aa0f6c27c68e3a20f9f963f3268acf1a1c1e87f4618328bcd8f31356`. Anchor transaction
`0x3e40db4fdc33b8bf3b726fa7f8a60049e0518c19e6cbc98eb69c20932f374af0` succeeded at block
`315701961` (receipt status `true`). This records integrity/equality only; it does not certify
Evidence authenticity, Risk correctness, transaction safety, or `VERIFIED` remediation.

After the final source-boundary review, the `anchor` CLI was tightened to re-fetch the bundle's
Run ID from the Backend API and compare the re-derived V1 record hash and commitment before any
chain write. A mismatched or unavailable API Run now stops the signing path. This does not change
the contract, public API, Risk behavior, or the already anchored commitment. A fresh read-only
API recomputation returned the same record hash and commitment; the updated CLI's idempotent
anchor path also re-fetched the Run, confirmed the existing chain value, and reported that no
transaction was sent. The original anchor transaction predates this guard; no new transaction was
submitted after the code change.
