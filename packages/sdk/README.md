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
```

`recheck()` only sends `parentRunId` to the existing Check endpoint. The Backend owns
parent eligibility and the exactly-one-Intent-change rule. `getAccountState()` returns
the shared `AccountStateSnapshot` DTO; the API remains authoritative for response
generation and validation.

`ParallaxApiError` exposes HTTP `status`, parsed `body`, and the Backend `error.code`
when available. Those are API response facts, not Risk, Cause, or Product verdicts.
Quote, Check, and Run response bodies are parsed against canonical Zod schemas.
Account State uses the shared type-only DTO and relies on API-side runtime validation.

## Boundary

- Dependencies are limited to `@parallax/contracts` and `zod`.
- `@parallax/contracts` exports `AccountStateSnapshot` as a type-only DTO; response
  construction and runtime validation remain API-owned.
- No Provider/RPC, Risk/Cause, QuickNode, or Explorer logic is included.
- The SDK does not sign, broadcast, or custody transactions.
- No Product or shared runtime Contract semantics are introduced.

## Reference consumer

`examples/basic.ts` demonstrates Quote, Check, and historical Run retrieval. Re-run is
optional (`PARALLAX_SDK_DEMO_RECHECK=1`) because the Backend may reject a parent Run that
is not eligible. Run it against a local API with:

```sh
PARALLAX_API_BASE_URL=http://127.0.0.1:8787 \
  pnpm --filter @parallax/api exec tsx ../../packages/sdk/examples/basic.ts
```
