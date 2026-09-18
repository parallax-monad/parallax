/**
 * Deterministic regression coverage for the PR #77 evidence-integrity
 * blockers. Every case here is offline: no RPC, no signing, no wallet.
 *
 * Blocker sets 1-4 are the original 44 cases. Blocker sets 5-6 add the
 * request/response id binding and the request-bound qualification rules: a
 * value may only certify this swap when it is tied to the exact JSON-RPC request
 * that produced it.
 */

import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ALLOWED_RPC_METHODS,
  asResult,
  assessQualification,
  auditRecord,
  boundRecord,
  checkPreparedTxParams,
  decodeExactInputSingleCalldata,
  decodeQuantity,
  decodeQuoteCalldata,
  decodeUint256Word,
  pinnedSenderFromTransaction,
  readAbiWord,
  readResult,
  requestEnvelope,
  revalidateCapture,
} from "./camelot-sepolia-real-swap.mjs";

const PINNED_BLOCK = {
  number: "0x1277e714",
  hash: "0x64da70b798bd462b0949e87439e7be1fa7fe5b7e5545598f6d0c3e7ec89a61c7",
  timestamp: "0x6aabe583",
};
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const USDC = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const ROUTER = "0x171B925C51565F5D2a7d8C494ba3188D304EFD93";
const QUOTER = "0xe49ef2F48539EA7498605CC1B3a242042cb5FC83";
const CANDIDATE_POOL = "0x3965361ea4f9000ae3cf995f553115b2832d0e2d";
const SENDER = "0xf5d0f57f31219c04f3b56f26faa5d57274e58528";
const SENDER_TRANSACTION =
  "0x6137a0fbec4f2f5012cf6067944044ccf845d7814a846869bc3b7657e078a7f2";
const QUOTE_AMOUNT_OUT = "15882896725531551";
const QUOTE_FEE = "104";
const AMOUNT_OUT_MIN = "15724067758276235";
const DEADLINE = "1789653907";
const VALUE = "0x38d7ea4c68000";
const QUOTE_RAW =
  "0x00000000000000000000000000000000000000000000000000386d6911545b9f0000000000000000000000000000000000000000000000000000000000000068";
const ETH_CALL_RESULT =
  "0x00000000000000000000000000000000000000000000000000386d6911545b9f";
const ESTIMATE_GAS_RESULT = "0x42616";
const QUOTE_CALL_DATA =
  "0x2d9ebd1d000000000000000000000000980b62da83eff3d4576c647993b0c1d7faf17c73000000000000000000000000b893e3334d4bd6c5ba8277fd559e99ed683a9fc700000000000000000000000000000000000000000000000000038d7ea4c680000000000000000000000000000000000000000000000000000000000000000000";
const CALL_DATA =
  "0xbc651188000000000000000000000000980b62da83eff3d4576c647993b0c1d7faf17c73000000000000000000000000b893e3334d4bd6c5ba8277fd559e99ed683a9fc7000000000000000000000000f5d0f57f31219c04f3b56f26faa5d57274e58528000000000000000000000000000000000000000000000000000000006aabf39300000000000000000000000000000000000000000000000000038d7ea4c680000000000000000000000000000000000000000000000000000037dcf4d127fe8b0000000000000000000000000000000000000000000000000000000000000000";

const FIXTURE_ROOT = new URL(
  "../../fixtures/provider-registry/be-063/",
  import.meta.url,
);
const HISTORICAL_FIXTURE = "camelot-sepolia-real-2026-09-17T13-05-18-025Z";

function rpcRecord(context, result, options = {}) {
  const {
    httpStatus = 200,
    error,
    jsonrpc = "2.0",
    method = "eth_call",
    id = 1,
    params = [],
  } = options;
  const response = { jsonrpc, id };
  if (error !== undefined) response.error = error;
  else response.result = result;
  const record = {
    context,
    fetchedAt: "2026-09-17T13:05:00.000Z",
    method,
    params,
    httpStatus,
    response,
  };
  record.request = Object.hasOwn(options, "request")
    ? options.request
    : { jsonrpc: "2.0", id, method, params };
  return record;
}

