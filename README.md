# Parallax

Parallax is a Moss-powered pre-transaction decision layer for Monad swaps.

Before a user signs or retries a swap, Parallax uses execution evidence to help the user decide whether to proceed, adjust, stop, or wait for more evidence.

> Moss tells us what will happen. Parallax tells the user what to do next.

## P0 scope

The hackathon MVP focuses on:

- a wallet-style single-page experience;
- structured swap intent;
- real Moss quote, action, and simulation evidence;
- deterministic verdicts;
- actionable adjustment guidance;
- one Adjust & Re-run flow;
- no signing, broadcasting, or asset custody.

These capabilities are the planned P0 scope and are not yet complete.

## Repository

https://github.com/parallax-monad/parallax

## Structure

```text
apps/api       Backend API and orchestration
apps/web       Frontend application
packages/*     Shared contracts, Moss bridge, orchestration, and risk logic
docs/*         Product, research, risk methodology, demo, and ADR documents
fixtures/      Test, evidence, and replay fixtures
scripts/       Development and operational scripts
```

## Team

| Member | GitHub | Area |
|---|---|---|
| Kai | [@chin0312](https://github.com/chin0312) | Product and demo |
| Rei | [@rainypilgrimage-beep](https://github.com/rainypilgrimage-beep) | Risk methodology and research |
| Jie | [@jzhao0](https://github.com/jzhao0) | Moss integration and risk engine |
| Clare | [@brightheartma](https://github.com/brightheartma) | API, backend, orchestration, and deployment |
| Antony | [@antony819](https://github.com/antony819) | Web frontend |

## Development status

The repository is currently in the P0 scaffold stage. Module owners will define internal source structures as implementation begins.

Target MVP completion date: August 5, 2026.

## Backend runtime

The Node runtime is composed through `bootstrapBackendApp()` and can be
started directly with `pnpm --filter @parallax/api start` after copying
`.env.example` to `.env` and filling in the required values. The launcher
requires `MONAD_RPC_URL`, `MOSS_RUNTIME_VERSION`, `MOSS_RUNTIME_REVISION`,
`PARALLAX_TOKEN_REGISTRY_JSON`, `HOST`, and `PORT`, and optionally accepts
`CORS_ORIGIN` for the browser origin allowed to call the API. It reports
configuration errors before opening the listener.

```bash
cp .env.example .env
pnpm --filter @parallax/api start
```

P2 does not include the live Agent Flow implementation; until it is injected,
`POST /api/check` returns HTTP 502 with `error.code: "UNSUPPORTED"` and a
fail-closed Run envelope whose verdict is `UNKNOWN` and whose integration
error is not retryable, rather than a fake success. Recorded replay data is
available only through `/api/replay/:id` and is never used as a live Check
fallback.

## Collaboration

- `main` is the shared integration branch.
- Development work should use short-lived branches.
- Changes should be submitted through pull requests.
- Technical changes require technical review.
- Documentation is primarily reviewed by Kai and Rei.
- README changes are reviewed by the full team.
