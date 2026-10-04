# Contributing to Parallax

Thanks for your interest in Parallax. The product is a chain-agnostic pre-execution
decision and re-verification layer; the currently implemented public integration is
Arbitrum Sepolia × Camelot V3. Do not infer support for another chain or protocol from
historical adapters, tests, or research records.

## Start with the current references

- Read the [public overview](README.md) and [documentation index](docs/README.md).
- For a change, read the directly relevant implementation and contract first. Dated
  Open House plans and research are historical context, not current specifications.
- Check [CODEOWNERS](.github/CODEOWNERS) and the active GitHub issue for ownership. Keep
  changes within the relevant owner boundary.
- Preserve the frozen Product/Risk/Contract decisions and unsigned user-transaction
  boundary. In particular, `PROCEED` is limited to checked scope and `UNKNOWN` is not a
  pass.

## Local development

Requirements: Node.js 22 and pnpm.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

For the local Arbitrum Sepolia path, configure `ARBITRUM_RPC_URL` and
`PARALLAX_TOKEN_REGISTRY_JSON` using trusted token metadata. Current local API bootstrap
also requires a valid HTTP(S) `MONAD_RPC_URL` and non-empty `MOSS_RUNTIME_VERSION` and
`MOSS_RUNTIME_REVISION` values for legacy shared configuration validation. These values
do not enable a Monad product path. `MOSS_RUNTIME_PATH` can remain unset locally; without
it the legacy Moss/Kuru flow is unavailable.

The deployment container is a separate case: the current `Dockerfile` clones and builds a
pinned Moss runtime and configures its path. This is a known runtime-decoupling candidate,
not a requirement for local Arbitrum development. See the [Runtime Decoupling proposal](docs/proposals/runtime-decoupling.md).

Start the API and web app in separate terminals:

```bash
pnpm --filter @parallax/api start
pnpm --filter @parallax/web dev
```

The Vite development server proxies `/api/*` to the API. Do not commit `.env` files,
RPC credentials, API keys, private keys, user data, or unsanitized provider responses.

## Before opening a pull request

Keep the change focused and describe its objective, scope, validation, evidence, and owner
or semantic impact in the [pull request template](.github/pull_request_template.md). Run
the relevant checks and report exactly what was and was not exercised:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @parallax/web build
git diff --check
```

Use the [Bug report](.github/ISSUE_TEMPLATE/bug_report.md) or [Feature request](.github/ISSUE_TEMPLATE/feature_request.md)
template for focused, reproducible proposals. A pull request or test passing does not by
itself change Product acceptance or shared semantic decisions; obtain the relevant owner
decision when a change crosses those boundaries.

## Security reports

Do not publish secrets, private keys, or exploit details in an issue or pull request. The
repository currently has no declared private vulnerability-reporting route. Repository
administrators should enable GitHub Private Vulnerability Reporting or publish a
maintainer-controlled contact before contributors rely on a private disclosure process.
