import type { QuoteRequest } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import type { QuoteAgentFlowPort } from "./ports.js";
import { QuoteApplicationService } from "./quote-application.js";
import type { BackendRuntime } from "./runtime-config.js";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdcAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const tokenRegistry = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address: usdcAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "90000000",
    },
  ],
};

const runtime: BackendRuntime = {
  config: {
    tokenRegistry,
    moss: {
      rpcUrl: "https://rpc.example.test",
      runtimeVersion: "0.1.0",
      runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
    },
  },
  tokenRegistry: createTrustedTokenRegistry(tokenRegistry),
};

const request: QuoteRequest = {
  chainId: 143,
  protocol: "kuru",
  sender,
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: usdcAddress },
  amountIn: "0.01",
};

describe("QuoteApplicationService", () => {
  it("normalizes a public request and returns the backend quote", async () => {
    let received: Parameters<QuoteAgentFlowPort["quote"]>[0] | undefined;
    const flow: QuoteAgentFlowPort = {
      async quote(input) {
        received = input;
        return {
          status: "available",
          quote: {
            estimatedAmountOut: "0.000223",
            minimumAmountOut: "0.000221",
            source: "quote",
            blockNumber: "91383505",
            runtimeVersion: "0.1.0",
            runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
          },
        };
      },
    };
    const service = new QuoteApplicationService({ runtime, quoteFlow: flow });

    await expect(service.quote(request)).resolves.toMatchObject({
      status: 200,
      body: {
        status: "available",
        quote: { estimatedAmountOut: "0.000223" },
      },
    });
    expect(received).toMatchObject({
      intent: {
        chainId: 143,
        amountInAtomic: "10000000000000000",
        economicBoundary: { availability: "unavailable" },
      },
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      moss: runtime.config.moss,
    });
  });

  it("rejects an untrusted token before invoking the quote flow", async () => {
    let called = false;
    const service = new QuoteApplicationService({
      runtime,
      quoteFlow: {
        async quote() {
          called = true;
          throw new Error("must not run");
        },
      },
    });

    await expect(
      service.quote({
        ...request,
        tokenOut: {
          kind: "erc20",
          address: "0x3333333333333333333333333333333333333333",
        },
      }),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "NORMALIZATION_FAILED",
          issues: { code: "UNSUPPORTED_TOKEN", field: "tokenOut" },
        },
      },
    });
    expect(called).toBe(false);
  });

  it("maps an invalid quote-flow response to QUOTE_ERROR", async () => {
    const service = new QuoteApplicationService({
      runtime,
      quoteFlow: {
        async quote() {
          return { status: "invalid" };
        },
      },
    });

    await expect(service.quote(request)).resolves.toMatchObject({
      status: 502,
      body: { error: { code: "QUOTE_ERROR" } },
    });
  });
});
