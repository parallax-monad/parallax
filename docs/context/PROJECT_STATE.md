# Project State

Last checkpoint: 2026-09-19

## Main

`main = db6769c06b313f170c9a590d825e0baf158c3c6f`

Merged immediately before this checkpoint:

- #77 — real Camelot Sepolia evidence qualification;
- #76 — P0 diagnosis and quantified remediation;
- #79 — Provider chain/scope contract boundary.

## Product gates

- #67: CLOSED. Canonical target accepted; #77 evidence sufficient for controlled P0 Gate entry.
- #70: CLOSED. Product semantics frozen.

## PR #69 — NativeRpcProvider

- OPEN;
- current head: `40a8bace5fb71021798d5a066e63cfa7b5baec20`;
- Git identity history repair is DONE: the three commits previously attributed to
  `jie <jie@users.noreply.github.com>` were rebuilt with author/committer
  `jzhao0 <181855088+jzhao0@users.noreply.github.com>`, preserving trees/messages/topology;
- repaired head: `8d97e7536110a10955a48e5825988f96ec15c08f`; the remote update used exact
  `--force-with-lease` (see `MUTATION_LEDGER.md`);
- #69 has continued past the repair: `5e1aa4a` preserves partial evidence and fails closed on
  unsafe inputs, with two handoff documentation-truth corrections (`4303d3a`, `40a8bac`);
- #69 is now in scoped Backend / Contract re-review of that post-repair delta only;
- exact-head CI/re-review is still required on the current head before merge.

## PR #81 — P0-D integration

- OPEN;
- checkpoint head: `e7a688250d2e09cc8c706fc271f3ccdcc11d88a2`;
- Product correctness blockers previously cleared;
- must not merge before accepted #69 Provider state is reconciled.

## PR #82 — Project control plane

- OPEN;
- control-plane files (`AGENTS.md`, `RUNBOOK.md`, `docs/context/*`) hold Contract Owner
  approval for owner authority, fail-closed Evidence boundaries, and unsigned/read-only scope;
- `#82` is NOT a blanket blocker for routine feature work or review fixes; those follow the
  proportional gates in `AGENTS.md` (direct lane vs hard-stop lane);
- no write freeze is in force: only hard-stop-lane changes require an explicit gate.

## Remaining P0-D integration work

1. P0 Risk → quantified remediation → fresh candidate → child Run → re-verification;
2. complete public P0 RunResult/API projection;
3. independent canonical real Golden Path exercise.

## Recorded P2

- unpinned `eth_estimateGas`;
- time-derived transaction deadline;
- derived protocol-side fallback protection has no dedicated typed public field.

## Critical path

`#69 → #81 → P0-D → canonical real E2E`

Current node: #69 scoped Backend / Contract re-review of the post-repair delta. Routine,
localized, reversible work in an already-clear owner boundary may proceed in parallel under
the direct lane; it is not blocked by #69, #81, or #82.
