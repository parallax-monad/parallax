# Project State

Last checkpoint: 2026-09-25

## Main checkpoint

`checkpoint_head = dfee93dc5271b38fa89a2e032bd4f8a97a9719ee`

This is the known-good main tip at checkpoint time. It is not a claim about current `main`.

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
- #82 — project control plane;
- #98 — QuickNode canonical trace capability evidence.

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
- #98 QuickNode Arbitrum Sepolia canonical read-only capability evidence was squash-merged
  on 2026-09-25 at main commit `dfee93dc5271b38fa89a2e032bd4f8a97a9719ee`.
- #66 is closed; #67 is closed/accepted; #70 is closed/frozen.

## PR #82 — Project control plane

- MERGED;
- control-plane files (`AGENTS.md`, `RUNBOOK.md`, `docs/context/*`) hold Contract Owner
  approval for owner authority, fail-closed Evidence boundaries, and unsigned/read-only scope;
- `#82` is NOT a blanket blocker for routine feature work or review fixes; those follow the
  proportional gates in `AGENTS.md` (direct lane vs hard-stop lane);
- no write freeze is in force: only hard-stop-lane changes require an explicit gate.

## Issue #78 — final Backend P0 convergence

The merged #81/#86/#87 baseline now covers the canonical Provider exercise and the minimum
public P0 projection. The remaining assembled-path evidence is recorded by the live runner:

- capture: `fixtures/provider-registry/be-078/backend-golden-path-20260922032144325/capture.json`;
- exact `origin/main` / repository head: `1fe17e0bc1292b2a64b196f2dd5182acd17f9145`;
- HTTP/pipeline, selected baseline identity, live Provider→Evidence→Risk handoff,
  expectation-only baseline binding, persisted Run round-trip, public redaction, and
  Backend/runtime source-manifest integrity assertions: complete;
- Risk result: `evidenceState=INCOMPLETE`, `quoteFidelity=UNKNOWN`, `verdict=UNKNOWN`,
  `expectedFailClosedUnknown=true`;
- remediation: `configured=false`, observed P0 status `NOT_RUN`; this is not a solver failure.

The final Product/owner Gate review remains open. These results do not automatically close
#78 or claim a final Demo Gate PASS.

The original three acceptance items were:

1. independently exercise the accepted canonical transaction through the concrete
   NativeRpcProvider with reproducible real evidence;
2. close the minimum public P0 RunResult/API projection needed by the first demo;
3. independently exercise the assembled Backend Golden Path / Demo Gate outside the
   deterministic component fixtures — exercised and awaiting final owner review.

Issue #78 owns this final convergence. It must not reopen #67/#70 semantics.

## Issue #73 — Frontend P0 consumer

Frontend work is an Antony-owned workstream that may proceed in parallel: add the
Arbitrum/Camelot mode, consume the stable public API through a provider-neutral
presentation seam, and run the first integrated demo smoke test without breaking the
Monad × Kuru baseline. PR #84 is retained as an experimental spike/reference only, not
an accepted implementation baseline.

## Provider — PR #98 merged alternative QuickNode capability evidence

The final accepted current capture is
`fixtures/provider-registry/be-078/quicknode-canonical-2026-09-25T03-40-05-885Z/capture.json`.
The earlier `quicknode-canonical-2026-09-24T14-28-41-070Z/capture.json` is retained only as
pre-fix historical/superseded evidence.

On Node `v22.23.2`, the real read-only exercise used the canonical BE-063 unsigned Camelot V3
transaction. Existing NativeRpcProvider canonical checks passed; `debug_traceCall` observed
`callTracer` and `prestateTracer` with `diffMode=true`. The chain, block, and both trace requests
use the existing fail-closed `createNativeRpcClient()` JSON-RPC path. Its response-envelope P1
review finding was fixed before merge. CI passed; Antony819 and brightheartma approved, with
brightheartma's approval after the P1 fix.

Classification remains `ALTERNATIVE_ENDPOINT_CAPABILITY_EVIDENCE`. Tenderly #72 qualification
and production Provider selection/wiring remain unchanged. QuickNode is not a Tenderly
replacement; #72 and #78 are not completed by #98. This evidence does not establish full
Moss/Tenderly compatibility; `callTracer.withLog` and `stateOverrides` were not validated by
#98. The exercise was unsigned/read-only, with no signing, broadcasting, or custody.

## Parallel / deferred work

- #72 / PR #75 Tenderly qualification remains parallel and non-blocking for Native RPC P0.
- #65 is CLOSED / COMPLETE after its recorded provisional Contract mapping review and
  downstream dependency closure; it does not reopen GenericEvidence semantics.
- #71 is CLOSED / COMPLETE after the Risk-side implementation was delivered; remaining
  orchestration and public projection belong to #78.
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