function validObservations() {
  return {
    pinnedBlock: { ...PINNED_BLOCK },
    quoteProbes: [
      {
        direction: "WETH_TO_USDC",
        version: "IQuoter",
        amountInAtomic: "1000000000000000",
        calldata: QUOTE_CALL_DATA,
        raw: QUOTE_RAW,
        decodedAmountOutAtomic: QUOTE_AMOUNT_OUT,
        decodedFee: QUOTE_FEE,
        decodeError: null,
        error: null,
      },
    ],
    preparedSwap: {
      tx: {
        from: SENDER,
        to: ROUTER,
        data: CALL_DATA,
        value: VALUE,
        chainId: 421614,
      },
      route: {
        tokenIn: WETH,
        tokenOut: USDC,
        pool: CANDIDATE_POOL,
        feeParameter: null,
        limitSqrtPrice: "0",
      },
      quoteAmountOutAtomic: QUOTE_AMOUNT_OUT,
      amountOutMinimumAtomic: AMOUNT_OUT_MIN,
      deadlineUnix: DEADLINE,
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
    rpcRecord("quote:IQuoter:WETH_TO_USDC", QUOTE_RAW, {
      id: 20,
      params: [{ to: QUOTER, data: QUOTE_CALL_DATA }, PINNED_BLOCK.number],
    }),
    rpcRecord("preparedSwap.ethCall", ETH_CALL_RESULT, {
      id: 28,
      params: [
        { from: SENDER, to: ROUTER, data: CALL_DATA, value: VALUE },
        PINNED_BLOCK.number,
      ],
    }),
    rpcRecord("preparedSwap.ethEstimateGas", ESTIMATE_GAS_RESULT, {
      method: "eth_estimateGas",
      id: 29,
      params: [
        { from: SENDER, to: ROUTER, data: CALL_DATA, value: VALUE },
        PINNED_BLOCK.number,
      ],
    }),
    rpcRecord(
      `senderCandidate:${SENDER_TRANSACTION}`,
      {
        hash: SENDER_TRANSACTION,
        from: SENDER,
        blockNumber: PINNED_BLOCK.number,
        blockHash: PINNED_BLOCK.hash,
      },
      {
        method: "eth_getTransactionByHash",
        id: 26,
        params: [SENDER_TRANSACTION],
      },
    ),
  ];
}

function validCapture() {
  return { observations: validObservations(), records: validRecords() };
}

function recordByContext(records, context) {
  const record = records.find((item) => item.context === context);
  if (!record) throw new Error(`no record for context ${context}`);
  return record;
}

function assess(capture) {
  return assessQualification({
    observations: capture.observations,
    records: capture.records,
  });
}

function reasonText(result) {
  return result.reasons.join(" ");
}

function wordHex(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWordHex(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

/** Replace one 32-byte ABI word (0-based, after the 4-byte selector). */
function replaceCalldataWord(calldata, index, replacementWord) {
  const start = 2 + 8 + index * 64;
  return (
    calldata.slice(0, start) + replacementWord + calldata.slice(start + 64)
  );
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
      const record = rpcRecord("chain", "0x66eee", { httpStatus });
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
    const missing = rpcRecord("chain", "0x1");
    delete missing.response.result;
    expect(() => asResult(missing, "chain")).toThrow(/result is missing/);
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
      asResult(rpcRecord("chain", "0x1", { jsonrpc: "1.0" }), "chain"),
    ).toThrow(/version/);
    const noResponse = rpcRecord("chain", "0x1");
    delete noResponse.response;
    expect(() => asResult(noResponse, "chain")).toThrow(/envelope/);
    const missingResponse = rpcRecord("chain", "0x1");
    delete missingResponse.response;
    expect(() => asResult(missingResponse, "chain")).toThrow(/envelope/);
  });

  it("rejects a record without a successful HTTP status", () => {
    const record = rpcRecord("chain", "0x1");
    delete record.httpStatus;
    expect(() => asResult(record, "chain")).toThrow(/not successful/);
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
  it("qualifies a fully consistent, request-bound evidence set", () => {
    const result = assess(validCapture());
    expect(result.reasons).toEqual([]);
    expect(result.qualified).toBe(true);
    expect(result.classification).toBe("QUALIFIED_REAL");
  });

  it("regression: a null preparedSwap is never QUALIFIED_REAL", () => {
    const capture = validCapture();
    capture.observations.preparedSwap = null;
    const result = assess(capture);
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
    const capture = validCapture();
    capture.observations.quoteProbes = [];
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/IQuoter WETH_TO_USDC quote/);
  });

  it("does not qualify without the exact prepared transaction", () => {
    const capture = validCapture();
    capture.observations.preparedSwap.tx = null;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/prepared transaction/);
  });

  it("does not qualify without the pinned eth_call record", () => {
    const capture = validCapture();
    capture.records = capture.records.filter(
      (record) => record.context !== "preparedSwap.ethCall",
    );
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/eth_call/);
  });

  it("does not qualify when the decoded eth_call output differs from the quote", () => {
    const capture = validCapture();
    const widened = `0x${"0".repeat(63)}1`;
    const record = recordByContext(capture.records, "preparedSwap.ethCall");
    record.response.result = widened;
    capture.observations.preparedSwap.ethCall = {
      jsonrpc: "2.0",
      id: 28,
      result: widened,
    };
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/does not match the quote output/);
  });

  it("does not qualify without the pinned eth_estimateGas record", () => {
    const capture = validCapture();
    capture.records = capture.records.filter(
      (record) => record.context !== "preparedSwap.ethEstimateGas",
    );
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/eth_estimateGas/);
  });
});

