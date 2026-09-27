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
