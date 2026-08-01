import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawKuruEvidence } from "../src/index.js";
import {
  normalizeRecordedKuruEvidence,
  replayKuruEvidence,
} from "../src/index.js";

type RecordedMetadata = {
  chainId: string;
  sender: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  blockNumber: string;
  mossVersion: string;
  mossCommit: string;
  recordedAt: string;
};

function json<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
}

function recordedFixture(name: "mon-to-usdc" | "usdc-to-mon") {
  const raw = json<RawKuruEvidence>(
    `../../../fixtures/chain-evidence/kuru/${name}/raw.json`,
  );
  const metadata = json<RecordedMetadata>(
    `../../../fixtures/chain-evidence/kuru/${name}/metadata.json`,
  );
  return normalizeRecordedKuruEvidence({
    intent: {
      chainId: metadata.chainId,
      sender: metadata.sender,
      tokenIn: metadata.tokenIn,
      tokenOut: metadata.tokenOut,
      amountIn: metadata.amountIn,
    },
    raw,
    blockNumber: metadata.blockNumber,
    mossVersion: metadata.mossVersion,
    mossCommit: metadata.mossCommit,
    fetchedAt: metadata.recordedAt,
  });
}

function transaction(to: string, data: string) {
  return { from: "0xsender", to, data, value: "0x0" };
}

function actionWithApprovalAndSwap() {
  return {
    protocol: "kuru",
    method: "swap",
    children: [
      {
        protocol: "erc20",
        method: "approve",
        children: [{ transaction: transaction("0xtoken", "0xapprove") }],
      },
      { transaction: transaction("0xpool", "0xswap") },
    ],
  } as RawKuruEvidence["action"];
}

function result(tx: ReturnType<typeof transaction>, reverted = false) {
  return {
    transaction: tx,
    reverted,
    ...(reverted
      ? { revertReason: "execution reverted" }
      : { receipt: { outcome: { operation: "swap" } } }),
    warnings: [],
    gas: "1",
  };
}

function normalize(raw: RawKuruEvidence) {
  return normalizeRecordedKuruEvidence({
    intent: {
      chainId: "143",
      sender: "0xsender",
      tokenIn: "USDC",
      tokenOut: "MON",
      amountIn: "1",
    },
    raw,
    blockNumber: "1",
    mossVersion: "test",
  });
}

describe("recorded Kuru evidence", () => {
  it("matches the canonical MON to USDC normalized fixture", () => {
    const normalized = recordedFixture("mon-to-usdc");
    expect(normalized).toEqual(
      json("../../../fixtures/chain-evidence/kuru/mon-to-usdc/normalized.json"),
    );
    expect(() => JSON.stringify(normalized)).not.toThrow();
  });

  it("matches the canonical USDC to MON normalized fixture", () => {
    const normalized = recordedFixture("usdc-to-mon");
    expect(normalized).toEqual(
      json("../../../fixtures/chain-evidence/kuru/usdc-to-mon/normalized.json"),
    );
    expect(normalized.approval).toMatchObject({
      value: "REQUIRED",
      formula:
        "Derived from the recorded ERC-20 approval capability preceding the Kuru swap action.",
    });
  });

  it("marks replay without changing the original source", () => {
    const replay = replayKuruEvidence(recordedFixture("mon-to-usdc"));
    expect(replay.replayMode).toBe(true);
    expect(replay.quote).toMatchObject({ source: "quote", isReplay: true });
    expect(replay.errors).toMatchObject({ source: "moss", isReplay: true });
  });

  it("keeps mock fixture declarations separate from real evidence", () => {
    const metadata = json<{
      fixtureType: string;
      real: boolean;
      source: string;
    }>("../../../fixtures/chain-evidence/kuru/no-route/metadata.json");
    expect(metadata).toEqual({
      fixtureType: "RULE_TEST_INPUT",
      real: false,
      source: "mock",
      purpose: "Rule-engine STOP mapping fixture; no chain call was made.",
    });
  });
});

