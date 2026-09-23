# Project State

Last checkpoint: 2026-09-24

## Main checkpoint

`checkpoint_head = 6f04f84a8c7b2edb995d17c646f03c9d481017cd`

This is the verified current `main` tip at checkpoint time. Future takeovers must still
fresh-fetch and validate ancestry before relying on this checkpoint.

After a fresh fetch, validate that `checkpoint_head` is an ancestor of current `origin/main`;
equality is neither required nor expected. Non-ancestry means history divergence or rewrite and
requires explicit reconciliation before `TAKEOVER_READY=YES`.

Merged before this checkpoint:

- #69 — NativeRpcProvider implementation and handoff;
- #76 — P0 diagnosis and quantified remediation;
- #77 — hardened real Camelot Sepolia evidence qualification;
- #80 — receipt-contract review synchronization;
- #81 — real Arbitrum Golden Path and public re-verification integration;
- #86 — minimum public P0 diagnosis projection;
- #87 — accepted canonical transaction exercise through NativeRpcProvider;
- #88 — assembled Backend Golden Path evidence;
- #75 — Tenderly Provider handoff;
- #89 — Tenderly Backend wiring;
- #82 — project control plane.
- #85 — checkpoint ancestry semantics correction.

## Product gates

- #67: CLOSED. Canonical target accepted; #77 evidence sufficient for controlled P0 Gate entry.
- #70: CLOSED. Product semantics frozen.

## Merged implementation baseline

- #69 NativeRpcProvider is merged at head `40a8bace5fb71021798d5a066e63cfa7b5baec20`.
- #76 P0 diagnosis and quantified remediation is merged.
- #77 real Camelot Sepolia evidence is merged and was accepted by #67 for controlled P0 use.
- #81 real Arbitrum Golden Path and public re-verification integration is merged at main commit
  `bd98013dc956bfa4ff15ff95959f6cb614bf8c9b` (squash merge); its historical PR head
  `8700726cc43b9e61b8c3f47558211c2a4c07185d` is retained as such and is not an ancestor of `main`.
- #86 minimum public P0 diagnosis projection is merged at main commit `b80ed60`.
- #87 accepted canonical transaction exercise through NativeRpcProvider is merged at main
  commit `1fe17e0bc1292b2a64b196f2dd5182acd17f9145`.
- #88 assembled Backend Golden Path evidence is merged at main commit `bcc40d5`.
- #75 Tenderly Provider handoff is merged at main commit `463f525`.
- #89 Tenderly Backend wiring is merged at main commit `6f04f84`.
- #85 checkpoint-control semantics are merged at main commit `a42fc10`.
- #66 is closed; #67 is closed/accepted; #70 is closed/frozen.

## PR #82 — Project control plane

- MERGED;
- control-plane files (`AGENTS.md`, `RUNBOOK.md`, `docs/context/*`) hold Contract Owner
  approval for owner authority, fail-closed Evidence boundaries, and unsigned/read-only scope;
- `#82` is NOT a blanket blocker for routine feature work or review fixes; those follow the
  proportional gates in `AGENTS.md` (direct lane vs hard-stop lane);
- no write freeze is in force: only hard-stop-lane changes require an explicit gate.

## Issue #78 — Backend P0 convergence

Issue #78 is CLOSED / COMPLETE. The merged #81/#86/#87/#88 baseline covers the canonical
Provider exercise, minimum public P0 projection, and assembled Backend Golden Path evidence.
The live runner truthfully recorded:

- capture: `fixtures/provider-registry/be-078/backend-golden-path-20260922032144325/capture.json`;
- exact capture-time `origin/main` / repository head: `1fe17e0bc1292b2a64b196f2dd5182acd17f9145`;
- HTTP/pipeline, selected baseline identity, live Provider→Evidence→Risk handoff,
  expectation-only baseline binding, persisted Run round-trip, public redaction, and
  Backend/runtime source-manifest integrity assertions: complete;
- Risk result: `evidenceState=INCOMPLETE`, `quoteFidelity=UNKNOWN`, `verdict=UNKNOWN`,
  `expectedFailClosedUnknown=true`;
- remediation: `configured=false`, observed P0 status `NOT_RUN`; this is not a solver failure.

This is Backend P0 completion evidence, not final Product Demo Gate approval. The fail-closed
`INCOMPLETE` / `UNKNOWN` result and remediation `NOT_RUN` state are truthful outcomes when
required Evidence/configuration is unavailable. Issue #78 did not reopen #67/#70 semantics.

## Issue #73 — Frontend P0 consumer

Frontend work is the remaining Product P0 critical path and is owned by Antony: add the
Arbitrum/Camelot mode, consume the stable public API through a provider-neutral
presentation seam, and run the first integrated demo smoke test without breaking the
Monad × Kuru baseline. PR #84 is CLOSED without merge as an experimental/reference-only
spike; it is not an accepted implementation baseline.

## Parallel / deferred work

- #72 remains OPEN for credentialed real Tenderly runtime qualification; merged #75 and #89
  provide the Provider and Backend wiring baseline, but qualification remains parallel and
  non-blocking for Native RPC P0.
- #65 is CLOSED / COMPLETE after its recorded provisional Contract mapping review and
  downstream dependency closure; it does not reopen GenericEvidence semantics.
- #71 is CLOSED / COMPLETE after the Risk-side implementation was delivered; remaining
  orchestration and public projection belong to #78.
- [Strong / P1 tracker #96](https://github.com/parallax-monad/parallax/issues/96) is
  PLANNED / PREPARED until the final Product P0 Demo Gate; opening it does not activate
  Strong implementation.

## Recorded P2

- unpinned `eth_estimateGas`;
- time-derived transaction deadline;
- derived protocol-side fallback protection has no dedicated typed public field.

## Critical path

```text
#78 Backend P0 convergence — COMPLETE
├─ #86 public P0 projection
├─ #87 canonical NativeRpcProvider exercise
└─ #88 assembled Backend Golden Path evidence

remaining Product P0 critical path

#73 Frontend P0
├─ Arbitrum/Camelot mode
├─ real API consumer integration
└─ judge-facing Product Demo Gate

        ↓

Final P0 Demo Gate
        ↓

Strong / P1 activation
```

Routine, localized, reversible work in a clear owner boundary may proceed in parallel under
the direct lane; only the hard-stop categories in `AGENTS.md` require an explicit gate.