describe("Blocker 3 — sender transaction pinned-block provenance", () => {
  function transaction(overrides = {}) {
    return {
      hash: SENDER_TRANSACTION,
      from: SENDER,
      blockNumber: PINNED_BLOCK.number,
      blockHash: PINNED_BLOCK.hash,
      ...overrides,
    };
  }

  it("accepts a transaction pinned to the evidence block", () => {
    const outcome = pinnedSenderFromTransaction(
      rpcRecord("senderCandidate:0xaa", transaction(), {
        method: "eth_getTransactionByHash",
        params: [SENDER_TRANSACTION],
      }),
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
    const capture = validCapture();
    const record = recordByContext(
      capture.records,
      `senderCandidate:${SENDER_TRANSACTION}`,
    );
    record.response.result = transaction({ blockNumber: "0x1277e713" });
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/provenance is not pinned/);
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
    const capture = validCapture();
    const widened = `${ETH_CALL_RESULT}${"00".repeat(32)}`;
    const record = recordByContext(capture.records, "preparedSwap.ethCall");
    record.response.result = widened;
    capture.observations.preparedSwap.ethCall = {
      jsonrpc: "2.0",
      id: 28,
      result: widened,
    };
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/exactly one ABI word/);
  });
});

describe("Blocker 5 — JSON-RPC request/response id binding", () => {
  it("passes when the response id equals a persisted request id", () => {
    const record = rpcRecord("chain", "0x66eee", { id: 7 });
    expect(requestEnvelope(record)).toMatchObject({ ok: true });
    expect(readResult(record)).toEqual({ ok: true, result: "0x66eee" });
  });

  it("fails when the request has no id", () => {
    const record = rpcRecord("chain", "0x66eee", { id: 7 });
    delete record.request.id;
    expect(readResult(record)).toMatchObject({ ok: false });
    expect(() => asResult(record, "chain")).toThrow(/request id is missing/);
  });

  it("fails when the request envelope is absent entirely", () => {
    const record = rpcRecord("chain", "0x66eee", { request: null });
    expect(() => asResult(record, "chain")).toThrow(/request envelope/);
  });

  it("fails when the response has no id even though the request does", () => {
    const record = rpcRecord("chain", "0x66eee", { id: 7 });
    delete record.response.id;
    expect(() => asResult(record, "chain")).toThrow(/response id is missing/);
  });

  it("fails when the response id is present but does not match the request id", () => {
    const record = rpcRecord("chain", "0x66eee", { id: 7 });
    record.response.id = 8;
    expect(() => asResult(record, "chain")).toThrow(
      /does not match request id/,
    );
  });

  it("keeps rejecting a success envelope that also carries an error", () => {
    const record = rpcRecord("chain", "0x66eee", { id: 7 });
    record.response.error = { code: 3, message: "execution reverted" };
    expect(() => asResult(record, "chain")).toThrow(/error present/);
  });

  it("audits request/response id mismatches on every record", () => {
    const capture = validCapture();
    capture.records[0].response.id = 999;
    const failures = capture.records.flatMap((record, index) =>
      auditRecord(record, index),
    );
    expect(failures.join(" ")).toMatch(/does not match request id/);
  });

  it("audits a stripped request id on every record", () => {
    const capture = validCapture();
    delete capture.records[0].request.id;
    const failures = capture.records.flatMap((record, index) =>
      auditRecord(record, index),
    );
    expect(failures.join(" ")).toMatch(/request id is missing/);
  });

  it("resolves a context only when the request method matches", () => {
    const record = rpcRecord("preparedSwap.ethCall", ETH_CALL_RESULT, {
      method: "eth_getCode",
      id: 28,
      params: [{ from: SENDER }, PINNED_BLOCK.number],
    });
    const outcome = boundRecord(record, {
      label: "preparedSwap.ethCall",
      method: "eth_call",
      context: "preparedSwap.ethCall",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/method/);
  });
});

describe("Blocker 6 — qualification bound to the exact requests", () => {
  it("binds the qualifying quote to method, target, calldata and pinned block", () => {
    const record = recordByContext(
      validRecords(),
      "quote:IQuoter:WETH_TO_USDC",
    );
    expect(record.method).toBe("eth_call");
    expect(record.params[0].to).toBe(QUOTER);
    expect(record.params[0].data).toBe(QUOTE_CALL_DATA);
    expect(record.params[1]).toBe(PINNED_BLOCK.number);
    const decodedQuote = decodeQuoteCalldata(QUOTE_CALL_DATA);
    expect(decodedQuote.tokenIn).toBe(WETH.toLowerCase());
    expect(decodedQuote.tokenOut).toBe(USDC.toLowerCase());
    expect(decodedQuote.amountIn).toBe(1000000000000000n);
  });

  it("decodes the exact prepared SwapRouter calldata, not an arbitrary hex blob", () => {
    const decoded = decodeExactInputSingleCalldata(CALL_DATA);
    expect(decoded.tokenIn).toBe(WETH.toLowerCase());
    expect(decoded.tokenOut).toBe(USDC.toLowerCase());
    expect(decoded.recipient).toBe(SENDER.toLowerCase());
    expect(decoded.amountIn).toBe(1000000000000000n);
    expect(decoded.amountOutMinimum).toBe(15724067758276235n);
    expect(decoded.deadline).toBe(1789653907n);
    expect(decoded.limitSqrtPrice).toBe(0n);
  });

  it("T1 fails when the response id is missing", () => {
    const capture = validCapture();
    delete recordByContext(capture.records, "preparedSwap.ethCall").response.id;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/response id is missing/);
  });

  it("T2 fails when the response id is mismatched", () => {
    const capture = validCapture();
    recordByContext(capture.records, "preparedSwap.ethCall").response.id = 999;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/does not match request id/);
  });

  it("T3 fails when the request id is missing", () => {
    const capture = validCapture();
    delete recordByContext(capture.records, "preparedSwap.ethCall").request.id;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/request id is missing/);
  });

  it("T4 fails when the recorded method is changed", () => {
    const capture = validCapture();
    const record = recordByContext(capture.records, "preparedSwap.ethCall");
    record.method = "eth_getCode";
    record.request.method = "eth_getCode";
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/method .* is not eth_call/);
  });

  it("T5 fails when the quote request calldata no longer matches the probe", () => {
    const capture = validCapture();
    const record = recordByContext(
      capture.records,
      "quote:IQuoter:WETH_TO_USDC",
    );
    const other = replaceCalldataWord(
      QUOTE_CALL_DATA,
      2,
      wordHex(2000000000000000n),
    );
    record.params[0].data = other;
    record.request.params[0].data = other;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(
      /quote request calldata does not match quoteProbes.calldata/,
    );
  });

  it("T6 fails when the quote request target is changed", () => {
    const capture = validCapture();
    const record = recordByContext(
      capture.records,
      "quote:IQuoter:WETH_TO_USDC",
    );
    record.params[0].to = USDC;
    record.request.params[0].to = USDC;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/quote request target/);
  });

  it("T7 fails when the quote request block is changed", () => {
    const capture = validCapture();
    const record = recordByContext(
      capture.records,
      "quote:IQuoter:WETH_TO_USDC",
    );
    record.params[1] = "0x1277e713";
    record.request.params[1] = "0x1277e713";
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/quote request block/);
  });

  it("T8 fails when the prepared eth_call tx params are changed", () => {
    const capture = validCapture();
    const record = recordByContext(capture.records, "preparedSwap.ethCall");
    const other = replaceCalldataWord(CALL_DATA, 4, wordHex(2000000000000000n));
    record.params[0].data = other;
    record.request.params[0].data = other;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(
      /data does not match preparedSwap\.tx\.data/,
    );
  });

  it("T9 fails when the prepared eth_call block is changed", () => {
    const capture = validCapture();
    const record = recordByContext(capture.records, "preparedSwap.ethCall");
    record.params[1] = "0x1277e713";
    record.request.params[1] = "0x1277e713";
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(
      /eth_call block parameter does not match the pinned block/,
    );
  });

  it("T10 fails when the estimateGas tx params are changed", () => {
    const capture = validCapture();
    const record = recordByContext(
      capture.records,
      "preparedSwap.ethEstimateGas",
    );
    record.params[0].from = USDC;
    record.request.params[0].from = USDC;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(
      /from does not match preparedSwap\.tx\.from/,
    );
  });

  it("T11 fails when the sender request hash is changed", () => {
    const capture = validCapture();
    const record = recordByContext(
      capture.records,
      `senderCandidate:${SENDER_TRANSACTION}`,
    );
    const otherHash = `0x${"ab".repeat(32)}`;
    record.params[0] = otherHash;
    record.request.params[0] = otherHash;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(
      /sender transaction request hash does not match/,
    );
  });

  it("T12 fails when preparedSwap.tx.data is replaced with 0xdeadbeef", () => {
    const capture = validCapture();
    capture.observations.preparedSwap.tx.data = "0xdeadbeef";
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/calldata cannot be decoded/);
  });

  it("T13 fails when the prepared calldata tokenIn is changed", () => {
    const capture = validCapture();
    capture.observations.preparedSwap.tx.data = replaceCalldataWord(
      CALL_DATA,
      0,
      addressWordHex(USDC),
    );
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/tokenIn is not canonical WETH/);
  });

  it("T14 fails when the prepared calldata tokenOut is changed", () => {
    const capture = validCapture();
    capture.observations.preparedSwap.tx.data = replaceCalldataWord(
      CALL_DATA,
      1,
      addressWordHex(WETH),
    );
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/tokenOut is not canonical test USDC/);
  });

  it("T15 fails when the prepared calldata amountIn is changed", () => {
    const capture = validCapture();
    capture.observations.preparedSwap.tx.data = replaceCalldataWord(
      CALL_DATA,
      4,
      wordHex(2000000000000000n),
    );
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/amountIn is not exactly 0.001 WETH/);
  });

  it("T16 fails when request and response are unrelated under the same context", () => {
    const capture = validCapture();
    const record = recordByContext(capture.records, "preparedSwap.ethCall");
    // Point the "prepared eth_call" record at the quote request/response while
    // keeping the context label: the method matches, the request does not.
    record.params = [
      { to: QUOTER, data: QUOTE_CALL_DATA },
      PINNED_BLOCK.number,
    ];
    record.request.params = record.params;
    record.response.result = QUOTE_RAW;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(
      /does not match preparedSwap\.tx\.(data|to)/,
    );
  });

  it("does not qualify when the prepared tx value no longer matches the WETH input", () => {
    const capture = validCapture();
    capture.observations.preparedSwap.tx.value = "0x1";
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(
      /value does not equal the native WETH input/,
    );
  });

  it("does not qualify when the prepared calldata selector is not exactInputSingle", () => {
    const capture = validCapture();
    capture.observations.preparedSwap.tx.data = `0xdeadbeef${"0".repeat(7 * 64)}`;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/exactInputSingle selector/);
  });

  it("does not qualify when the stored quote values disagree with the raw record", () => {
    const capture = validCapture();
    capture.observations.quoteProbes[0].decodedAmountOutAtomic = "1";
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/stored quote amount does not match/);
  });

  it("does not qualify when the quote record result is unrelated to the calldata", () => {
    const capture = validCapture();
    const record = recordByContext(
      capture.records,
      "quote:IQuoter:WETH_TO_USDC",
    );
    record.response.result = "0xdeadbeef";
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(/two ABI words/);
  });

  it("does not qualify when the estimateGas block parameter is dropped", () => {
    const capture = validCapture();
    const record = recordByContext(
      capture.records,
      "preparedSwap.ethEstimateGas",
    );
    record.params = [record.params[0]];
    record.request.params = record.params;
    const result = assess(capture);
    expect(result.qualified).toBe(false);
    expect(reasonText(result)).toMatch(
      /params are not \[transactionObject, blockTag\]/,
    );
  });

  it("checkPreparedTxParams rejects extra or missing transaction fields", () => {
    const tx = validObservations().preparedSwap.tx;
    expect(
      checkPreparedTxParams(
        [
          {
            from: SENDER,
            to: ROUTER,
            data: CALL_DATA,
            value: VALUE,
            gas: "0x1",
          },
          PINNED_BLOCK.number,
        ],
        tx,
        "x",
      ).join(" "),
    ).toMatch(/fields/);
    expect(
      checkPreparedTxParams(
        [{ from: SENDER }, PINNED_BLOCK.number],
        tx,
        "x",
      ).join(" "),
    ).toMatch(/fields/);
  });

  it("revalidates the synthetic request-bound capture end to end", () => {
    const capture = {
      schemaVersion: "be-063-camelot-readonly-v2",
      observations: validObservations(),
      records: validRecords(),
    };
    const report = revalidateCapture(capture);
    expect(report.reasons).toEqual([]);
    expect(report.qualified).toBe(true);
    expect(report.recordCount).toBe(4);
  });
});