describe("simulation coverage", () => {
  it("keeps approval-only simulation evidence incomplete", () => {
    const approve = transaction("0xtoken", "0xapprove");
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: actionWithApprovalAndSwap(),
      simulation: { results: [result(approve)] },
    });
    expect(normalized.simulationCoverage.value).toMatchObject({
      expectedTransactions: 2,
      observedResults: 1,
      complete: false,
      missingTransactionIndexes: [1],
    });
    expect(normalized.executionStatus).toBe("UNKNOWN");
  });

  it("requires matching complete results without a halt before success", () => {
    const approve = transaction("0xtoken", "0xapprove");
    const swap = transaction("0xpool", "0xswap");
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: actionWithApprovalAndSwap(),
      simulation: { results: [result(approve), result(swap)] },
    });
    expect(normalized.simulationCoverage.value).toMatchObject({
      expectedTransactions: 2,
      observedResults: 2,
      complete: true,
      missingTransactionIndexes: [],
    });
    expect(normalized.executionStatus).toBe("SUCCESS");
  });

  it("retains the halt reason and does not release halted evidence", () => {
    const swap = transaction("0xpool", "0xswap");
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: { protocol: "kuru", method: "swap", transaction: swap },
      simulation: {
        results: [result(swap)],
        halted: { transactionIndex: 0, reason: "operator stopped" },
      },
    });
    expect(normalized.simulationCoverage.value).toMatchObject({
      halted: true,
      complete: false,
      haltReason: "operator stopped",
    });
    expect(normalized.executionStatus).toBe("UNKNOWN");
  });

  it("requires matching from address for transaction identity", () => {
    const swap = transaction("0xpool", "0xswap");
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: { protocol: "kuru", method: "swap", transaction: swap },
      simulation: {
        results: [result({ ...swap, from: "0xother" })],
      },
    });
    expect(normalized.simulationCoverage.value).toMatchObject({
      expectedTransactions: 1,
      observedResults: 0,
      complete: false,
    });
    expect(normalized.executionStatus).toBe("UNKNOWN");
  });

  it("does not match when a required transaction field is missing", () => {
    const swap = { to: "0xpool", data: "0xswap", value: "0x0" };
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: { protocol: "kuru", method: "swap", transaction: swap },
      simulation: {
        results: [result(transaction("0xpool", "0xswap"))],
      },
    });
    expect(normalized.simulationCoverage.value).toMatchObject({
      expectedTransactions: 1,
      observedResults: 0,
      complete: false,
    });
  });

  it("does not let one result cover two action transactions", () => {
    const approve = transaction("0xtoken", "0xapprove");
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: actionWithApprovalAndSwap(),
      simulation: { results: [result(approve), result(approve)] },
    });
    expect(normalized.simulationCoverage.value).toMatchObject({
      expectedTransactions: 2,
      observedResults: 1,
      complete: false,
      missingTransactionIndexes: [1],
    });
  });

  it("reports extra unmatched results", () => {
    const approve = transaction("0xtoken", "0xapprove");
    const swap = transaction("0xpool", "0xswap");
    const extra = transaction("0xextra", "0xextra");
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: actionWithApprovalAndSwap(),
      simulation: {
        results: [result(approve), result(swap), result(extra)],
      },
    });
    expect(normalized.simulationCoverage.value).toMatchObject({
      expectedTransactions: 2,
      observedResults: 2,
      complete: false,
      unmatchedResultIndexes: [2],
    });
  });

  it("does not establish REVERTED from a mismatched reverted result", () => {
    const swap = transaction("0xpool", "0xswap");
    const other = transaction("0xother", "0xother");
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: { protocol: "kuru", method: "swap", transaction: swap },
      simulation: { results: [result(other, true)] },
    });
    expect(normalized.simulationCoverage.value).toMatchObject({
      expectedTransactions: 1,
      observedResults: 0,
      complete: false,
    });
    expect(normalized.executionStatus).toBe("UNKNOWN");
  });
});

