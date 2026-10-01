# @parallax/sdk

A thin typed client for the public Parallax HTTP API. The Backend remains the source
of truth; this package adds transport and canonical Contract validation, not a second
business-logic implementation.

## Public surface

```ts
import { ParallaxClient } from "@parallax/sdk";

const client = new ParallaxClient({
  baseUrl: "http://127.0.0.1:8787",
  // fetch: customFetch,
  // headers: { "x-api-key": "..." },
});

const quote = await client.quote(quoteRequest); // POST /api/quote
const run = await client.check(checkRequest); // POST /api/check
const storedRun = await client.getRun(run.runId); // GET /api/runs/:runId
const child = await client.recheck(run.runId, changedRequest); // POST /api/check
const accountState = await client.getAccountState(accountStateRequest);
const storedAccountState = await client.getAccountStateSnapshot(accountState.snapshotId);
```

`recheck()` only sends `parentRunId` to the existing Check endpoint. The Backend owns
parent eligibility and the exactly-one-Intent-change rule. `getAccountState()` and
`getAccountStateSnapshot()` return an `AccountStateSnapshot` validated with the shared
runtime Contract schema. The API remains authoritative for response generation and
account-state semantics.

`ParallaxApiError` exposes HTTP `status`, parsed `body`, and the Backend `error.code`
when available. Those are API response facts, not Risk, Cause, or Product verdicts.
Quote, Check, Run, and Account State response bodies are parsed against canonical
Zod schemas. Account State supports both the POST response and persisted snapshot
retrieval by ID.

## Boundary

- Dependencies are limited to `@parallax/contracts` and `zod`.
- `@parallax/contracts` exports both `AccountStateSnapshot` and
  `accountStateSnapshotSchema`; response construction remains API-owned, while API
  and SDK share runtime response validation.
- No Provider/RPC, Risk/Cause, QuickNode, or Explorer logic is included.
- The SDK does not sign, broadcast, or custody transactions.
- No new Product or Contract semantics are introduced; the existing API response
  validation is shared at runtime without changing its constraints.

## Reference consumer

`examples/basic.ts` demonstrates Quote, Check, and historical Run retrieval. Re-run is
optional (`PARALLAX_SDK_DEMO_RECHECK=1`) because the Backend may reject a parent Run that
is not eligible. Run it against a local API with:

```sh
PARALLAX_API_BASE_URL=http://127.0.0.1:8787 \
  pnpm --filter @parallax/api exec tsx ../../packages/sdk/examples/basic.ts
```
