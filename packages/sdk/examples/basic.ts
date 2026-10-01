/**
 * Minimal consumer of the public Parallax API through @parallax/sdk.
 *
 * The sample assets are illustrative; use a sender and pair supported by the
 * API deployment you are testing. This client never signs or broadcasts.
 */
import {
  type CheckSwapRequest,
  ParallaxApiError,
  ParallaxClient,
  type QuoteRequest,
} from "@parallax/sdk";

const baseUrl = process.env.PARALLAX_API_BASE_URL ?? "http://127.0.0.1:8787";
const sender = "0x1111111111111111111111111111111111111111";
const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

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
  recipient: sender,
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

async function main(): Promise<void> {
  const client = new ParallaxClient({ baseUrl });

  const quote = await client.quote(quoteRequest);
  console.log("quote()", quote.status);

  const run = await client.check(checkRequest);
  console.log("check()", run.runId, run.status, run.verdict);

  const storedRun = await client.getRun(run.runId);
  console.log("getRun()", storedRun.status, storedRun.runId);

  // The same Check endpoint is used for a Re-run. The Backend validates the
  // parent and exactly-one-Intent-change rule; callers must not reimplement it.
  if (process.env.PARALLAX_SDK_DEMO_RECHECK === "1") {
    const child = await client.recheck(run.runId, {
      ...checkRequest,
      amountIn: "0.02",
    });
    console.log("recheck()", child.runId, child.parentRunId);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ParallaxApiError) {
    const code = error.code === undefined ? "" : ` (${error.code})`;
    console.error(`Parallax API error: HTTP ${error.status}${code}`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
