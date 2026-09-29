/**
 * Minimal Parallax SDK reference integration (#94).
 *
 * Public HTTP API only. This example never touches a Provider, an RPC endpoint,
 * a wallet, a signature, a broadcast, or custody, and it re-implements no Risk,
 * Cause, or Re-run rule: the Backend owns every one of those.
 *
 * Run it against a local API:
 *
 *   PARALLAX_API_BASE_URL=http://127.0.0.1:8787 \
 *     node --experimental-strip-types packages/sdk/examples/basic.ts
 */

import {
  type AccountStateRequest,
  type CheckSwapRequest,
  ParallaxApiError,
  ParallaxClient,
  type QuoteRequest,
  type RunResult,
} from "@parallax/sdk";

const baseUrl = process.env.PARALLAX_API_BASE_URL ?? "http://127.0.0.1:8787";

/** The Monad × Kuru P0 pair documented in the Frontend API handoff. */
const sender = "0x1111111111111111111111111111111111111111";
const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

/** `POST /api/quote` is the strict exact-input body: no boundary, no parent. */
const quoteRequest: QuoteRequest = {
  chainId: 143,
  protocol: "kuru",
  sender,
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: usdc },
  amountIn: "0.01",
};

const checkRequest: CheckSwapRequest = {
  ...quoteRequest,
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

/** `POST /api/account-state` takes the same fields plus an optional recipient. */
const accountStateRequest: AccountStateRequest = {
  ...quoteRequest,
  recipient: sender,
};

function describeRun(result: RunResult): string {
  return `${result.runId} · ${result.status} · ${result.verdict}`;
}

async function main(): Promise<void> {
  const client = new ParallaxClient({ baseUrl });

  // 1. Quote. A Backend `unavailable` state is a real product state and is not
  //    an error, and it never blocks submitting the full Check.
  const quote = await client.quote(quoteRequest);
  console.log("quote()", JSON.stringify(quote));

  // 2. Check. The Backend is the source of truth for Evidence, Risk, Cause, and
  //    the verdict; the SDK only validates the canonical Run response.
  const baseline = await client.check(checkRequest);
  console.log("check()", describeRun(baseline));

  // 3. Get Run. Re-reads the persisted Run envelope; a `started` Run has no
  //    fabricated result.
  const stored = await client.getRun(baseline.runId);
  console.log("getRun()", stored.status);

  // 4. Re-check. The same `POST /api/check` endpoint with `parentRunId` set —
  //    no new endpoint. Exactly one Backend-supported Intent field changes, and
  //    the Backend owns `INVALID_RERUN` and the exactly-one-change rule.
  const child = await client.recheck(baseline.runId, {
    ...checkRequest,
    amountIn: "0.02",
  });
  console.log("recheck()", describeRun(child), "parent:", child.parentRunId);

  // 5. Account state (only when the endpoint is available). The canonical
  //    account-state schema is API-local, so the response stays opaque unless
  //    the caller supplies and validates its own snapshot type.
  const accountState = await client.getAccountState(accountStateRequest);
  console.log("getAccountState()", JSON.stringify(accountState));
}

main().catch((error: unknown) => {
  if (error instanceof ParallaxApiError) {
    const label = error.code === undefined ? "" : ` (${error.code})`;
    console.error(`Parallax API error: HTTP ${error.status}${label}`);
    console.error(error.body);
    process.exitCode = 1;
    return;
  }
  throw error;
});