describe("structured errors", () => {
  it("normalizes a quote no-route error for the risk layer", () => {
    const normalized = normalize({
      discover: null,
      load: null,
      quote: null,
      action: null,
      simulation: null,
      errors: { quote: "no verified Kuru market path for this token pair" },
    });
    expect(normalized.integrationStatus).toBe("OK");
    expect(normalized.executionStatus).toBe("NO_ROUTE");
    expect(normalized.errors.value).toEqual([
      expect.objectContaining({
        stage: "QUOTE",
        code: "NO_ROUTE",
        source: "quote",
      }),
    ]);
  });

  it("does not classify decode-revert-data failures as execution reverts", () => {
    const normalized = normalize({
      discover: null,
      load: null,
      quote: null,
      action: null,
      simulation: null,
      errors: { simulate: "failed to decode revert data" },
    });
    expect(normalized.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(normalized.executionStatus).toBe("UNKNOWN");
    expect(normalized.errors.value).toEqual([
      expect.objectContaining({
        stage: "SIMULATE",
        code: "INTEGRATION_ERROR",
        source: "rpc",
      }),
    ]);
  });

  it("retains confirmed simulator reverts without inferring their cause", () => {
    const swap = transaction("0xpool", "0xswap");
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: { protocol: "kuru", method: "swap", transaction: swap },
      simulation: { results: [result(swap, true)] },
    });
    expect(normalized.executionStatus).toBe("REVERTED");
    expect(normalized.revertReason.value).toBe("execution reverted");
  });

  it("preserves structured error fields exactly", () => {
    const normalized = normalize({
      discover: null,
      load: null,
      quote: null,
      action: null,
      simulation: null,
      errors: {
        quote: {
          stage: "QUOTE",
          code: "NO_ROUTE",
          message: "no path",
          integrationStatus: "OK",
          source: "quote",
        },
        simulate: {
          stage: "SIMULATE",
          code: "INTEGRATION_ERROR",
          message: "rpc down",
          integrationStatus: "INTEGRATION_ERROR",
          source: "rpc",
        },
      },
    });
    expect(normalized.errors.value).toEqual([
      expect.objectContaining({
        stage: "QUOTE",
        code: "NO_ROUTE",
        message: "no path",
        integrationStatus: "OK",
        source: "quote",
        normalization: "PRESERVED",
      }),
      expect.objectContaining({
        stage: "SIMULATE",
        code: "INTEGRATION_ERROR",
        message: "rpc down",
        integrationStatus: "INTEGRATION_ERROR",
        source: "rpc",
        normalization: "PRESERVED",
      }),
    ]);
  });

  it("does not let a structured REVERTED error establish execution revert", () => {
    const normalized = normalize({
      discover: null,
      load: null,
      quote: null,
      action: null,
      simulation: null,
      errors: {
        simulate: {
          stage: "SIMULATE",
          code: "REVERTED",
          message: "execution reverted",
          integrationStatus: "OK",
          source: "rpc",
        },
      },
    });
    expect(normalized.errors.value?.[0]).toMatchObject({
      code: "REVERTED",
      normalization: "PRESERVED",
    });
    expect(normalized.executionStatus).toBe("UNKNOWN");
  });

  it("does not overwrite explicit structured fields with message heuristics", () => {
    const normalized = normalize({
      discover: null,
      load: null,
      quote: null,
      action: null,
      simulation: null,
      errors: {
        quote: {
          stage: "QUOTE",
          code: "INTEGRATION_ERROR",
          message: "no verified Kuru market path",
          integrationStatus: "INTEGRATION_ERROR",
          source: "quote",
        },
      },
    });
    expect(normalized.errors.value?.[0]).toMatchObject({
      stage: "QUOTE",
      code: "INTEGRATION_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
      source: "quote",
      normalization: "PRESERVED",
    });
    expect(normalized.executionStatus).toBe("UNKNOWN");
  });
});

describe("economic boundary provenance", () => {
  it("materializes unavailable provenance when no minimumReceived is supplied", () => {
    const normalized = normalize({
      discover: null,
      load: null,
      quote: { data: { estimatedAmountOut: "1" } },
      action: null,
      simulation: null,
    });
    expect(normalized.intent.minimumReceivedSource).toBe("unavailable");
    expect(normalized.intent.minimumReceived).toBeUndefined();
  });

  it("preserves an explicit boundary source", () => {
    const normalized = normalizeRecordedKuruEvidence({
      intent: {
        chainId: "143",
        sender: "0xsender",
        tokenIn: "MON",
        tokenOut: "USDC",
        amountIn: "1",
        minimumReceived: "9",
        minimumReceivedSource: "user_declared",
      },
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      blockNumber: "1",
      mossVersion: "test",
    });
    expect(normalized.intent.minimumReceivedSource).toBe("user_declared");
    expect(normalized.intent.minimumReceived).toBe("9");
  });

  it("materializes unavailable for a value with missing or unavailable source", () => {
    const normalized = normalizeRecordedKuruEvidence({
      intent: {
        chainId: "143",
        sender: "0xsender",
        tokenIn: "MON",
        tokenOut: "USDC",
        amountIn: "1",
        minimumReceived: "9",
      },
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
      },
      blockNumber: "1",
      mossVersion: "test",
    });
    expect(normalized.intent.minimumReceivedSource).toBe("unavailable");
  });
});
