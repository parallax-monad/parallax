# Parallax Documentation

This index separates the public product overview, current developer references, and
dated research or project-history records. It is navigation, not a second tracker.
For current implementation behavior, use merged code and the directly relevant
integration reference; dated plans and research are not claims that a capability is
shipped.

## Start here

- [Public product overview](../README.md) — what Parallax does, current Arbitrum testnet
  scope, demo links, Registry, SDK, and project boundaries.
- [Contributing guide](../CONTRIBUTING.md) — current local setup, owner boundaries, and
  pull request validation.
- [Pitch presentation](./demo/parallax-demo-day/README.md) — published seven-slide deck
  and local viewing instructions.
- [Product decision and remediation model](./product/p0-economic-diagnosis-remediation.md)
  — Product-side intent; frozen semantics are governed by Issue #70 and implementation
  maturity should be checked against live code/issues.
- [Product delivery snapshot](./product/product-delivery.md) — retained Product/UI boundary
  and historical implementation context; not a current live status record.

## Developer references

- [Typed TypeScript SDK](../packages/sdk/README.md) — public API client and example.
- [Decision Registry guide](../contracts/decision-registry/README.md) — optional,
  operator-triggered Arbitrum Sepolia anchoring and verification.
- [Frontend/API handoff](./integration/api-frontend-handoff.md) — API payload and
  presentation details, with a historical Monad/Moss handoff and later Arbitrum addenda;
  verify current behavior against API contracts and implementation.
- [Backend P0 acceptance reference](./integration/backend-p0-acceptance.md) — engineering
  acceptance cases and their limits.
- [Basic Simulation and Risk policy](./integration/basic-simulation-risk-policy.md) —
  implementation-boundary reference for execution facts and Risk.
- [Verified Remediation feasibility record](./integration/verified-remediation-107-blocker.md)
  — evidence and boundaries for the current uncompleted Verified Remediation gate.
- [Receipt contract-owner review](./integration/receipt-contract-owner-review.md) —
  historical review record; not a requirement for the current optional Registry.

## Product, Risk, and architecture references

- [Product Requirements Document](./product/prd.md) — historical Monad MVP requirements;
  not the current supported integration or product-scope authority.
- [P0 Rule and Reason-to-Action specification](./risk-methodology/p0-rule-and-reason-action-spec.md)
  — decision-rule, Cause, and Action semantics.
- [ADR directory](./adr/) — accepted architecture decisions, including Run/re-check scope.
- [Arbitrum Open House planning index](./planning/arbitrum-open-house/README.md) — dated
  planning hierarchy and stage documents. Treat these as planning/history unless a current
  implementation reference confirms the capability.

## Research and evidence

- [User Research](./research/user-research.md) — interview synthesis, evidence levels,
  limitations, and hypotheses.
- [Competitive Analysis](./research/competitive-analysis.md) — dated market comparison;
  use as research context, not a claim of exclusive capabilities.
- [Market positioning and evidence](./research/market-positioning-and-evidence.md) —
  positioning hypotheses and public-claim boundaries.
- [Arbitrum ecosystem and stack](./research/arbitrum-ecosystem-and-stack.md) — dated
  ecosystem and technical-selection research; implementation status has since advanced.
- [Explorer Evidence feasibility](./research/be-108-explorer-evidence-feasibility.md) —
  partial feasibility findings and qualification limits.
- Current execution-evidence roles: Native RPC is the primary path and Trace RPC is
  supplementary. Dated Provider handoff records include [Native RPC](./research/native-rpc-provider-handoff-p0.md)
  and [Tenderly](./research/be-072-tenderly-provider-handoff.md); the Tenderly record does
  not establish a runtime-qualified integration.

## Historical integration records

- [Monad × Kuru / Moss provider handoff](./research/be-033-moss-provider-handoff.md) and
  [GenericEvidence field mapping](./research/be-033-moss-field-mapping.md) — retained
  historical technical context, not prerequisites for the current Arbitrum product path.
- [Arbitrum UI implementation snapshot](./integration/arbitrum-ui-implementation.md) —
  dated implementation notes; verify current behavior against code and live references.
- [Monad × Kuru runtime record](./integration/moss-kuru-live-runtime.md) — historical
  compatibility-path runtime evidence, not the current Arbitrum route.
- [Historical frontend API integration summary](../apps/web/API_INTEGRATION_SUMMARY.md) —
  retained earlier integration notes, not a current implementation specification.
- [Provider input package](./research/be-011-provider-input-package.md) — dated capability
  inventory and retained historical captures.

## Project history and operations

- [Agent contract](../AGENTS.md) and [Runbook](../RUNBOOK.md) — contributor operating rules.
- [Context recovery](./context/CONTEXT_RECOVERY.md), [Project State](./context/PROJECT_STATE.md),
  [Decision Log](./context/DECISION_LOG.md), [Agent Handoff](./context/AGENT_HANDOFF.md),
  and [Mutation Ledger](./context/MUTATION_LEDGER.md) — durable internal recovery and
  history snapshots, not the live issue tracker.
- [Final Sprint GitHub tracker](https://github.com/parallax-monad/parallax/issues/96) —
  live execution status for contributors.

GitHub Issues and merged PRs carry live execution and acceptance state. These documents
provide product references, implementation guidance, research, or historical context;
when their status text is dated, fresh GitHub state and the current implementation take
precedence.

## Maintainer proposals

- [Runtime Decoupling proposal](./proposals/runtime-decoupling.md) — unapproved technical
  proposal addressing legacy environment and Docker coupling; it is not an implementation
  plan or current runtime contract.
