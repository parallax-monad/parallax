# Parallax Documentation

This is the canonical index for Product, architecture, implementation planning, research, integration, and historical decision records. It is a navigation layer, not a second copy of each document.

## Start here

If you are new to Parallax:

1. Read the [root README](../README.md) for the Product loop and boundaries.
2. Read the [P0 Economic Diagnosis & Remediation specification](./product/p0-economic-diagnosis-remediation.md).
3. Read the [architecture boundaries](./planning/arbitrum-open-house/02-A-architecture-boundaries.md).
4. Open the implementation-area document relevant to your change.

If you are implementing a feature, start from its owning specification and acceptance document rather than searching the entire tree.

## Product

- [P0 Economic Diagnosis & Remediation](./product/p0-economic-diagnosis-remediation.md) — Product-side model for diagnosis, quantified remediation, and state-bound re-verification.
- [Product Requirements Document](./product/prd.md) — Monad MVP P0 Product specification.
- [Product Delivery](./product/product-delivery.md) — user-facing state semantics, scope disclosure, and delivery boundaries.

## Architecture and implementation planning

- [Arbitrum Open House planning index](./planning/arbitrum-open-house/README.md) — planning hierarchy, normative documents, and reading order.
- [02 Overview](./planning/arbitrum-open-house/02-overview.md) — baseline, target path, constraints, and stage structure.
- [02-A Architecture boundaries](./planning/arbitrum-open-house/02-A-architecture-boundaries.md) — Chain × Protocol × Evidence Provider and Core boundaries.
- [02-B Provider implementation](./planning/arbitrum-open-house/02-B-provider-implementation.md) — Provider order, stages, and portability tests.
- [02-C Ownership and collaboration](./planning/arbitrum-open-house/02-C-ownership-collaboration.md) — semantic ownership and review boundaries.
- [02-D Acceptance and timeline](./planning/arbitrum-open-house/02-D-acceptance-timeline.md) — stage gates, failure matrix, deadlines, and unresolved dependencies.

## Risk and decision semantics

- [P0 Rule and Reason-to-Action specification](./risk-methodology/p0-rule-and-reason-action-spec.md) — deterministic rule, Cause, Decision, and Action semantics.

## Integration

- [Frontend API handoff](./integration/api-frontend-handoff.md) — frontend payloads, errors, CORS, and startup details.
- [Backend P0 acceptance](./integration/backend-p0-acceptance.md) — backend acceptance matrix and boundaries.
- [Moss/Kuru live runtime](./integration/moss-kuru-live-runtime.md) — pinned runtime, provenance, and live-operation requirements.

## Research

- [User Research](./research/user-research.md) — interviews, observed behavior, pain points, and research limits.
- [Competitive Analysis](./research/competitive-analysis.md) — dated Monad MVP competitive research snapshot.
- [Market positioning and evidence](./research/market-positioning-and-evidence.md) — market evidence, positioning hypotheses, and claim boundaries.
- [Arbitrum ecosystem and stack](./research/arbitrum-ecosystem-and-stack.md) — ecosystem rationale and Provider/stack selection research.
- [BE-011 Provider Owner input package](./research/be-011-provider-input-package.md) — Provider capability evidence inventory and machine-readable fixture index for BE-011. The pre-guard Native RPC capture (`arbitrum-sepolia-public-2026-09-08`) is retained as `HISTORICAL_PRE_GUARD_CAPTURE` and is superseded for canonical qualification.

## Architecture decisions

- [ADR directory](./adr/) — durable architecture decision records, including the Kuru baseline and Re-run lifecycle scope.

## Demo

- [Demo documentation](./demo/) — presentation and local review materials.

## Reading boundaries

Code and merged implementation documentation define current implementation truth. The planning set defines the normative plan and acceptance gates; research provides rationale and evidence. Planned capabilities are not implementation or deployment claims unless the code and merged integration documentation verify them.