function captureDirs() {
  return readdirSync(FIXTURE_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith("camelot-sepolia-real-"),
    )
    .map((entry) => entry.name)
    .sort();
}

function readCapture(name) {
  return JSON.parse(
    readFileSync(new URL(`${name}/capture.json`, FIXTURE_ROOT), "utf8"),
  );
}

describe("historical BE-063 capture under the hardened validator", () => {
  const capture = readCapture(HISTORICAL_FIXTURE);

  function tamperedCapture() {
    return JSON.parse(JSON.stringify(capture));
  }

  function senderRecord(parsed) {
    const hash = parsed.observations.preparedSwap.senderTransactionHash;
    return parsed.records.find(
      (record) => record.context === `senderCandidate:${hash}`,
    );
  }

  it("is preserved unchanged as historical v1 evidence", () => {
    expect(capture.schemaVersion).toBe("be-063-camelot-readonly-v1");
    expect(capture.real).toBe(true);
    expect(capture.classification).toBe("QUALIFIED_REAL");
    expect(capture.records).toHaveLength(29);
  });

  it("no longer revalidates as QUALIFIED_REAL under the hardened rules", () => {
    const report = revalidateCapture(capture);
    expect(report.qualified).toBe(false);
    expect(report.classification).toBe("PARTIALLY_QUALIFIED");
    expect(report.recordCount).toBe(29);
    expect(report.reasons.join(" ")).toMatch(/request envelope is missing/);
  });

  it("fails the hardened audit because request ids were never recorded", () => {
    const failures = capture.records.flatMap((record, index) =>
      auditRecord(record, index),
    );
    expect(failures.length).toBeGreaterThanOrEqual(29);
    expect(failures.join(" ")).toMatch(/request envelope is missing/);
  });

  it("cannot re-verify sender provenance because its request id is absent", () => {
    const outcome = pinnedSenderFromTransaction(
      senderRecord(capture),
      capture.observations.pinnedBlock,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/request envelope is missing/);
  });

  it("still binds its prepared eth_call output to one ABI word equal to the quote", () => {
    const record = capture.records.find(
      (item) => item.context === "preparedSwap.ethCall",
    );
    const word = readAbiWord(record.response.result, "capture");
    expect(word).toBe(capture.observations.preparedSwap.ethCall.result);
    expect(decodeUint256Word(word, "capture").toString()).toBe(
      capture.observations.preparedSwap.quoteAmountOutAtomic,
    );
  });

  it("still decodes to the canonical WETH -> test USDC prepared transaction", () => {
    expect(capture.observations.preparedSwap.tx.to).toBe(ROUTER);
    const decoded = decodeExactInputSingleCalldata(
      capture.observations.preparedSwap.tx.data,
    );
    expect(decoded.tokenIn).toBe(WETH.toLowerCase());
    expect(decoded.tokenOut).toBe(USDC.toLowerCase());
    expect(decoded.amountIn).toBe(1000000000000000n);
  });

  it("fails the hardened audit when a record is mutated to a non-2xx status", () => {
    const tampered = tamperedCapture();
    tampered.records.find(
      (record) => record.context === "preparedSwap.ethCall",
    ).httpStatus = 500;
    expect(
      auditRecord(
        tampered.records.find(
          (record) => record.context === "preparedSwap.ethCall",
        ),
        0,
      ).join(" "),
    ).toMatch(/non-successful HTTP status/);
  });

  it("fails the hardened audit when a record carries both result and error", () => {
    const tampered = tamperedCapture();
    tampered.records[0].response.error = {
      code: 3,
      message: "execution reverted",
    };
    expect(auditRecord(tampered.records[0], 0).join(" ")).toMatch(
      /both result and error/,
    );
  });

  it("keeps the sender transaction pinned to the block in the raw record", () => {
    const record = senderRecord(capture);
    expect(record.response.result.blockNumber).toBe(
      capture.observations.pinnedBlock.number,
    );
    expect(record.response.result.blockHash).toBe(
      capture.observations.pinnedBlock.hash,
    );
  });
});

describe("live hardened capture fixtures", () => {
  it("preserves the historical capture alongside any new live capture", () => {
    expect(captureDirs()).toContain(HISTORICAL_FIXTURE);
  });

  it("every hardened (v2) live capture qualifies and binds request/response ids", () => {
    const hardened = captureDirs()
      .map((dir) => ({ dir, capture: readCapture(dir) }))
      .filter(
        ({ capture }) => capture.schemaVersion === "be-063-camelot-readonly-v2",
      );
    expect(hardened.length).toBeGreaterThanOrEqual(1);
    for (const { dir, capture } of hardened) {
      const report = revalidateCapture(capture);
      expect(report.reasons, `${dir}: ${report.reasons.join("; ")}`).toEqual(
        [],
      );
      expect(report.qualified, dir).toBe(true);
      expect(report.classification, dir).toBe("QUALIFIED_REAL");
      for (const record of capture.records) {
        const envelope = requestEnvelope(record);
        expect(envelope.ok, `${dir} ${record.context}`).toBe(true);
        expect(record.response.id, `${dir} ${record.context}`).toBe(
          record.request.id,
        );
      }
    }
  });
});
