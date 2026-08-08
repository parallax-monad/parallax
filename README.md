# Parallax

Parallax is a read-only, Moss-powered pre-transaction decision layer for Monad swaps.

> Moss tells us what will happen. Parallax helps the user decide what to do next.

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
→ previous vs new result
```

`UNKNOWN` is not a pass. `PROCEED` means no blocking evidence was found within the checked scope; it is not a safety guarantee or investment recommendation.

## What Parallax does

- captures a structured, unsigned swap intent;
- obtains and normalizes quote, prepared-action, simulation, and provenance evidence;
- evaluates deterministic P0 rules and keeps Integration Error separate from transaction uncertainty;
- presents `PROCEED`, `ADJUST`, `STOP`, or `UNKNOWN` with checked, unknown, and not-checked scope;
- separates verified relevant adjustments from irrelevant changes;
- supports recorded replay and a bounded one-change re-run comparison;
- remains read-only: no signing, broadcasting, custody, or wallet mutation.

## Demo flow

The landing page is available at `#/`. Choose **Try demo** (or **体验 Demo**) to open the wallet-style MVP at `#/analyze`.

The frontend currently on `main` demonstrates the decision experience with deterministic local fixture logic. The backend API and live Moss/Kuru runtime path are implemented separately; frontend-to-backend MVP wiring is still being integrated and is not represented as complete on `main`.

## Current implementation status

Status as of **2026-08-08**:

| Area | Status on `main` |
| --- | --- |
| Landing experience | Implemented with English/Simplified Chinese copy and an interactive Three.js evidence constellation |
| Wallet-style frontend MVP | Implemented at `#/analyze` using deterministic demo fixtures |
| Shared contracts and verdict rules | Implemented with automated tests for the current P0 slices |
| Backend API and orchestration | Implemented with Hono, `POST /api/check`, process-local Run storage, and recorded Replay |
| Recorded Replay | Implemented at `GET /api/replay/:id`; never used as a silent live-check fallback |
| Live Moss/Kuru backend | Landed for the pinned Kuru runtime and verified fixture scope; requires explicit runtime configuration |
| Frontend-to-backend connection | In progress outside `main`; the current frontend still uses its local demo service |
| Signing/broadcasting/custody | Intentionally not implemented |

The live evidence proves a specific pinned Kuru MON → USDC simulation path. It does not prove every pair, protocol, runtime revision, asset behavior, or future market condition.

## P0 scope and exclusions

P0 focuses on a light DeFi user who is about to sign a Monad swap or retry after a failure. It covers evidence-backed cause, scope disclosure, a bounded verdict, verified action visibility, and optional re-run comparison.

P0 does not provide:

- investment advice or a claim that a transaction is safe;
- best-price, best-route, or whole-market aggregation;
- a complete protocol, token, or smart-contract security audit;
- automatic signing, broadcasting, execution, or custody;
- autonomous AI judgment;
- guaranteed live availability when RPC, Moss, or required evidence is unavailable.

A user-supplied `Minimum Received` is an explicit acceptance boundary. Parallax does not lower it to manufacture `PROCEED`.

## Architecture overview

| Path | Responsibility |
| --- | --- |
| `apps/web` | React 18 + Vite frontend, landing experience, wallet-style demo, and Three.js visualization |
| `apps/api` | Node.js/Hono HTTP runtime for live Check and recorded Replay |
| `packages/contracts` | Shared schemas, normalized Intent/Run types, Evidence, Replay, and serialization |
| `packages/moss-bridge` | Moss/Kuru runtime loading, live execution-evidence adapter, normalization, and provenance checks |
| `packages/orchestrator` | Agent Flow, rerun lifecycle, Action Gate, and application orchestration |
| `packages/risk` | Deterministic P0 rule evaluation and centralized Verdict policy |
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
  risk/                Rule and Verdict logic
fixtures/              Evidence and Replay fixtures
docs/                  Product, research, integration, methodology, and ADRs
scripts/               Smoke and repository-validation scripts
```

## Quick start

Requirements:

- Node.js 22;
- pnpm 11-compatible tooling;
- Git.

Install dependencies and create a local environment file:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Start the frontend demo:

```bash
pnpm --filter @parallax/web dev
```

Open the Vite URL and use `#/` for the landing page or `#/analyze` for the MVP.

To start the backend, first fill the required values in `.env`, then run:

```bash
pnpm --filter @parallax/api start
```

The frontend and backend are separate processes. On current `main`, starting both does not by itself replace the frontend's local demo service with API calls.

## Environment configuration

`.env.example` is the authoritative variable list.

| Variable | Purpose |
| --- | --- |
| `MONAD_RPC_URL` | Read-only Monad RPC used by backend `POST /api/check` |
| `MOSS_RPC_URL` | Read-only RPC used by the local live-smoke command; not consumed automatically by the backend |
| `MOSS_RUNTIME_VERSION` | Expected Moss package/runtime version |
| `MOSS_RUNTIME_REVISION` | Expected immutable Moss Git revision |
| `MOSS_RUNTIME_PATH` | Optional absolute path to the built, pinned Moss Git checkout; enables the live Kuru Agent Flow |
| `PARALLAX_TOKEN_REGISTRY_JSON` | Trusted token metadata consumed by backend normalization |
| `CORS_ORIGIN` | Browser origin allowed to call the API |
| `HOST` / `PORT` | Node HTTP listener configuration |

The live backend requires the Moss checkout at `MOSS_RUNTIME_PATH` to retain its `.git` metadata, match the configured version/revision, and be readable by a runtime with `git` available. Without that path, `POST /api/check` fails closed as `UNSUPPORTED` with an `UNKNOWN` Run rather than returning fake live evidence.

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

### `POST /api/check`

Runs the backend-owned live Check boundary. A request carries a normalized swap Intent; successful processing returns a completed or Integration Error Run envelope. A re-run uses the same endpoint with `parentRunId` and exactly one allowed Intent change.

If live Moss is not configured, the endpoint returns an explicit `UNSUPPORTED` application error and an `UNKNOWN` Run. It never substitutes Recorded Replay for a live result.

### `GET /api/replay/:id`

Returns a frozen Recorded Replay fixture. Replay preserves recorded provenance but is not a current live run and cannot be used as a live Check parent.

See the [frontend API handoff](docs/integration/api-frontend-handoff.md) for payloads, error mappings, CORS, and startup details.

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
| Kai | [@chin0312](https://github.com/chin0312) | Product and demo |
| Rei | [@rainypilgrimage](https://github.com/rainypilgrimage) | Risk methodology and research |
| Jie | [@jzhao0](https://github.com/jzhao0) | Moss integration and risk engine |
| Clare | [@brightheartma](https://github.com/brightheartma) | API, backend, orchestration, and deployment |
| Antony | [@antony819](https://github.com/antony819) | Web frontend |

## Collaboration

- Start work from the latest `main` on a short-lived branch.
- Keep runtime, Contract, product-copy, and Evidence claims in their owning layers.
- Do not use Recorded Replay or Mock data as proof of a live user Verdict.
- Run the relevant checks before opening a pull request.
- Request review from the owners of the files and semantics changed.

## Disclaimer

Parallax is experimental software for explaining and testing pre-transaction decisions. It does not provide investment advice and does not sign, broadcast, execute, or custody transactions. Evidence may be incomplete or unavailable; users must independently verify transaction details and understand that `PROCEED` is scope-bounded, not a guarantee of safety.
