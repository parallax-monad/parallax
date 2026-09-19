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

Before identity repair:

- OPEN;
- old head: `8e1f28bec2f10f3b8134c85498cc74f534d00748`;
- intended fixes for explicit mode/provenance and bounded failure text are present;
- one fixture provenance item remains an owner review/decision item;
- three commits were accidentally authored/committed as `jie <jie@users.noreply.github.com>`.

Identity repair:

- repaired head: `8d97e7536110a10955a48e5825988f96ec15c08f`;
- trees/messages/topology preserved;
- author/committer corrected to `jzhao0 <181855088+jzhao0@users.noreply.github.com>`;
- exact-head CI/re-review required before merge.

## PR #81 — P0-D integration

- OPEN;
- checkpoint head: `e7a688250d2e09cc8c706fc271f3ccdcc11d88a2`;
- Product correctness blockers previously cleared;
- must not merge before accepted #69 Provider state is reconciled.

## Remaining P0-D integration work

1. P0 Risk → quantified remediation → fresh candidate → child Run → re-verification;
2. complete public P0 RunResult/API projection;
3. independent canonical real Golden Path exercise.

## Recorded P2

- unpinned `eth_estimateGas`;
- time-derived transaction deadline;
- derived protocol-side fallback protection has no dedicated typed public field.

## Critical path

`#69 identity repair → #69 exact-head CI/owner gate → #69 merge → #81 reconcile → P0-D integration → canonical real E2E`

## Temporary write freeze

Do not resume feature development until the repaired #69 head is verified and the control-plane change is reviewed/accepted.
