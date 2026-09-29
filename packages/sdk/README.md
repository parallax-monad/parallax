# @parallax/sdk

A thin typed HTTP client for the public Parallax API.

`@parallax/sdk` is a distribution/consumer surface, not a second implementation of
Parallax. It performs transport plus canonical `@parallax/contracts` validation, and
nothing else.

## Surface

```ts
import { ParallaxClient } from "@parallax/sdk";

const client = new ParallaxClient({
  baseUrl: "http://127.0.0.1:8787",
  // fetch: myFetch,          // optional injection for Node, browsers, and tests
  // headers: { "x-api-key": "…" },
});

await client.quote(quoteRequest); // POST /api/quote          -> QuoteResult
await client.check(checkRequest); // POST /api/check          -> RunResult
await client.getRun(runId); //       GET  /api/runs/:runId    -> CheckRunEnvelope
await client.recheck(parentRunId, request); // POST /api/check with parentRunId
await client.getAccountState(request); //    POST /api/account-state
```

`recheck()` is not a new endpoint. It calls `check()` and sets `parentRunId`; the caller
must change exactly one Backend-supported Intent field, and the Backend decides
`INVALID_RERUN` reasons. The SDK models none of those rules.

Errors: HTTP failures (and unusable 2xx bodies) throw `ParallaxApiError` with the HTTP
`status`, the parsed `body`, and the Backend `error.code` when present. They are transport
facts only, never a Risk, Cause, or Product verdict.

## Source of truth

- The Backend owns every Product, Risk, Cause, Evidence, and Re-run decision.
- The SDK contains no Risk rules, no Provider or RPC access, no QuickNode or Explorer
  calls, and no signing, broadcasting, or custody. `packages/sdk/src/boundary.test.ts`
  enforces the import and dependency boundary.
- Dependencies are limited to `@parallax/contracts` and `zod`.

## Two deliberate representations

- `GET /api/runs/:runId` returns the Backend's Run envelope (`CheckRunRecord`), which is
  API-local rather than a shared Contract. `src/run-envelope.ts` declares only that
  transport envelope and delegates every semantic field to the canonical schemas
  (`normalizedSwapIntentSchema`, `runResultSchema`, `failedRunResultSchema`, `runIdSchema`).
- The canonical account-state schema lives in `apps/api/src/account-state-model.ts` and is
  intentionally not promoted to `@parallax/contracts`. `getAccountState()` therefore
  returns an opaque `TSnapshot = unknown`; a caller that needs structure supplies and
  validates its own snapshot type. The SDK does not restate Backend account-state
  semantics.

## Reference example

`examples/basic.ts` shows `quote → check → getRun → recheck → getAccountState` against the
public HTTP API with a base URL from `PARALLAX_API_BASE_URL`. It requires no chain access to
compile and does not sign, broadcast, or custody anything.
