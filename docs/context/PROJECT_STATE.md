# Project State

Last checkpoint: 2026-09-20

## Main

`main = bd98013dc956bfa4ff15ff95959f6cb614bf8c9b`

Merged before this checkpoint:

- #69 — NativeRpcProvider implementation and handoff;
- #76 — P0 diagnosis and quantified remediation;
- #77 — hardened real Camelot Sepolia evidence qualification;
- #80 — receipt-contract review synchronization;
- #81 — real Arbitrum Golden Path and public re-verification integration;
- #82 — project control plane.

## Product gates

- #67: CLOSED. Canonical target accepted; #77 evidence sufficient for controlled P0 Gate entry.
- #70: CLOSED. Product semantics frozen.

## Merged implementation baseline

- #69 NativeRpcProvider is merged at head `40a8bace5fb71021798d5a066e63cfa7b5baec20`.
- #76 P0 diagnosis and quantified remediation is merged.
- #77 real Camelot Sepolia evidence is merged and was accepted by #67 for controlled P0 use.
- #81 real Arbitrum Golden Path and public re-verification integration is merged at
  `8700726cc43b9e61b8c3f47558211c2a4c07185d`.
- #66 is closed; #67 is closed/accepted; #70 is closed/frozen.

## PR #82 — Project control plane

- OPEN;
- control-plane files (`AGENTS.md`, `RUNBOOK.md`, `docs/context/*`) hold Contract Owner
  approval for owner authority, fail-closed Evidence boundaries, and unsigned/read-only scope;
- `#82` is NOT a blanket blocker for routine feature work or review fixes; those follow the
  proportional gates in `AGENTS.md` (direct lane vs hard-stop lane);
- no write freeze is in force: only hard-stop-lane changes require an explicit gate.

## Issue #78 — final Backend P0 convergence

The merged #81 backbone leaves three acceptance items open:

1. independently exercise the accepted canonical transaction through the concrete
   NativeRpcProvider with reproducible real evidence;
2. close the minimum public P0 RunResult/API projection needed by the first demo;
3. independently exercise the assembled Backend Golden Path / Demo Gate outside the
   deterministic component fixtures.

Issue #78 owns this final convergence. It must not reopen #67/#70 semantics.

## Issue #73 — Frontend P0 consumer

Frontend work is active in parallel: add the Arbitrum/Camelot mode, consume the existing
public API through a provider-neutral presentation seam, and run the first integrated demo
smoke test without breaking the Monad × Kuru baseline.

## Parallel / deferred work

- #72 / PR #75 Tenderly qualification remains parallel and non-blocking for Native RPC P0.
- #65 remains open only for downstream closure of its already-recorded provisional Contract
  mapping; it does not reopen GenericEvidence semantics.
- Strong-stage expansion waits until #78 and #73 produce a stable first P0 demo.

## Recorded P2

- unpinned `eth_estimateGas`;
- time-derived transaction deadline;
- derived protocol-side fallback protection has no dedicated typed public field.

## Critical path

```text
#78 Backend P0 convergence
├─ independent canonical NativeRpcProvider real exercise
├─ minimum public P0 projection
└─ independent real Backend Golden Path / Demo Gate evidence

parallel

#73 Frontend P0
├─ Arbitrum/Camelot mode
├─ real API consumer integration
└─ first integrated demo smoke test

        ↓

Final P0 Demo Gate
        ↓

Strong stage
```

Routine, localized, reversible work in a clear owner boundary may proceed in parallel under
the direct lane; only the hard-stop categories in `AGENTS.md` require an explicit gate.
