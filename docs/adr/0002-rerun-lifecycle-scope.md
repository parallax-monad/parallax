# ADR 0002: Re-run Lifecycle Scope

## Status

Accepted for `feat/api-rerun-lifecycle`.

## Decision

Re-run eligibility, immutable-baseline checks, Economic Boundary preservation,
and exact normalized Intent Diff construction are orchestrator application
concerns. They live in `packages/orchestrator/application/rerun.ts`.
`apps/api` remains responsible for request normalization, transport-facing
errors, Agent Flow invocation, and Run Store transitions.

One Re-run may change exactly one supported normalized Intent condition. A
token-pair change is represented as one `tokenPair` Diff entry. The effective
recipient is one condition; `recipientSource` is provenance and is not an
independent Diff field. The original Economic Boundary is preserved and is
not a Re-run condition.

When a child check ends in an Integration Error, its immutable Run envelope
including `parentRunId` and `diff` is retained by the Run Store and returned
alongside the API error response.

This PR intentionally does not reconstruct stage-aware partial Rule, Scope, or
Evidence state after an Agent Flow exception. The Agent Flow integration owns
that structured failure input; this PR's fallback envelope records only the
required interrupted simulation check and does not fabricate partial results.

This PR does not activate the verified `ADJUST` Action Gate. It does not
create baseline `ActionGateAttestation` Evidence, cross-Run Rule/Evidence
locators, or public recommendable transaction Actions. Those requirements
remain part of later Agent Flow and P0 integration work; this PR only creates
the child Run and Diff plumbing needed by that work.

## Consequences

The API cannot accept a multi-condition Re-run. A future Action Gate must
consume this single-condition Diff and independently prove the proposed effect
against the unchanged boundary before exposing an `ADJUST` Action.
