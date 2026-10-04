# Parallax Decision Registry MVP

This is an optional Arbitrum Sepolia auditability layer. It records an immutable
commitment to a persisted Parallax Run; it does **not** prove that the Run's
Evidence is complete or authentic, that Risk rules are correct, or that a swap
is safe. It does not execute, sign, or broadcast a user's swap.

The MVP anchors on operator request through the Backend CLI, using a completed
Run read from `GET /api/runs/:runId`. It does not automatically anchor every
`POST /api/check`, change the public Run response, or make anchoring success a
condition for a Decision. This is intentionally separate from the existing
opaque Receipt lifecycle: the frozen Receipt contract leaves its payload,
commitment, durable retry, and public projection semantics unresolved. The
operator must explicitly select an already-persisted Run for this MVP. There is
also an ordering constraint: the existing lifecycle starts inside pipeline
execution before the Run is stored as `completed`, while this Registry accepts
only completed persisted Runs. Directly wiring that lifecycle to the Registry
would therefore either anchor too early or require a separate post-persistence
hook and durable retry semantics.

## On-chain contract

- `attestor` is fixed at deployment and is the only address allowed to write.
- A `runKey` can be anchored once. Repeating the same commitment is a no-op;
  trying to replace it reverts.
- `commitmentOf(runKey)` is public. `DecisionAnchored` records the commitment
  and attestor for indexing.
- The contract stores no Run ID, user address, Intent, Evidence, or provider
  payload. The public `runKey` is a domain-separated hash of the Run ID; it is
  not an anonymity guarantee if someone already knows the Run ID.
- The attestor cannot be rotated in place. If its key is lost or compromised,
  deploy a new registry and stop using the old one. This MVP is testnet-only.

## Off-chain record and hash

The API `GET /api/runs/:runId` response is the sole input. Remote API origins
must use HTTPS; HTTP is accepted only for loopback development origins, and
redirects are rejected. Preparation accepts
only a persisted `status: completed` Run whose nested result is also completed,
whose outer and inner Run IDs, creation time, parent and Intent agree, and whose
`replayMode` is false. A verdict of `UNKNOWN` is still a valid decision record.

`DecisionRecordV1` includes the Run identity/Intent and the stable decision,
rule, scope, route, quote and public Evidence projections. The UI-only
`evidencePresentation` is excluded. Generic `providerEvidence` is retained with
`providerData` emptied so provider-specific/raw payloads are not part of the
snapshot. The JSON is canonicalized, hashed with Ethereum Keccak-256, then
wrapped with chain, registry, Run key and schema-specific domain separators.
The V1 canonicalizer and record envelope are version-specific; changing either
requires a new record version and test vectors.
The V1 verifier uses a frozen envelope and treats nested public JSON as the
committed snapshot; it does not re-parse historical records through whichever
Run contract version happens to be installed later.

The local bundle contains off-chain Run data (including wallet addresses).
The CLI creates it with owner-only file permissions. Keep it private and do not
commit or upload it. Only `runKey` and `commitment` are sent in the registry
transaction.

## Commands

Prerequisites: Node 22, pnpm, Foundry (`forge` and `cast`), a local encrypted
Foundry keystore account, a funded Arbitrum Sepolia account, and a working
`ARBITRUM_SEPOLIA_RPC_URL`. Inject that variable through the process environment
or an approved secret manager. RPC URLs from providers such as QuickNode may
contain API credentials; never persist a credential-bearing URL in `.env`,
source control, logs, or command arguments. Only non-secret settings and public
addresses belong in the ignored local `.env`. Never put raw private keys in
project files or command arguments.

1. Set `PARALLAX_DECISION_REGISTRY_ATTESTOR` to the public address that will
   anchor records, then deploy:

   ```sh
   pnpm --filter @parallax/api decision-registry:deploy -- --account <deployer-keystore-name>
   ```

   The command refuses to broadcast unless the RPC reports chain ID `421614`.
   Save the returned contract address as
   `PARALLAX_DECISION_REGISTRY_ADDRESS`. Review the deployment receipt and
   confirm the chain is Arbitrum Sepolia before continuing.

2. Verify that the saved address contains the exact compiled Registry runtime
   and the configured immutable attestor:

   ```sh
   pnpm --filter @parallax/api decision-registry:verify-deployment -- \
     --registry <deployed-contract-address>
   ```

   Continue only when the command reports `Deployment verification: MATCH`.

3. Prepare a private bundle from a real persisted Run:

   ```sh
   pnpm --filter @parallax/api decision-registry:prepare -- \
     --api-base-url <backend-api-origin> \
     --run-id <persisted-run-id> \
     --out /private/tmp/parallax-decision-record.json
   ```

4. Anchor it with the local attestor keystore. Foundry prompts for the
   keystore password; the CLI re-reads that Run from the Backend API and
   refuses to sign unless the persisted result still reproduces the exact
   bundle commitment. It also verifies that the selected account's address
   matches the immutable Registry attestor before any transaction write. The
   application never accepts a raw key:

   ```sh
   pnpm --filter @parallax/api decision-registry:anchor -- \
     --bundle /private/tmp/parallax-decision-record.json \
     --api-base-url https://your-backend.example \
     --account <attestor-keystore-name>
   ```

   The command checks network, exact compiled runtime bytecode (ignoring only
   the constructor-patched immutable attestor slots), the immutable attestor,
   and existing state first.
   Exact retries do not send another transaction; a different existing value
   stops without attempting a write.

5. Verify later from the saved bundle and a read-only RPC call:

   ```sh
   pnpm --filter @parallax/api decision-registry:verify -- \
     --bundle /private/tmp/parallax-decision-record.json
   ```

   Only `Independent verification: MATCH` confirms that the local record
   recomputes to the currently stored on-chain commitment.

## Tests

The minimum contract and backend checks are intended to run in Docker:

```sh
docker run --rm --entrypoint /bin/sh \
  -v "$PWD/contracts/decision-registry:/workspace" \
  -w /workspace ghcr.io/foundry-rs/foundry:stable -lc 'forge test'

docker run --rm --entrypoint sh \
  -v "$PWD:/workspace" \
  -v parallax-decision-registry-pnpm-cache:/pnpm/store \
  -v parallax-decision-registry-corepack-cache:/corepack \
  -w /workspace \
  -e COREPACK_HOME=/corepack \
  node:22.23.2-bookworm-slim -lc \
  'corepack pnpm install --frozen-lockfile --filter parallax --filter "@parallax/api..." --store-dir=/pnpm/store && ./node_modules/.bin/vitest run apps/api/src/decision-registry/decision-record.test.ts && ./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json && ./node_modules/.bin/biome check apps/api/src/decision-registry apps/api/src/index.ts apps/api/package.json'
```

These commands test code and local fixtures only; they do not deploy or write
to a chain.
