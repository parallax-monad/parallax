# Decision Receipt Contract Owner Review Checklist

Status: **BE-032 Contract Owner review recorded for the current lifecycle boundary; the final Receipt schema and on-chain/public contract design remain unresolved or deferred.**

This document records the confirmed Receipt boundaries from Issue #62. It is a Backend-maintained decision record and implementation checklist. It does not authorize Backend to infer a final Receipt schema, ABI, deployment, signing, anchoring, or public API contract from the current opaque lifecycle.

## Evidence and scope

- Contract Owner decision matrix: [Issue #62 comment](https://github.com/parallax-monad/parallax/issues/62#issuecomment-5706761280)
- BE-032 status clarification: [Issue #62 comment](https://github.com/parallax-monad/parallax/issues/62#issuecomment-5714565944)
- Provider Owner evidence: [Issue #62 comment](https://github.com/parallax-monad/parallax/issues/62#issuecomment-5691741520)
- Existing Receipt lifecycle implementation: [PR #61](https://github.com/parallax-monad/parallax/pull/61)

The current phase records the accepted lifecycle boundaries and explicitly preserves unresolved or deferred final-contract decisions. BE-GATE-006 must be re-evaluated after this checklist and the BE-032 progress record are synchronized.

## Existing implementation boundary

The Backend currently provides only the controlled, non-blocking Receipt lifecycle boundary:

- An opaque Receipt payload supplied by an internal application seam;
- Optional signer and anchorer adapters;
- Signer-before-anchorer ordering when both adapters are configured;
- Observable success, failure, thrown-error, timeout, and unconfigured states;
- Non-blocking behavior after Decision completion;
- Deterministic fake/no-op tests.

The current implementation does not introduce a final Receipt contract, ABI, deployment, RPC anchoring, explorer proof, or user Swap signing. Receipt processing must not rewrite an already completed Decision.

## Decision matrix

| Area | Decision status | Confirmed boundary | Owner / follow-up |
| --- | --- | --- | --- |
| Receipt payload | **UNRESOLVED** | A Receipt must be an explicitly constructed immutable payload. It must not be inferred from `decisionOutput`, a configured/selected adapter, request identity, or transport success. | Contract Owner proposes canonical payload and versioning with Product and Provider input before implementation. |
| Commitment / hash | **UNRESOLVED** | No serialization, field ordering, hash, domain separation, or commitment is approved. | Contract Owner proposes the commitment design and test vectors. |
| Events / observability | **DEFERRED** | Internal lifecycle snapshots are accepted for this phase; no event or ABI schema is implied. | Contract Owner and Backend when public/on-chain design is scheduled. |
| Validation | **APPROVED BOUNDARY** | Payload validation must precede signing/anchoring. Invalid, incomplete, or unverifiable payloads must not be signed or anchored. Later Receipt validation failure must not retroactively change an already completed upstream Decision. | Backend implements only after the payload schema exists; Contract Owner reviews the implementation. |
| Duplicate / idempotency | **UNRESOLVED** | No duplicate, retry, restart, or uncertain-external-action default is approved. | Contract Owner and Backend propose idempotency and reconciliation semantics. |
| Access control | **UNRESOLVED** | No role, allowlist, pause, query, or retry permission model is approved. | Contract Owner prepares the security and access-control proposal. |
| Backend attestor signing | **APPROVED BOUNDARY; DETAILS UNRESOLVED** | Backend attestor signing remains separate from user Swap signing and may sign only an approved Receipt payload or commitment. Scheme, typed domain, key custody, rotation, and verification remain unapproved. | Contract Owner with security and operations input. |
| Deployment boundary | **DEFERRED** | No network, address, ABI, upgradeability, RPC, or deployment prerequisite is selected. | Contract Owner and Product/operations when anchoring is scheduled. |
| Explorer proof | **DEFERRED** | No explorer proof is required for a completed Decision, and no explorer representation is approved. | Contract Owner and Product after anchoring design. |
| Failure / retry | **APPROVED BOUNDARY; DURABLE SEMANTICS UNRESOLVED** | Signing/anchoring failure, timeout, or absence remains observable and non-blocking for an already completed Decision. Durable statuses, retryability, backoff, and recovery remain deferred. | Backend proposes mechanics; Contract Owner approves durable semantics. |
| Public API / lifecycle projection | **DEFERRED** | Receipt lifecycle stays internal. No Run, Replay, Re-run, public API field, requiredness, or separate-resource model is approved. | Backend proposes an additive projection with Product input; Contract Owner reviews it against the Evidence rules. |

## Cross-cutting rules retained

- Provider identity, declared capabilities, per-run `checkedScope` / `unknownScope`, provenance, and Core decision scope remain separate. Receipt processing must not manufacture Provider Evidence.
- Provider identity and provenance may be claimed only when the Provider was actually invoked and produced Evidence. A configured or selected adapter is not equivalent to observed Provider Evidence.
- `LIVE`, `MOCK`, and `RECORDED_REPLAY` remain distinct. Replay must not replace original Evidence acquisition time with replay time.
- `fetchedAt` and block context are acquisition facts only. Freshness or stale claims require a separately approved policy.
- Incomplete, unavailable, or failed Provider Evidence must not become successful Evidence merely because a Decision or Receipt lifecycle exists.
- Backend preparation provenance remains distinct from Provider evaluation-output provenance.
- Receipt signing or anchoring must not weaken upstream fail-closed Evidence handling.
- Backend attestor signing is never user Swap signing.

## Ownership and sequencing

- Backend Owner maintains this checklist, the BE-032 progress record, and the implementation boundary after confirmed decisions are recorded.
- Contract Owner owns the canonical Receipt semantics and has completed the current lifecycle-boundary review recorded in Issue #62.
- Provider Owner supplies factual Provider/Evidence and provenance constraints when Receipt decisions depend on them.
- Product, Risk, security, and operations owners participate when unresolved decisions affect user-facing behavior, policy, key custody, deployment, or operations.
- Backend must not create defaults for rows marked `UNRESOLVED` or `DEFERRED`.
- BE-GATE-006 must be re-evaluated after this checklist and the BE-032 progress record are updated.

## Completion record

- [x] Each decision-matrix row is marked `APPROVED BOUNDARY`, `UNRESOLVED`, or `DEFERRED`.
- [x] Every unresolved or deferred row has an owner and follow-up.
- [x] Confirmed non-blocking Decision/Receipt and Provider/Evidence boundaries are recorded.
- [x] No final Receipt schema, ABI, deployment address, event contract, or public API is inferred.
- [x] This checklist is synchronized with the Contract Owner decision matrix.
- [ ] BE-032 progress record is synchronized with this checklist and linked evidence.
- [ ] BE-GATE-006 is re-evaluated after the documentation sync.

## Out of scope for this phase

- Implementing the final Receipt contract or registry ABI;
- Selecting unresolved payload, serialization, signature, event, idempotency, access-control, deployment, proof, retry, or public-projection semantics by Backend convention;
- Deployment scripts, real RPC anchoring, explorer integration, or user Swap signing;
- Changing the existing non-blocking Decision behavior;
- Marking BE-032 or BE-GATE-006 complete before the progress record and Gate re-evaluation are updated.
