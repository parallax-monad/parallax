# Local Arbitrum One Anvil fork

This is a developer-only, read-only quote-parity harness. It does not establish production Arbitrum One Check/simulation support, enable transaction execution, or produce transaction-execution evidence.

The smoke reuses the merged `ARBITRUM_ONE_RUNTIME_PROFILE` and `createArbitrumOneQuoteFlow` directly. It does not copy the Camelot route or Quoter ABI. It compares the exact `0.001 ETH → USDC` quote from the upstream read-only proxy and the local fork at source block `515881859` (`0x304b694bc77e488eca3af067e45712e71753e2c42ca04881e21039b71da4560e`), using the PR 1B capture's verified profile and route.

Identity is reported in separate fields:

- upstream source chain: Arbitrum One, `42161`;
- pinned source block: number and hash above;
- local execution chain: `31337`;
- fork instance: a fresh UUID per start/reset;
- Anvil: Foundry `1.8.5`, pinned by the multi-architecture OCI digest in `config.json`;
- read-only proxy: Node `22.23.2`, pinned by its OCI digest in `config.json`.

Compose is scoped to the Git checkout, not its absolute filesystem path. On first use, the host
runner atomically stores a checkout UUID in Git metadata as
`parallax-arbitrum-one-fork.checkout-id` and uses it in the Compose project name. The Mac host and
dev container share this identity when they use the same mounted checkout, even though the mount
paths differ; separate clones and worktrees get distinct Compose projects. This checkout identity
is separate from the per-start/reset fork-instance UUID. Do not delete or replace the metadata
file while this checkout's fork is active.

The manager does not automatically tear down containers left under the former shared Compose
project name. Confirm which checkout owns any such legacy containers before removing them.

## Prerequisites

- macOS Docker Desktop with Docker Compose `2.23.1` or newer (environment-sourced Compose secrets are required);
- Node 22.15+ in the 22.x line and the repository's pnpm dependencies. The host runner uses Node's built-in TypeScript support with a scoped `.js`→`.ts` resolver; it does not load `tsx`/esbuild or change the shared `node_modules` layout.
- an HTTPS Arbitrum One RPC endpoint that can serve the pinned historical block.

No `.env` file, endpoint value, or credential is required in the repository. Enter the upstream URL into the Mac host shell without adding it to shell history:

```sh
printf 'Read-only Arbitrum One HTTPS RPC endpoint (input hidden): ' >&2
IFS= read -r -s ARBITRUM_ONE_FORK_UPSTREAM_RPC_URL
export ARBITRUM_ONE_FORK_UPSTREAM_RPC_URL
printf '\n' >&2
```

The URL is mounted into the proxy as a runtime secret. The proxy is the only container that receives it; Anvil sees only the internal read-only proxy URL. The proxy rejects transaction/write RPC methods and strips upstream error text. Do not print the variable, run `docker compose config`, or expose process/container inspection output.

The local fork RPC host port is published by `anvil-host-forwarder`, not by Anvil. This minimal TCP service listens on container port `8546` and forwards only to `anvil:8545` on the internal `fork` network. It has no upstream secret and does not join `egress`. To support host-port publishing, only the forwarder also joins a dedicated non-internal `host-publish` bridge. That bridge disables Docker bridge IP masquerading as a best-effort reduction in outbound access; it is not a verified guarantee that all egress is blocked, particularly on Docker Desktop. Published-port forwarding is a separate Docker mechanism, and the configured host bind remains private/loopback. The only intercepted request is the fixed-purpose, secret-free `parallax_forkInstanceId` JSON-RPC handshake; its response is the Compose instance UUID, while all other traffic is forwarded unchanged. Anvil remains read-only, is attached only to `fork`, and has no published host port. The forwarder uses the existing pinned Node image and configured host bind address/port.

## Start and stop on the Mac host

Run from the repository root:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --experimental-transform-types scripts/arbitrum-one-fork/run-host.mjs start
```

The command prints `status=ready` only after checking Docker/Compose, ports, upstream chain ID, pinned source block number/hash, local chain ID, fork block/hash, and Anvil version. It fails closed and never falls back to `latest`. These identities are distinct: upstream chain `42161`; pinned source block `515881859` and its hash above; local execution chain `31337` at the pinned base block; and a fresh fork-instance UUID. The default host bind is `127.0.0.1`. If the dev container cannot reach the published ports through `host.docker.internal`, set `FORK_BIND_ADDRESS` to a private IPv4 address assigned to the Mac's Docker Desktop interface, then run `reset` to recreate the fork. Public and wildcard addresses are rejected.

### Reset, teardown, and recovery

`reset` discards the local fork and all local state, then creates a fresh instance at the same pinned source block with a new fork-instance UUID. Use it between independent tasks or whenever the local state is uncertain:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --experimental-transform-types scripts/arbitrum-one-fork/run-host.mjs reset
```

