<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

# Parallax

Parallax is a provider-agnostic pre-execution remediation and re-verification layer for onchain actions.

**Current public demo scope:** Monad × Kuru × Moss.

> Parallax turns heterogeneous transaction evidence into a deterministic cause and relevant action, then verifies whether the adjustment actually fixed the problem.

## Demo

- [Try the live application](https://parallax-web-snowy.vercel.app)
- [View the Demo Day presentation](https://parallax-monad.github.io/parallax/parallax-demo-day.html)
- [Watch the product demo video](https://www.youtube.com/watch?v=j43WqH6TrTE)

## Project thesis

A transaction can be valid, executable, and free of an obvious malicious signal while still failing the user's intent. Parallax organizes the evidence available before execution into a bounded decision and makes the missing evidence explicit.

The core flow is:

```text
Intent
→ Evidence
→ Cause
→ Decision
→ Relevant Action
→ Re-verification
```

`UNKNOWN` is not a pass. `PROCEED` means that no blocking evidence was found within the checked scope; it is not a safety guarantee or investment advice.

## What Parallax does

- accepts a structured, unsigned Swap Intent;
- obtains and normalizes quote, prepared-action, simulation, and provenance Evidence;
- evaluates deterministic decision rules while keeping Integration Error separate from transaction uncertainty;
- presents `PROCEED`, `ADJUST`, `STOP`, or `UNKNOWN` with checked, not-checked, and unknown scope;
- separates a verified Relevant Action from changes that the result does not support;
- supports recorded Replay and a bounded one-condition Re-run comparison;
- remains read-only: it does not sign, broadcast, execute, or custody the user's transaction.

## Demo flow

The landing page is served at `#/`. The wallet-style MVP is at `#/analyze`.

1. Enter a supported Swap Intent.
2. Request a quote and run the pre-sign check.
3. Review Evidence, provenance, scope, Cause, and Decision.
4. When the result supports it, change one relevant condition and run again.
5. Compare the Previous Run with the New Run.

The current frontend adapter calls `POST /api/quote`, `POST /api/check`, `GET /api/runs/:runId`, and `GET /api/replay/:id`. Recorded Replay is a separate, explicitly labelled path and is never substituted for a live check.

## Current demo scope

The current public demo uses the Monad × Kuru × Moss path. Its verified live scope is limited to the documented pinned Kuru MON → USDC path and runtime identity; this does not establish support for every asset, route, protocol, runtime revision, or future market condition.

## P0 scope and exclusions

P0 uses a light DeFi user who is about to sign a Monad Swap or retry after a failure as its working user hypothesis. It focuses on evidence-backed Cause, scope disclosure, a bounded Decision, relevant-action visibility, and optional Re-verification.

P0 does not provide:

- investment advice or a claim that a transaction is safe;
- best-price, best-route, or whole-market aggregation;
- a complete protocol, token, or smart-contract security audit;
- automatic signing, broadcasting, execution, or custody;
- autonomous AI judgment;
- guaranteed availability when RPC, Moss, or required Evidence is unavailable.

In the current Monad MVP, `economicBoundary.minimumReceived` is an explicit acceptance boundary carried with the Intent. Its provenance may be `original_swap`, `user_declared`, `demo_preset`, or `unavailable`; Parallax does not lower it to manufacture `PROCEED`.

## Architecture and technology stack

The long-term decomposition is:

```text
Chain × Protocol × Evidence Provider
```

| Path | Responsibility |
| --- | --- |
| `apps/web` | React 18 + Vite frontend, landing experience, wallet-style MVP, API adapter, and Three.js visualization |
| `apps/api` | Node.js/Hono HTTP runtime for live quote/check and recorded Replay |
| `packages/contracts` | Shared Intent, Run, Evidence, Replay, serialization, and compatibility schemas |
| `packages/moss-bridge` | Moss/Kuru runtime loading, live Evidence adapter, normalization, and provenance checks |
| `packages/orchestrator` | Agent Flow, Action Gate, Re-run lifecycle, and application orchestration |
| `packages/risk` | Deterministic P0 rule evaluation and centralized Decision policy |
| `fixtures` | Recorded raw/normalized Evidence and Replay fixtures |
| `docs` | Product, research, planning, integration, methodology, and ADR references |
| `scripts` | Deterministic and live Kuru smoke/acceptance tooling |

The current toolchain is Node.js 22, pnpm, TypeScript, React, Vite, Three.js, Hono, Vitest, and Biome.

## Repository structure

```text
apps/                  Frontend and backend applications
packages/              Contracts, Moss bridge, orchestration, and risk
docs/                  Product, research, planning, integration, and ADRs
fixtures/              Evidence and Replay fixtures
scripts/               Smoke and repository-validation tooling
```

## Installation and local development

Requirements: Node.js 22, pnpm 11-compatible tooling, and Git.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Start the frontend:

```bash
pnpm --filter @parallax/web dev
```

Use `#/` for the landing page and `#/analyze` for the MVP. To run local quote/check requests, configure `.env` and start the API in another terminal:

```bash
pnpm --filter @parallax/api start
```

The local Vite server proxies `/api/*` to `http://127.0.0.1:8787`.

## Environment configuration

`.env.example` is the authoritative variable list.

| Variable | Purpose |
| --- | --- |
| `MONAD_RPC_URL` | Read-only Monad RPC for backend live quote/check requests |
| `MOSS_RPC_URL` | Read-only RPC for the live smoke command |
| `MOSS_RUNTIME_VERSION` | Expected Moss runtime version |
| `MOSS_RUNTIME_REVISION` | Expected immutable Moss Git revision |
| `MOSS_RUNTIME_PATH` | Absolute path to the built, pinned Moss checkout; enables the live Kuru Agent Flow |
| `PARALLAX_TOKEN_REGISTRY_JSON` | Trusted token metadata for backend normalization |
| `CORS_ORIGIN` | Browser origin allowed to call the API |
| `RUN_STORE_BACKEND` | `memory` by default; use `postgres` only after migration and verification |
| `DATABASE_URL` | PostgreSQL URL required when `RUN_STORE_BACKEND=postgres` |
| `HOST` / `PORT` | Node HTTP listener settings |

Live Moss operation requires `MOSS_RUNTIME_PATH` to retain `.git` metadata and match the configured version/revision. Without it, live quote/check requests fail closed as `UNSUPPORTED`; recorded Replay remains separate.

Never commit RPC credentials or populated `.env` files.

## Development commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:acceptance
pnpm test:integration
pnpm --filter @parallax/web build
pnpm smoke:kuru
pnpm smoke:kuru:live
```

The live smoke requires the pinned Moss runtime and read-only RPC configuration and is not part of the default CI path.

## API overview

### `POST /api/quote`

Runs the exact-input live quote boundary. It returns a quote, an explicit unavailable/no-route result, or a scoped error; it does not run the full simulation or create a Decision.

### `POST /api/check`

Runs the backend pre-sign check for a normalized Swap Intent. A Re-run uses `parentRunId` and exactly one allowed Intent change. If live Moss is not configured, the endpoint returns an explicit `UNSUPPORTED` error and an `UNKNOWN` Run rather than substituting Replay.

### `GET /api/runs/:runId`

Returns one persisted Check Run by ID. Durable PostgreSQL storage can recover completed/failed Runs after restart; an in-flight Run is not fabricated into a receipt.

### `GET /api/replay/:id`

Returns a frozen recorded Replay fixture. It preserves recorded provenance but is not a current live Run and cannot be used as a live Check parent.

See the [frontend API handoff](docs/integration/api-frontend-handoff.md) for payloads, errors, CORS, and startup details.

## Deployment

The public frontend deployment is configured on Vercel with a same-origin `/api/*` rewrite to the deployed Render backend. Availability depends on the external backend, RPC, and pinned Moss runtime; the deployment is not a production-readiness claim and does not expand the verified protocol scope.

## Documentation map

### Product

- [Product Requirements Document](docs/product/prd.md)
- [Product Delivery specification](docs/product/product-delivery.md)

### Research

- [User Research](docs/research/user-research.md)
- [Competitive Analysis](docs/research/competitive-analysis.md)
- [Market positioning and evidence](docs/research/market-positioning-and-evidence.md)
- [Arbitrum ecosystem and stack](docs/research/arbitrum-ecosystem-and-stack.md)

### Planning

- [Arbitrum Open House planning index](docs/planning/arbitrum-open-house/README.md)
- [02 Overview](docs/planning/arbitrum-open-house/02-overview.md)
- [02-A Architecture boundaries](docs/planning/arbitrum-open-house/02-A-architecture-boundaries.md)
- [02-B Provider implementation](docs/planning/arbitrum-open-house/02-B-provider-implementation.md)
- [02-C Ownership and collaboration](docs/planning/arbitrum-open-house/02-C-ownership-collaboration.md)
- [02-D Acceptance and timeline](docs/planning/arbitrum-open-house/02-D-acceptance-timeline.md)

### Integration and evidence

- [Frontend API handoff](docs/integration/api-frontend-handoff.md)
- [Backend P0 acceptance matrix](docs/integration/backend-p0-acceptance.md)
- [Moss/Kuru live runtime](docs/integration/moss-kuru-live-runtime.md)
- [P0 rule and Reason-to-Action specification](docs/risk-methodology/p0-rule-and-reason-action-spec.md)
- [Architecture Decision Records](docs/adr/)

## Testing and quality gates

GitHub Actions uses Node.js 22 and runs dependency installation, lint, typecheck, deterministic tests, and the Node integration test. Live RPC/Moss smoke tests are separate because they require external runtime configuration.

## Team

| Member | GitHub | Role |
| --- | --- | --- |
| Kai | [@chin0312](https://github.com/chin0312) | Product Owner |
| Rei | [@rainypilgrimage](https://github.com/rainypilgrimage) | Contract Owner |
| Jie | [@jzhao0](https://github.com/jzhao0) | Provider Owner |
| Clare | [@brightheartma](https://github.com/brightheartma) | Backend Owner |
| Antony | [@antony819](https://github.com/antony819) | Frontend Owner |

## Collaboration

- Start from the latest `main` on a short-lived branch.
- Keep implementation, Contract semantics, Product semantics, and Evidence claims in their owning layers.
- Treat research as context; implementation behavior is defined by the code and merged product documentation.
- Do not use Replay or mock data as proof of a live user decision.
- Run the relevant checks and request review from the owners of the changed semantics.

## Disclaimer

Parallax is experimental software for explaining and testing bounded pre-execution decisions. It does not provide investment advice and does not sign, broadcast, execute, or custody transactions. Evidence may be incomplete or unavailable; users must independently verify transaction details. `PROCEED` is scope-bounded, not a guarantee of safety.

## License

No repository license file is currently declared. Licensing remains a team decision.
