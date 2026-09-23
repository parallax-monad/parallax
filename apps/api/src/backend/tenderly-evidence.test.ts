import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import { evaluateProviderAdapter } from "./provider-adapter.js";
import { mapTenderlyProviderResult } from "./tenderly-evidence.js";
import {
  createTenderlyProvider,
  type TenderlyPreparedExecution,
} from "./tenderly-provider.js";

const sender = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const blockHash = `0x${"a".repeat(64)}`;
const intent = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender,
  recipient: sender,
  recipientSource: "defaulted_from_sender" as const,
  tokenIn: { kind: "native" as const },
  tokenOut: {
    kind: "erc20" as const,
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1000000000000000000",
  economicBoundary: {
    availability: "available" as const,
    minimumReceivedAtomic: "1000000",
    source: "user_declared" as const,
  },
} satisfies NormalizedSwapIntent;

const prepared: TenderlyPreparedExecution = {
  runId: "run-1",
  intent,
  chainId: 421614,
  protocol: "camelot-v3",
  blockContext: { blockNumber: "123", blockHash },
  quote: {
    estimatedAmountOut: "0.2",
    minimumAmountOut: "0.19",
    runtimeVersion: "camelot-v3",
    runtimeRevision: "revision-1",
  },
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

describe("Tenderly provider-neutral Evidence mapping", () => {
  it("preserves live provenance and keeps unreviewed economic scopes unknown", async () => {
    const provider = createTenderlyProvider({
      accountSlug: "account",
      projectSlug: "project",
      accessKey: "test-secret",
      fetchImplementation: vi.fn(async () =>
        Response.json({
          transaction: {
            from: sender,
            to: target,
            input: "0x1234",
            value: "0x",
            network_id: "421614",
            block_number: 123,
            block_hash: blockHash,
            gas: 21000,
            status: true,
            gas_used: 20000,
            transaction_info: { asset_changes: [], balance_changes: [] },
          },
          simulation: {
            from: sender,
            to: target,
            input: "0x1234",
            value: "0",
            network_id: "421614",
            block_number: 123,
            gas: 21000,
            status: true,
          },
        }),
      ) as typeof fetch,
      now: () => new Date("2026-09-17T00:00:00Z"),
    });
    const providerResult = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    const evidence = mapTenderlyProviderResult({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult,
    });

    expect(providerResult.mode).toBe("LIVE");
    expect(evidence.provider).toMatchObject({
      providerId: "tenderly-arbitrum",
      status: "SUCCESS",
      integrationStatus: "OK",
    });
    expect(evidence.execution.status).toBe("SUCCESS");
    expect(evidence.provenance).toMatchObject({
      observedChainId: 421614,
      mode: "LIVE",
      source: "external",
      simulationBlock: "123",
    });
    expect(evidence.quote).toMatchObject({
      source: "quote",
      value: { estimatedAmountOut: "0.2", minimumAmountOut: "0.19" },
    });
    expect(evidence.action.source).toBe("external");
    expect(evidence.simulation.value).toMatchObject({
      complete: false,
      missingTransactionIndexes: [0],
    });
    expect(evidence.unknownScope).toContain("assetChanges");
    expect(evidence.providerData.tenderly).toMatchObject({
      assetChangesAvailable: true,
      balanceChangesAvailable: true,
    });
  });

  it("does not promote semantic scopes from a response that is not bound", async () => {
    const provider = createTenderlyProvider({
      accountSlug: "account",
      projectSlug: "project",
      accessKey: "test-secret",
      fetchImplementation: vi.fn(async () =>
        Response.json({
          transaction: {
            from: sender,
            to: target,
            // Deliberately differs from the prepared transaction.
            input: "0xabcd",
            value: "0x",
            network_id: "421614",
            block_number: 123,
            block_hash: blockHash,
            gas: 21000,
            status: true,
            gas_used: 20000,
            transaction_info: { asset_changes: [], balance_changes: [] },
          },
          simulation: {
            from: sender,
            to: target,
            input: "0x1234",
            value: "0",
            network_id: "421614",
            block_number: 123,
            gas: 21000,
            status: true,
          },
        }),
      ) as typeof fetch,
      now: () => new Date("2026-09-17T00:00:00Z"),
    });
    const providerResult = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    expect(providerResult.status).toBe("unknown");
    const evidence = mapTenderlyProviderResult({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult,
    });

    expect(evidence.provider.status).toBe("UNKNOWN");
    expect(evidence.checkedScope).toEqual([]);
    expect(evidence.providerData.tenderly).toMatchObject({ checked: [] });
  });

  it("keeps deterministic fixture evidence mock and non-reproducible", async () => {
    const provider = createTenderlyProvider({
      accountSlug: "account",
      projectSlug: "project",
      accessKey: "test-secret",
      fetchImplementation: vi.fn(async () =>
        Response.json({
          transaction: {
            from: sender,
            to: target,
            input: "0x1234",
            value: "0x",
            network_id: "421614",
            block_number: 123,
            block_hash: blockHash,
            gas: 21000,
            status: true,
            gas_used: 20000,
            transaction_info: { asset_changes: [], balance_changes: [] },
          },
          simulation: {
            from: sender,
            to: target,
            input: "0x1234",
            value: "0",
            network_id: "421614",
            block_number: 123,
            gas: 21000,
            status: true,
          },
        }),
      ) as typeof fetch,
      now: () => new Date("2026-09-17T00:00:00Z"),
      mode: "MOCK",
    });
    const providerResult = await evaluateProviderAdapter(provider, {
      runId: prepared.runId,
      intent,
      chainId: prepared.chainId,
      protocol: prepared.protocol,
      input: prepared,
    });

    const evidence = mapTenderlyProviderResult({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult,
    });

    expect(providerResult.mode).toBe("MOCK");
    expect(evidence.provenance).toMatchObject({ mode: "MOCK", source: "mock" });
    expect(evidence.simulation.reproducibility).toBe("NOT_REPRODUCIBLE");
    expect(evidence.quote.reproducibility).toBe("NOT_REPRODUCIBLE");
    expect(evidence.provenance).not.toHaveProperty("runtime");

    const replayEvidence = mapTenderlyProviderResult({
      intent,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      preparedExecution: prepared,
      providerResult,
      mode: "RECORDED_REPLAY",
    });
    expect(replayEvidence.provenance).toMatchObject({
      mode: "RECORDED_REPLAY",
      source: "external",
    });
    expect(replayEvidence.simulation.reproducibility).toBe("REPRODUCIBLE");
  });
});
