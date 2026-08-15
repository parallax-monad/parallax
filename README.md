<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

# Parallax

Parallax is a read-only, Moss-powered pre-transaction decision layer for Monad swaps.

> Moss tells us what will happen. Parallax helps the user decide what to do next.

## Demo

- [Try the live application](https://parallax-web-snowy.vercel.app)
- [View the Demo Day presentation](https://parallax-monad.github.io/parallax/parallax-demo-day.html)
- [Watch the product demo video](https://www.youtube.com/watch?v=j43WqH6TrTE)

No demo account is required. The public frontend connects to the deployed
backend through the Vercel API rewrite. This verified connection remains
experimental, read-only, and limited to the documented Moss/Kuru scope; it is
not a production-readiness or transaction-execution claim.

## Product thesis

Swap interfaces can expose quotes, warnings, and simulation output without connecting the observed cause to a bounded next action. Parallax turns traceable execution evidence into a scope-aware decision that a user can inspect and, when supported, test again after changing one relevant condition.

The core flow is:

```text
Swap intent
→ Moss quote/action/simulation evidence
→ normalized evidence
→ cause
→ PROCEED / ADJUST / STOP / UNKNOWN
→ relevant or irrelevant adjustment
→ optional re-run
→ Previous Run vs New Run
```

`UNKNOWN` is not a pass. `PROCEED` means no blocking evidence was found within the checked scope; it is not a safety guarantee or investment recommendation.

## Main features

- captures a structured, unsigned swap intent;
- obtains and normalizes quote, prepared-action, simulation, and provenance evidence;
- evaluates deterministic P0 rules and keeps Integration Error separate from transaction uncertainty;
- presents `PROCEED`, `ADJUST`, `STOP`, or `UNKNOWN` with checked, unknown, and not-checked scope;
- separates verified relevant adjustments from irrelevant changes;
- supports recorded replay and a bounded one-change re-run comparison;
- remains read-only: no signing, broadcasting, execution, custody, or wallet mutation.

## Demo flow

The landing page is available at `#/`. Choose **Try demo** to open the wallet-style MVP at `#/analyze`.

The MVP collects a supported swap intent, requests a quote, runs the pre-sign check, presents the evidence and scope behind the result, and supports recorded replay or a bounded re-run when applicable.

The frontend adapter on `main` calls `POST /api/quote`, `POST /api/check`, `GET /api/runs/:runId`, and `GET /api/replay/:id`. Local Vite development proxies those paths to the API process at `127.0.0.1:8787`.

## Current implementation status

| Area | Status on `main` |
| --- | --- |
| Landing experience | Implemented with English and Simplified Chinese copy and an interactive Three.js evidence constellation |
| Wallet-style frontend MVP | Implemented at `#/analyze` with quote, check, replay, evidence, and re-run UI |
| Frontend/API adapter | Implemented for `/api/quote`, `/api/check`, `/api/runs/:runId`, and `/api/replay/:id`; local Vite development proxies to the API |
| Shared contracts and decision rules | Implemented with automated tests for the current P0 slices |
| Backend API and orchestration | Implemented with Hono, configurable memory/PostgreSQL Run storage, live check/quote boundaries, and recorded replay |
| Live Moss/Kuru backend | Implemented for the pinned Kuru runtime and verified scope; requires explicit runtime and RPC configuration |
| Public Vercel demo | Frontend is publicly reachable and routes same-origin `/api/*` requests to the deployed Render backend through the Vercel rewrite |
| Signing, broadcasting, execution, or custody | Intentionally not implemented |

The verified live evidence is limited to the documented pinned Kuru MON → USDC path and runtime scope. It does not establish support for every pair, protocol, asset behavior, runtime revision, or future market condition.

## P0 scope and exclusions

P0 focuses on a light DeFi user who is about to sign a Monad swap or retry after a failure. It covers evidence-backed cause, scope disclosure, a bounded decision, verified action visibility, and optional re-run comparison.

P0 does not provide:

- investment advice or a claim that a transaction is safe;
- best-price, best-route, or whole-market aggregation;
- a complete protocol, token, or smart-contract security audit;
- automatic signing, broadcasting, execution, or custody;
- autonomous AI judgment;
- guaranteed live availability when RPC, Moss, or required evidence is unavailable.

A user-supplied `Minimum Received` is an explicit acceptance boundary. Parallax does not lower it to manufacture `PROCEED`.

## Architecture and technology stack

| Path | Responsibility |
| --- | --- |
| `apps/web` | React 18 + Vite frontend, landing experience, wallet-style MVP, API adapter, and Three.js visualization |
| `apps/api` | Node.js/Hono HTTP runtime for live quote/check and recorded replay |
| `packages/contracts` | Shared schemas, normalized Intent/Run types, Evidence, Replay, and serialization |
| `packages/moss-bridge` | Moss/Kuru runtime loading, live execution-evidence adapter, normalization, and provenance checks |
| `packages/orchestrator` | Agent Flow, re-run lifecycle, Action Gate, and application orchestration |
| `packages/risk` | Deterministic P0 rule evaluation and centralized decision policy |
| `fixtures` | Recorded raw/normalized Evidence and replay fixtures |
| `docs` | Product, research, risk methodology, integration, ADR, and runtime documentation |
| `scripts` | Deterministic and live Kuru smoke/acceptance tooling |

The principal toolchain is Node.js 22, pnpm, TypeScript, React, Vite, Three.js, Hono with the Node server runtime, Vitest, and Biome.

## Repository structure

```text
apps/
  api/                 Backend API and runtime composition
  web/                 Landing page and wallet-style frontend MVP
packages/
  contracts/           Shared contracts and serialization
  moss-bridge/         Moss/Kuru adapter and normalization
  orchestrator/        Agent Flow and application lifecycle
  risk/                Rule and decision logic
fixtures/              Evidence and replay fixtures
docs/                  Product, research, integration, methodology, and ADRs
scripts/               Smoke and repository-validation scripts
```

## Installation and local development

Requirements:

- Node.js 22;
- pnpm 11-compatible tooling;
- Git.

Install dependencies and create a local environment file:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Start the frontend:

```bash
pnpm --filter @parallax/web dev
```

Open the Vite URL and use `#/` for the landing page or `#/analyze` for the MVP.

To use quote and check requests locally, configure `.env` and start the API in a separate terminal:

```bash
pnpm --filter @parallax/api start
```

The Vite development server proxies `/api/*` to `http://127.0.0.1:8787`.

## Environment configuration

`.env.example` is the authoritative variable list.

| Variable | Purpose |
| --- | --- |
| `MONAD_RPC_URL` | Read-only Monad RPC used by backend live quote/check requests |
| `MOSS_RPC_URL` | Read-only RPC used by the local live-smoke command; not consumed automatically by the backend |
| `MOSS_RUNTIME_VERSION` | Expected Moss package/runtime version |
| `MOSS_RUNTIME_REVISION` | Expected immutable Moss Git revision |
| `MOSS_RUNTIME_PATH` | Optional absolute path to the built, pinned Moss Git checkout; enables the live Kuru Agent Flow |
| `PARALLAX_TOKEN_REGISTRY_JSON` | Trusted token metadata consumed by backend normalization |
| `CORS_ORIGIN` | Browser origin allowed to call the API |
| `RUN_STORE_BACKEND` | Run lifecycle persistence backend (`memory` by default; use `postgres` only after migration) |
| `DATABASE_URL` | PostgreSQL connection URL required when `RUN_STORE_BACKEND=postgres` |
| `HOST` / `PORT` | Node HTTP listener configuration |

The live backend requires the Moss checkout at `MOSS_RUNTIME_PATH` to retain its `.git` metadata, match the configured version/revision, and be readable by a runtime with `git` available. Without that path, live quote/check requests fail closed as `UNSUPPORTED`; recorded replay remains a separate, explicitly labelled path.

Never commit RPC credentials or populated `.env` files.

## Development commands

```bash
pnpm lint                         # Biome checks
pnpm typecheck                    # root and workspace TypeScript checks
pnpm test                         # deterministic Vitest suite
pnpm test:acceptance              # backend P0 acceptance matrix
pnpm test:integration             # real Node listener integration test
pnpm --filter @parallax/web build # production frontend build
pnpm smoke:kuru                   # deterministic Kuru smoke
pnpm smoke:kuru:live              # external live Moss/RPC smoke
```

`pnpm smoke:kuru:live` requires the pinned Moss runtime and read-only RPC configuration. It is not part of the default CI path.

## API overview

### `POST /api/quote`

Runs the exact-input live quote boundary before form submission. It returns an available quote, an explicit no-route/unavailable result, or a scoped error. It does not run the full simulation or produce a transaction decision.

### `POST /api/check`

Runs the backend-owned pre-sign check. A request carries a normalized swap Intent; successful processing returns a completed or Integration Error Run envelope. A re-run uses the same endpoint with `parentRunId` and exactly one allowed Intent change.

If live Moss is not configured, the endpoint returns an explicit `UNSUPPORTED` application error and an `UNKNOWN` Run. It never substitutes recorded replay for a live result.

### `GET /api/runs/:runId`

Returns one persisted Check Run by ID. The response preserves `started` Runs
without fabricating a receipt; completed and failed Runs include their stored
result. This supports page refresh and receipt recovery after the frontend has
received and persisted the `runId`, when the configured RunStore is durable.
An in-flight Check cannot be automatically recovered after refresh because the
current API assigns its Run ID server-side and does not expose SSE or job
polling. It does not provide a public history list by sender.

### `GET /api/replay/:id`

Returns a frozen recorded replay fixture. Replay preserves recorded provenance but is not a current live Run and cannot be used as a live check parent.

See the [frontend API handoff](docs/integration/api-frontend-handoff.md) for payloads, error mappings, CORS, and startup details.

## Deployment

The frontend demo is publicly deployed on Vercel:

**[https://parallax-web-snowy.vercel.app](https://parallax-web-snowy.vercel.app)**

No demo account is required. The public frontend routes same-origin `/api/*`
requests through Vercel to the deployed Render backend. The documented Kuru
MON → USDC quote flow has been verified through that public origin. Availability
still depends on the external backend, RPC, and pinned Moss runtime, and the
deployment is not a production-readiness or broader protocol-support claim.

## Documentation map

### Product

- [Product Requirements Document](docs/product/prd.md)
- [Product Delivery specification](docs/product/product-delivery.md)

### Research

- [User Research](docs/research/user-research.md)
- [Competitive Analysis](docs/research/competitive-analysis.md)

### Integration and evidence

- [Frontend API handoff](docs/integration/api-frontend-handoff.md)
- [Backend P0 acceptance matrix](docs/integration/backend-p0-acceptance.md)
- [Moss/Kuru live runtime](docs/integration/moss-kuru-live-runtime.md)
- [P0 Rule and Reason-to-Action specification](docs/risk-methodology/p0-rule-and-reason-action-spec.md)
- [Architecture Decision Records](docs/adr/)

## Testing and quality gates

GitHub Actions uses Node.js 22 and runs:

```text
pnpm install --frozen-lockfile
→ pnpm lint
→ pnpm typecheck
→ pnpm test
→ pnpm test:integration
```

Live RPC/Moss smoke tests are intentionally separate because they require external runtime configuration. Evidence and runtime claims must remain scoped to the exact recorded fixture and pinned revision.

## Team

| Member | GitHub | Area |
| --- | --- | --- |
| Kai | [@chin0312](https://github.com/chin0312) | Product, research, and demo |
| Rei | [@rainypilgrimage](https://github.com/rainypilgrimage) | Product, risk methodology, and research |
| Jie | [@jzhao0](https://github.com/jzhao0) | Moss integration and risk engine |
| Clare | [@brightheartma](https://github.com/brightheartma) | API, backend, orchestration, and deployment |
| Antony | [@antony819](https://github.com/antony819) | Web frontend |

## Collaboration

- Start work from the latest `main` on a short-lived branch.
- Keep runtime, Contract, product-copy, and Evidence claims in their owning layers.
- Do not use recorded replay or mock data as proof of a live user decision.
- Run the relevant checks before opening a pull request.
- Request review from the owners of the files and semantics changed.

## Disclaimer

Parallax is experimental software for explaining and testing pre-transaction decisions. It does not provide investment advice and does not sign, broadcast, execute, or custody transactions. Evidence may be incomplete or unavailable; users must independently verify transaction details and understand that `PROCEED` is scope-bounded, not a guarantee of safety.
