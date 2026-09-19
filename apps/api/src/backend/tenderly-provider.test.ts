import { describe, expect, it, vi } from "vitest";
import {
  evaluateProviderAdapter,
  ProviderAdapterError,
} from "./provider-adapter.js";
import {
  createTenderlyProvider,
  type TenderlyPreparedExecution,
} from "./tenderly-provider.js";

const sender = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;
const intent = { chainId: 421614, protocol: "camelot-v3", sender };
const prepared: TenderlyPreparedExecution = {
  runId: "run-1",
  intent,
  chainId: 421614,
  protocol: "camelot-v3",
  blockContext: { blockNumber: "123", blockHash: hash },
  quote: { id: "controlled" },
  unsignedTransaction: {
    kind: "unsigned",
    payload: {
      from: sender,
      to: target,
      data: "0x1234",
      value: "0x0",
      gas: "0x5208",
    },
  },
  gasEstimate: { gasUnits: "21000" },
  finality: { status: "confirmed" },
};
const input = {
  runId: "run-1",
  intent,
  chainId: 421614,
  protocol: "camelot-v3",
  input: prepared,
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    transaction: {
      from: sender,
      to: target,
      input: "0x1234",
      value: "0x",
      network_id: "421614",
      block_number: 123,
      block_hash: hash,
      status: true,
      gas_used: 20000,
      transaction_info: { asset_changes: [], balance_changes: [] },
      ...overrides,
    },
    simulation: {
      from: sender,
      to: target,
      input: "0x1234",
      value: "0",
      network_id: "421614",
      block_number: 123,
      status: true,
    },
  };
}

function adapter(fetcher: typeof fetch) {
  return createTenderlyProvider({
    accountSlug: "account",
    projectSlug: "project",
    accessKey: "SENSITIVE_TEST_KEY",
    fetchImplementation: fetcher,
    now: () => new Date("2026-09-17T00:00:00Z"),
  });
}

describe("TenderlyProvider", () => {
  it("supports exactly Arbitrum Sepolia and Camelot V3 and forwards the exact prepared transaction", async () => {
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, options?: RequestInit) => {
        expect(JSON.parse(String(options?.body))).toEqual({
          network_id: "421614",
          from: sender,
          to: target,
          input: "0x1234",
          value: "0",
          block_number: 123,
          gas: 21000,
          save: false,
          save_if_fails: false,
          simulation_type: "full",
        });
        expect(options?.method).toBe("POST");
        return Response.json(response());
      },
    ) as typeof fetch;
    const provider = adapter(fetcher);
    expect(provider.supports({ chainId: 421614, protocol: "camelot-v3" })).toBe(
      true,
    );
    expect(provider.supports({ chainId: 42161, protocol: "camelot-v3" })).toBe(
      false,
    );
    expect(provider.supports({ chainId: 421614, protocol: "other" })).toBe(
      false,
    );
    const result = await evaluateProviderAdapter(provider, input);
    expect(result.status).toBe("success");
    expect(result.provider.providerId).toBe("tenderly-arbitrum");
    expect(JSON.stringify(result)).not.toContain("SENSITIVE_TEST_KEY");
    expect(JSON.stringify(result.responseEvidence)).not.toContain(
      "transaction_info",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["runId", { runId: "other" }],
    ["chain", { chainId: 1 }],
    ["quote", { quote: undefined }],
    ["block", { blockContext: { blockNumber: "123" } }],
    [
      "transaction",
      {
        unsignedTransaction: {
          kind: "unsigned",
          payload: { from: target, to: target, data: "0x1234", value: "0" },
        },
      },
    ],
    [
      "unsupported transaction field",
      {
        unsignedTransaction: {
          kind: "unsigned",
          payload: {
            from: sender,
            to: target,
            data: "0x1234",
            value: "0",
            nonce: "1",
          },
        },
      },
    ],
  ])("rejects %s mismatch before HTTP", async (_label, change) => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(
      evaluateProviderAdapter(adapter(fetcher), {
        ...input,
        input: { ...prepared, ...change } as TenderlyPreparedExecution,
      }),
    ).rejects.toBeInstanceOf(ProviderAdapterError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps a controlled revert failed and a partial response unknown", async () => {
    const reverted = response({
      status: false,
      error_message: "SENSITIVE_TEST_KEY",
    });
    reverted.simulation.status = false;
    const fail = adapter(
      vi.fn(async () => Response.json(reverted)) as typeof fetch,
    );
    expect((await evaluateProviderAdapter(fail, input)).status).toBe("failed");
    const partial = adapter(
      vi.fn(async () =>
        Response.json(response({ block_hash: "" })),
      ) as typeof fetch,
    );
    const result = await evaluateProviderAdapter(partial, input);
    expect(result.status).toBe("unknown");
    expect(
      JSON.stringify(await evaluateProviderAdapter(fail, input)),
    ).not.toContain("SENSITIVE_TEST_KEY");
    const noAssets = adapter(
      vi.fn(async () =>
        Response.json(response({ transaction_info: {} })),
      ) as typeof fetch,
    );
    expect((await evaluateProviderAdapter(noAssets, input)).status).toBe(
      "unknown",
    );
  });

  it("never promotes a mismatched network, transaction, block, or mixed outcome to success", async () => {
    const cases = [
      { transaction: { ...response().transaction, network_id: "1" } },
      { transaction: { ...response().transaction, to: sender } },
      { simulation: { ...response().simulation, block_number: 124 } },
      { simulation: { ...response().simulation, status: false } },
      { transaction: { ...response().transaction, gas_used: undefined } },
    ];
    for (const change of cases) {
      const provider = adapter(
        vi.fn(async () =>
          Response.json({ ...response(), ...change }),
        ) as typeof fetch,
      );
      expect((await evaluateProviderAdapter(provider, input)).status).toBe(
        "unknown",
      );
    }
  });

  it.each([
    [401, "FAILED", false],
    [403, "FAILED", false],
    [429, "FAILED", true],
    [400, "UNKNOWN", false],
    [404, "UNKNOWN", false],
    [500, "FAILED", true],
  ])(
    "maps HTTP %i without exposing response text",
    async (httpStatus, code, retryable) => {
      const provider = adapter(
        vi.fn(
          async () =>
            new Response("SENSITIVE_TEST_KEY", { status: httpStatus }),
        ) as typeof fetch,
      );
      await expect(
        evaluateProviderAdapter(provider, input),
      ).rejects.toMatchObject({ code, retryable });
    },
  );

  it("maps timeout, network failure and malformed JSON without returning raw data", async () => {
    const timeout = adapter(
      vi.fn(async () => {
        throw new DOMException("secret", "TimeoutError");
      }) as typeof fetch,
    );
    await expect(evaluateProviderAdapter(timeout, input)).rejects.toMatchObject(
      { code: "TIMEOUT" },
    );
    const network = adapter(
      vi.fn(async () => {
        throw new Error("secret");
      }) as typeof fetch,
    );
    await expect(evaluateProviderAdapter(network, input)).rejects.toMatchObject(
      { code: "FAILED" },
    );
    const malformed = adapter(
      vi.fn(async () => new Response("{")) as typeof fetch,
    );
    await expect(
      evaluateProviderAdapter(malformed, input),
    ).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});
