# Decision Receipt Contract Owner Review Checklist

Status: **BE-032 prepared for Contract Owner Review; no items below are confirmed contract semantics.**

This checklist records the open Receipt decisions needed before any public Receipt schema, registry ABI, deployment, or production anchoring work. The current backend implementation intentionally keeps Receipt payloads opaque and only provides optional, non-blocking `ReceiptSigner` / `ReceiptAnchorer` ports with deterministic local fakes.

## Decisions required

| Area | Open decision | Current implementation boundary |
| --- | --- | --- |
| Receipt payload fields | Contract Owner Review: define the canonical payload fields, required/optional fields, field encoding, versioning, and whether `runId`, Intent, Evidence, Decision, provenance, timestamps, and adapter outcomes are included. | No Receipt schema is defined. The lifecycle accepts an opaque payload supplied by the application seam. |
| Commitment / hash | Contract Owner Review: choose the commitment preimage, canonical serialization, hash algorithm, domain separator, and version migration rules. | No hash or commitment is computed. |
| Events | Contract Owner Review: define registry event names, indexed fields, event payloads, and whether sign/anchor lifecycle transitions are emitted. | No ABI or events are implemented. |
| Validation | Contract Owner Review: define validation rules, canonicalization, size limits, timestamp/freshness checks, provenance requirements, and invalid-payload behavior. | The lifecycle only observes adapter success, failure, and timeout; it does not validate Receipt fields. |
| Duplicate semantics | Contract Owner Review: define whether duplicate commitments are idempotent, rejected, replaceable, or associated with a new attestation/version. | No deduplication or registry lookup is performed. |
| Access control | Contract Owner Review: define who may submit, query, replace, or invalidate a Receipt and whether authorization is role-, signature-, or registry-based. | No access control or user-wallet authorization is implemented. |
| Backend attestor signature | Contract Owner Review: select the signature scheme, key custody/rotation, attestor identity binding, domain separation, and verification rules. | The signer is an opaque optional backend-attestor port; it never signs a user Swap. |
| Deployment network | Contract Owner Review: confirm target network(s), chain IDs, deployment addresses, confirmation/finality policy, and environment separation. | No deployment target or RPC integration is selected. |
| Explorer proof | Contract Owner Review: define the explorer(s), URL construction, proof fields, and whether explorer availability is advisory or validation-critical. | No explorer URL or on-chain proof is generated. |
| Failure and retry status | Contract Owner Review: define durable states, retry ownership, idempotency keys, backoff, terminal failure rules, and whether signing and anchoring retry independently. | The local lifecycle reports `not_configured`, `pending`, `signed`, `anchored`, `failed`, or `timed_out`; adapter errors remain observable and do not block Decision return. |

## Current lifecycle behavior for review

- Decision execution is awaited first.
- Receipt preparation, signing, and anchoring are optional and controlled by an observable lifecycle handle returned by the internal Backend Pipeline execution.
- When both adapters are configured, signing is attempted before anchoring; anchoring is skipped if signing fails or times out.
- A successful signer without an anchorer is reported as `signed`; a successful anchorer without a signer is reported as `anchored` and remains a Contract Owner decision for production semantics.
- Adapter failures and timeout errors are retained in the lifecycle snapshot. They are not converted into a successful Decision and do not become unhandled background rejections.
- No public Run/Replay/Re-run/Action Gate response schema is changed by this preparation.

## Explicitly excluded from BE-030/031

- Final on-chain Receipt schema or registry contract ABI
- Commitment/hash implementation
- Deployment scripts or network configuration
- Real RPC, Moss, Tenderly, or production anchoring integration
- User Swap signing, broadcasting, custody, or wallet mutation
