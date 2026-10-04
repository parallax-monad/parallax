# Parallax Documentation

This index separates the public product overview, current developer references, and
dated research or project-history records. It is navigation, not a second tracker.
For current implementation behavior, use merged code and the directly relevant
integration reference; dated plans and research are not claims that a capability is
shipped.

## Start here

- [Public product overview](../README.md) — what Parallax does, current Arbitrum testnet
  scope, demo links, Registry, SDK, and project boundaries.
- [Pitch presentation](./demo/parallax-demo-day/README.md) — published seven-slide deck
  and local viewing instructions.
- [Product decision and remediation model](./product/p0-economic-diagnosis-remediation.md)
  — Product-side semantics and intended workflow.
- [Product delivery](./product/product-delivery.md) — user-visible states, scope disclosure,
  and delivery boundaries.

## Developer references

- [Typed TypeScript SDK](../packages/sdk/README.md) — public API client and example.
- [Decision Registry guide](../contracts/decision-registry/README.md) — optional,
  operator-triggered Arbitrum Sepolia anchoring and verification.
- [Frontend/API handoff](./integration/api-frontend-handoff.md) — API payload and
  presentation details. Some sections are path- or date-specific; verify current behavior
  against the API contracts and implementation before relying on older coordination notes.
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
  not the current Arbitrum deployment claim.
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
- [Arbitrum ecosystem and stack](./research/arbitrum-ecosystem-and-stack.md) — ecosystem
  and technical-selection research.
- [Explorer Evidence feasibility](./research/be-108-explorer-evidence-feasibility.md) —
  partial feasibility findings and qualification limits.
- Provider handoffs and qualification records: [Native RPC](./research/native-rpc-provider-handoff-p0.md),
  [Tenderly](./research/be-072-tenderly-provider-handoff.md),
  [Moss/Kuru](./research/be-033-moss-provider-handoff.md), and
  [GenericEvidence field mapping](./research/be-033-moss-field-mapping.md).

## Historical integration records

- [Arbitrum UI implementation snapshot](./integration/arbitrum-ui-implementation.md) —
  dated implementation notes; verify current behavior against code and live references.
- [Monad × Kuru runtime record](./integration/moss-kuru-live-runtime.md) — historical
  compatibility-path runtime evidence, not the current Arbitrum route.
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
