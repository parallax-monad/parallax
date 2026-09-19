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