`stop` and `destroy` both remove the Compose containers, volumes, and local instance/capture metadata. `stop` is the normal teardown; `destroy` is the explicit full cleanup. Neither changes upstream state. Choose one teardown command:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --experimental-transform-types scripts/arbitrum-one-fork/run-host.mjs stop
```

Or, for explicit full cleanup:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --experimental-transform-types scripts/arbitrum-one-fork/run-host.mjs destroy
```

To recreate a clean fork later, inject the upstream endpoint at runtime and run:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --experimental-transform-types scripts/arbitrum-one-fork/run-host.mjs start
```

`start` refuses to create a second running fork. A shared lock under `.git` serializes host and dev-container smoke/reset/teardown commands for this checkout. If a command reports `HARNESS_BUSY`, wait for the active task; remove the stale lock only after confirming that no harness task is running.

During the smoke, Anvil snapshots and reverts its local EVM state around the quote and repeat quote. If snapshot reset fails, the smoke tries to destroy and recreate the fork when Docker and the upstream endpoint are available. That failed smoke still exits unsuccessfully and writes no capture: rerun `smoke` after the recovery message. If automatic recovery cannot complete, do not reuse the fork; run the host `reset` command. If reset itself cannot complete cleanly, run `destroy`, then `start` once Docker is available. The RPC secret must be runtime-injected for `reset`/`start`, but is not needed for `stop`/`destroy`.

## Smoke from the Mac host

The host-local endpoints are the upstream read-only proxy on port `18546` and the local fork RPC on port `8545`:

```sh
ARBITRUM_ONE_FORK_SOURCE_RPC_URL=http://127.0.0.1:18546 \
ARBITRUM_ONE_FORK_LOCAL_RPC_URL=http://127.0.0.1:8545 \
node --disable-warning=ExperimentalWarning --experimental-strip-types --experimental-transform-types scripts/arbitrum-one-fork/run-host.mjs smoke
```

Before reading chain/block/version or changing local test state, smoke calls `parallax_forkInstanceId` through the exact configured local RPC URL and requires its result to match the current fork UUID. A second fork therefore fails closed even if its chain, pinned block, and Anvil version match; this handshake works through the same host-published endpoint from both the Mac host and dev container.

Each smoke takes an Anvil snapshot, assigns exactly `1 ETH` to one random local address with `anvil_setBalance`, verifies its USDC balance remains zero, executes only the exact Quoter read, reverts the snapshot, repeats the quote, and reverts again. Anvil starts with `--accounts 0`; no private key or unlocked signer is created. No transaction is submitted or mined. Local balance preparation is the only state override; the pool, USDC balance, and upstream chain are not changed.

A successful sanitized capture is written to `.git/parallax-arbitrum-one-fork-capture.json` and printed as JSON. It records the source block/hash, local chain identity, Anvil version, instance UUID, sender preparation, exact atomic quote comparison, and reset result. It contains no RPC endpoint or credential and is not a Product acceptance or simulation capture.

## Required Mac-host ↔ Hermes dev-container connectivity smoke

After the Mac-host `start` succeeds, run this in the Hermes dev container (not in a shell where `localhost` refers to the Mac). `localhost` inside that container is the container itself; use `host.docker.internal` to reach the Mac's published RPC ports:

```sh
ARBITRUM_ONE_FORK_SOURCE_RPC_URL=http://host.docker.internal:18546 \
ARBITRUM_ONE_FORK_LOCAL_RPC_URL=http://host.docker.internal:8545 \
node --disable-warning=ExperimentalWarning --experimental-strip-types --experimental-transform-types scripts/arbitrum-one-fork/run-host.mjs smoke
```

Return the actual JSON output and exit status. Until that command is actually run from the dev container, host/container connectivity remains unverified. If it fails with a connection error, do not substitute `localhost`; set the host bind to the Mac's private Docker Desktop interface, run `reset`, and repeat the exact smoke.

## Validation

From the repository root:

```sh
pnpm exec vitest run scripts/arbitrum-one-fork
pnpm test
pnpm typecheck
pnpm lint
pnpm exec biome check scripts/arbitrum-one-fork
pnpm exec biome format scripts/arbitrum-one-fork
git diff --check
```

Focused tests use fake RPC clients; they do not claim the Docker/Anvil network smoke passed. The real Mac host and dev-container smoke is a separate required acceptance check.
