/**
 * Deterministic regression coverage for the four evidence-integrity blockers
 * raised on PR #77. Every case here is offline: no RPC, no signing, no wallet.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ALLOWED_RPC_METHODS,
  asResult,
  assessQualification,
  auditRecord,
  decodeQuantity,
  decodeUint256Word,
  pinnedSenderFromTransaction,
  readAbiWord,
  readResult,
  revalidateCapture,
} from "./camelot-sepolia-real-swap.mjs";

const PINNED_BLOCK = {
  number: "0x1277e714",
  hash: "0x64da70b798bd462b0949e87439e7be1fa7fe5b7e5545598f6d0c3e7ec89a61c7",
};
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const USDC = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const ROUTER = "0x171B925C51565F5D2a7d8C494ba3188D304EFD93";
const SENDER = "0xf5d0f57f31219c04f3b56f26faa5d57274e58528";
const SENDER_TRANSACTION =
  "0x6137a0fbec4f2f5012cf6067944044ccf845d7814a846869bc3b7657e078a7f2";
const QUOTE_AMOUNT_OUT = "15882896725531551";
const QUOTE_RAW =
  "0x00000000000000000000000000000000000000000000000000386d6911545b9f0000000000000000000000000000000000000000000000000000000000000068";
const ETH_CALL_RESULT =
  "0x00000000000000000000000000000000000000000000000000386d6911545b9f";
const ESTIMATE_GAS_RESULT = "0x42616";
const CALL_DATA = `0xbc651188${"0".repeat(7 * 64)}`;

function rpcRecord(
  context,
  result,
  {
    httpStatus = 200,
    error,
    jsonrpc = "2.0",
    method = "eth_call",
    id = 1,
  } = {},
) {
  const response = { jsonrpc, id };
  if (error !== undefined) response.error = error;
  else response.result = result;
  return {
    context,
    fetchedAt: "2026-09-17T13:05:00.000Z",
    method,
    params: [],
    httpStatus,
    response,
  };
}

function validObservations() {
  return {
    pinnedBlock: { ...PINNED_BLOCK, timestamp: "0x6aabe583" },
    quoteProbes: [
      {
        direction: "WETH_TO_USDC",
        version: "IQuoter",
        amountInAtomic: "1000000000000000",
        calldata: "0x2d9ebd1d",
        raw: QUOTE_RAW,
        decodedAmountOutAtomic: QUOTE_AMOUNT_OUT,
        decodedFee: "104",
        decodeError: null,
        error: null,
      },
    ],
    preparedSwap: {
      tx: {
        from: SENDER,
        to: ROUTER,
        data: CALL_DATA,
        value: "0x38d7ea4c68000",
        chainId: 421614,
      },
      quoteAmountOutAtomic: QUOTE_AMOUNT_OUT,
      senderTransactionHash: SENDER_TRANSACTION,
      ethCall: { jsonrpc: "2.0", id: 28, result: ETH_CALL_RESULT },
      ethEstimateGas: { jsonrpc: "2.0", id: 29, result: ESTIMATE_GAS_RESULT },
      ethCallAmountOutAtomic: QUOTE_AMOUNT_OUT,
      estimatedGas: "271894",
    },
  };
}

function validRecords() {
  return [
    rpcRecord("preparedSwap.ethCall", ETH_CALL_RESULT),
    rpcRecord("preparedSwap.ethEstimateGas", ESTIMATE_GAS_RESULT, {
      method: "eth_estimateGas",
    }),
    rpcRecord(`senderCandidate:${SENDER_TRANSACTION}`, {
      from: SENDER,
      blockNumber: PINNED_BLOCK.number,
      blockHash: PINNED_BLOCK.hash,
    }),
  ];
}

describe("Blocker 1 — HTTP and JSON-RPC success validation", () => {
  it("accepts a 2xx, error-free result of the expected type", () => {
    expect(asResult(rpcRecord("chain", "0x66eee"), "chain")).toBe("0x66eee");
    expect(
      asResult(
        rpcRecord("block", { hash: PINNED_BLOCK.hash }),
        "block",
        "object",
      ),
    ).toEqual({ hash: PINNED_BLOCK.hash });
  });

  it("rejects a non-2xx HTTP response even when it carries a result", () => {
    for (const httpStatus of [301, 400, 429, 500, 503]) {
      const record = { ...rpcRecord("chain", "0x66eee"), httpStatus };
      expect(readResult(record)).toMatchObject({ ok: false });
      expect(() => asResult(record, "chain")).toThrow(/not successful/);
    }
  });

  it("rejects a body containing both result and error", () => {
    const record = rpcRecord("chain", "0x66eee");
    record.response.error = { code: -32000, message: "boom" };
    expect(readResult(record)).toMatchObject({ ok: false });
    expect(() => asResult(record, "chain")).toThrow(/error present/);
  });

  it("rejects an error-only body", () => {
    const record = rpcRecord("chain", undefined, {
      error: { code: 3, message: "execution reverted" },
    });
    expect(() => asResult(record, "chain")).toThrow(/error present/);
  });

  it("rejects a missing or wrong-typed result", () => {
    expect(() =>
      asResult(
        { httpStatus: 200, response: { jsonrpc: "2.0", id: 1 } },
        "chain",
      ),
    ).toThrow(/result is missing/);
    expect(() => asResult(rpcRecord("chain", { nope: true }), "chain")).toThrow(
      /result type object is not string/,
    );
    expect(() => asResult(rpcRecord("chain", null), "chain")).toThrow(
      /result type null is not string/,
    );
    expect(() =>
      asResult(rpcRecord("block", ["0x1"]), "block", "object"),
    ).toThrow(/result type array is not object/);
  });

  it("rejects an invalid JSON-RPC envelope", () => {
    expect(() =>
      asResult(
        { httpStatus: 200, response: { id: 1, result: "0x1" } },
        "chain",
      ),
    ).toThrow(/version/);
    expect(() =>
      asResult(
        { httpStatus: 200, response: { jsonrpc: "1.0", id: 1, result: "0x1" } },
        "chain",
      ),
    ).toThrow(/version/);
    expect(() =>
      asResult({ httpStatus: 200, response: "not an object" }, "chain"),
    ).toThrow(/envelope/);
    expect(() => asResult({ httpStatus: 200 }, "chain")).toThrow(/envelope/);
  });

  it("rejects a record without a successful HTTP status", () => {
    expect(() =>
      asResult({ response: { jsonrpc: "2.0", result: "0x1" } }, "chain"),
    ).toThrow(/not successful/);
    expect(() => asResult(undefined, "chain")).toThrow(/not an object/);
  });

  it("keeps the read-only method allowlist", () => {
    expect(
      [...ALLOWED_RPC_METHODS].every((method) =>
        /^eth_[a-zA-Z]+$/.test(method),
      ),
    ).toBe(true);
    expect(
      ALLOWED_RPC_METHODS.some((method) => /send|sign/i.test(method)),
    ).toBe(false);
  });
});

describe("Blocker 2 — cleared prepared swap cannot qualify", () => {
  it("qualifies a fully consistent evidence set", () => {
    const result = assessQualification({
      observations: validObservations(),
      records: validRecords(),
    });
    expect(result.reasons).toEqual([]);
    expect(result.qualified).toBe(true);
    expect(result.classification).toBe("QUALIFIED_REAL");
  });

  it("regression: a null preparedSwap is never QUALIFIED_REAL", () => {
    const observations = validObservations();
    observations.preparedSwap = null;
    const result = assessQualification({
      observations,
      records: validRecords(),
    });
    expect(result.qualified).toBe(false);
    expect(result.classification).toBe("PARTIALLY_QUALIFIED");
    expect(result.reasons).toContain("preparedSwap is missing");
  });

  it("regression: null preparedSwap with no records cannot compare its way to qualified", () => {
    expect(assessQualification().qualified).toBe(false);
    expect(
      assessQualification({ observations: { preparedSwap: null }, records: [] })
        .qualified,
    ).toBe(false);
  });

  it("does not qualify without a real two-word quote", () => {
    const observations = validObservations();
    observations.quoteProbes = [];
    const result = assessQualification({
      observations,
      records: validRecords(),
    });
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/IQuoter WETH_TO_USDC quote/);
  });

  it("does not qualify without the exact prepared transaction", () => {
    const observations = validObservations();
    observations.preparedSwap.tx = null;
    const result = assessQualification({
      observations,
      records: validRecords(),
    });
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/prepared transaction/);
  });

  it("does not qualify without the pinned eth_call record", () => {
    const records = validRecords().filter(
      (record) => record.context !== "preparedSwap.ethCall",
    );
    const result = assessQualification({
      observations: validObservations(),
      records,
    });
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/eth_call/);
  });

  it("does not qualify when the decoded eth_call output differs from the quote", () => {
    const records = validRecords();
    const widened = `0x${"0".repeat(63)}1`;
    records[0] = rpcRecord("preparedSwap.ethCall", widened);
    const observations = validObservations();
    observations.preparedSwap.ethCall = {
      jsonrpc: "2.0",
      id: 28,
      result: widened,
    };
    const result = assessQualification({ observations, records });
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/does not match the quote output/);
  });

  it("does not qualify without the pinned eth_estimateGas record", () => {
    const records = validRecords().filter(
      (record) => record.context !== "preparedSwap.ethEstimateGas",
    );
    const result = assessQualification({
      observations: validObservations(),
      records,
    });
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/eth_estimateGas/);
  });
});

describe("Blocker 3 — sender transaction pinned-block provenance", () => {
  function transaction(overrides = {}) {
    return {
      from: SENDER,
      blockNumber: PINNED_BLOCK.number,
      blockHash: PINNED_BLOCK.hash,
      ...overrides,
    };
  }

  it("accepts a transaction pinned to the evidence block", () => {
    const outcome = pinnedSenderFromTransaction(
      rpcRecord("senderCandidate:0xaa", transaction()),
      PINNED_BLOCK,
    );
    expect(outcome).toEqual({
      ok: true,
      sender: SENDER,
      blockNumber: PINNED_BLOCK.number,
      blockHash: PINNED_BLOCK.hash,
    });
  });

  it("rejects a wrong block number", () => {
    const outcome = pinnedSenderFromTransaction(
      rpcRecord(
        "senderCandidate:0xaa",
        transaction({ blockNumber: "0x1277e713" }),
      ),
      PINNED_BLOCK,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/block number/);
  });

  it("rejects a wrong block hash", () => {
    const outcome = pinnedSenderFromTransaction(
      rpcRecord(
        "senderCandidate:0xaa",
        transaction({ blockHash: `0x${"ab".repeat(32)}` }),
      ),
      PINNED_BLOCK,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/block hash/);
  });

  it("rejects a missing block hash", () => {
    const outcome = pinnedSenderFromTransaction(
      rpcRecord("senderCandidate:0xaa", transaction({ blockHash: undefined })),
      PINNED_BLOCK,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/no block hash/);
  });

  it("rejects a missing block number", () => {
    const outcome = pinnedSenderFromTransaction(
      rpcRecord(
        "senderCandidate:0xaa",
        transaction({ blockNumber: undefined }),
      ),
      PINNED_BLOCK,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/no block number/);
  });

  it("rejects a missing, invalid, unfetchable or reverted transaction", () => {
    for (const result of [
      transaction({ from: undefined }),
      transaction({ from: "0xnot-an-address" }),
      null,
      undefined,
    ]) {
      const outcome = pinnedSenderFromTransaction(
        rpcRecord("senderCandidate:0xaa", result),
        PINNED_BLOCK,
      );
      expect(outcome.ok).toBe(false);
    }
    const reverted = pinnedSenderFromTransaction(
      rpcRecord("senderCandidate:0xaa", undefined, {
        error: { code: -32000, message: "not found" },
      }),
      PINNED_BLOCK,
    );
    expect(reverted.ok).toBe(false);
    expect(reverted.reason).toMatch(/error/);
  });

  it("rejects when the pinned block itself is unavailable", () => {
    const outcome = pinnedSenderFromTransaction(
      rpcRecord("senderCandidate:0xaa", transaction()),
      undefined,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/pinned block/);
  });

  it("does not qualify when the prepared sender transaction is not pinned", () => {
    const records = validRecords();
    records[2] = rpcRecord(
      `senderCandidate:${SENDER_TRANSACTION}`,
      transaction({ blockNumber: "0x1277e713" }),
    );
    const result = assessQualification({
      observations: validObservations(),
      records,
    });
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/provenance is not pinned/);
  });
});

describe("Blocker 4 — strict eth_call ABI output width", () => {
  it("decodes exactly one 32-byte word", () => {
    expect(decodeUint256Word(ETH_CALL_RESULT, "x")).toBe(15882896725531551n);
    const one = `0x${"0".repeat(63)}1`;
    expect(readAbiWord(one, "x")).toBe(one);
    expect(readAbiWord(`0x${"AB".repeat(32)}`, "x")).toBe(
      `0x${"ab".repeat(32)}`,
    );
  });

  it("rejects an empty result", () => {
    expect(() => readAbiWord("0x", "x")).toThrow(/empty/);
  });

  it("rejects a short result", () => {
    expect(() => readAbiWord("0x1234", "x")).toThrow(/32-byte/);
    expect(() => readAbiWord(`0x${"11".repeat(31)}`, "x")).toThrow(/31 byte/);
  });

  it("rejects a longer or multiple-word result", () => {
    expect(() => readAbiWord(`0x${"11".repeat(33)}`, "x")).toThrow(/33 byte/);
    expect(() => readAbiWord(`0x${"11".repeat(64)}`, "x")).toThrow(/64 byte/);
  });

  it("rejects non-hex and odd-length results", () => {
    expect(() => readAbiWord(`0x${"zz".repeat(32)}`, "x")).toThrow(/hex/);
    expect(() => readAbiWord(`0x${"1".repeat(63)}`, "x")).toThrow(/odd/);
  });

  it("rejects a malformed JSON-RPC quantity mistaken for an ABI word", () => {
    expect(() => readAbiWord("0x426161", "x")).toThrow(/32-byte/);
    expect(() => readAbiWord("271894", "x")).toThrow(/hex/);
    expect(() => readAbiWord(42, "x")).toThrow(/hex string/);
  });

  it("still decodes real JSON-RPC quantities for gas", () => {
    expect(decodeQuantity(ESTIMATE_GAS_RESULT, "gas")).toBe(271894n);
    expect(() => decodeQuantity("0x", "gas")).toThrow(/malformed/);
    expect(() => decodeQuantity("42616", "gas")).toThrow(/malformed/);
    expect(() => decodeQuantity(271894, "gas")).toThrow(/hex string/);
  });

  it("does not qualify when the eth_call output is longer than one word", () => {
    const records = validRecords();
    const widened = `${ETH_CALL_RESULT}${"00".repeat(32)}`;
    records[0] = rpcRecord("preparedSwap.ethCall", widened);
    const observations = validObservations();
    observations.preparedSwap.ethCall = {
      jsonrpc: "2.0",
      id: 28,
      result: widened,
    };
    const result = assessQualification({ observations, records });
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/exactly one ABI word/);
  });
});

describe("historical BE-063 capture revalidation", () => {
  const capture = JSON.parse(
    readFileSync(
      new URL(
        "../../fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-17T13-05-18-025Z/capture.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  function tamperedCapture() {
    return JSON.parse(JSON.stringify(capture));
  }

  function senderRecord(parsed) {
    const hash = parsed.observations.preparedSwap.senderTransactionHash;
    return parsed.records.find(
      (record) => record.context === `senderCandidate:${hash}`,
    );
  }

  it("keeps the stored real, QUALIFIED_REAL classification", () => {
    expect(capture.real).toBe(true);
    expect(capture.classification).toBe("QUALIFIED_REAL");
  });

  it("passes every raw-record integrity audit", () => {
    const failures = capture.records.flatMap((record, index) =>
      auditRecord(record, index),
    );
    expect(failures).toEqual([]);
  });

  it("revalidates as QUALIFIED_REAL under the hardened criteria", () => {
    const report = revalidateCapture(capture);
    expect(report.reasons).toEqual([]);
    expect(report.qualified).toBe(true);
    expect(report.classification).toBe("QUALIFIED_REAL");
    expect(report.recordCount).toBe(29);
  });

  it("binds the prepared eth_call output to one ABI word equal to the quote", () => {
    const record = capture.records.find(
      (item) => item.context === "preparedSwap.ethCall",
    );
    const word = readAbiWord(record.response.result, "capture");
    expect(word).toBe(capture.observations.preparedSwap.ethCall.result);
    expect(decodeUint256Word(word, "capture").toString()).toBe(
      capture.observations.preparedSwap.quoteAmountOutAtomic,
    );
  });

  it("binds the prepared sender to the pinned block", () => {
    const outcome = pinnedSenderFromTransaction(
      senderRecord(capture),
      capture.observations.pinnedBlock,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.sender).toBe(capture.observations.preparedSwap.tx.from);
    expect(outcome.blockHash).toBe(capture.observations.pinnedBlock.hash);
  });

  it("uses WETH as the canonical tokenIn and test USDC as tokenOut", () => {
    expect(capture.observations.preparedSwap.tx.to).toBe(ROUTER);
    expect(capture.observations.preparedSwap.route.tokenIn).toBe(WETH);
    expect(capture.observations.preparedSwap.route.tokenOut).toBe(USDC);
  });

  it("fails revalidation when a record is mutated to a non-2xx status", () => {
    const tampered = tamperedCapture();
    tampered.records.find(
      (record) => record.context === "preparedSwap.ethCall",
    ).httpStatus = 500;
    const report = revalidateCapture(tampered);
    expect(report.qualified).toBe(false);
    expect(report.reasons.join(" ")).toMatch(/non-successful HTTP status/);
  });

  it("fails revalidation when the prepared swap is removed", () => {
    const tampered = tamperedCapture();
    tampered.observations.preparedSwap = null;
    expect(revalidateCapture(tampered).qualified).toBe(false);
  });

  it("fails revalidation when the sender transaction block number changes", () => {
    const tampered = tamperedCapture();
    senderRecord(tampered).response.result.blockNumber = "0x1277e713";
    expect(revalidateCapture(tampered).qualified).toBe(false);
  });

  it("fails revalidation when the sender transaction block hash changes", () => {
    const tampered = tamperedCapture();
    senderRecord(tampered).response.result.blockHash = `0x${"ab".repeat(32)}`;
    expect(revalidateCapture(tampered).qualified).toBe(false);
  });

  it("fails revalidation when the eth_call output is widened", () => {
    const tampered = tamperedCapture();
    const record = tampered.records.find(
      (item) => item.context === "preparedSwap.ethCall",
    );
    record.response.result = `${record.response.result}${"00".repeat(32)}`;
    expect(revalidateCapture(tampered).qualified).toBe(false);
  });

  it("fails revalidation when a record carries both result and error", () => {
    const tampered = tamperedCapture();
    tampered.records[0].response.error = {
      code: 3,
      message: "execution reverted",
    };
    expect(revalidateCapture(tampered).qualified).toBe(false);
  });
});
