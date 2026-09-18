/** Read-only Camelot V3 candidate probe. Never signs or submits transactions. */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const FACTORY = "0xaA37Bea711D585478E1c04b04707cCb0f10D762a";
const QUOTER = "0xe49ef2F48539EA7498605CC1B3a242042cb5FC83";
const ROUTER = "0x171B925C51565F5D2a7d8C494ba3188D304EFD93";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const USDC = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const CANDIDATE_POOL = "0x3965361ea4f9000ae3cf995f553115b2832d0e2d";
const CHAIN_ID = 421614n;
const RPC_VERSION = "2.0";
const QUALIFIED = "QUALIFIED_REAL";
const PARTIAL = "PARTIALLY_QUALIFIED";
/** Canonical Product-accepted scenario: exactly 0.001 WETH of exact input. */
const CANONICAL_AMOUNT_IN = 10n ** 15n;
/** `ISwapRouter.exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))`. */
const EXACT_INPUT_SINGLE_SELECTOR = "0xbc651188";
/** `IQuoter.quoteExactInputSingle(address,address,uint256,uint160)`. */
const QUOTE_EXACT_INPUT_SINGLE_SELECTOR = "0x2d9ebd1d";
const PREPARED_TX_FIELDS = Object.freeze(["data", "from", "to", "value"]);

export const ALLOWED_RPC_METHODS = Object.freeze([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionByHash",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
]);
const allowed = new Set(ALLOWED_RPC_METHODS);

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BLOCK_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_QUANTITY_PATTERN = /^0x[0-9a-fA-F]+$/;
const HEX_BYTES_PATTERN = /^0x[0-9a-fA-F]*$/;
const ABI_WORD_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ABI_WORDS_PATTERN = /^0x(?:[0-9a-fA-F]{64})*$/;

const records = [];
let nextId = 1;

function word(value) {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n || n >= 1n << 256n) throw new Error("ABI word out of range");
  return n.toString(16).padStart(64, "0");
}
function addressWord(address) {
  if (!ADDRESS_PATTERN.test(address)) throw new Error("Invalid address");
  return address.slice(2).toLowerCase().padStart(64, "0");
}
function words(raw) {
  if (!ABI_WORDS_PATTERN.test(raw))
    throw new Error(`Invalid ABI result: ${raw}`);
  return raw.slice(2).match(/.{64}/g) ?? [];
}
function uint(raw, index = 0) {
  return BigInt(`0x${words(raw)[index]}`);
}
function address(raw) {
  return `0x${words(raw)[0].slice(24)}`;
}

function normalizeAddress(value) {
  return typeof value === "string" && ADDRESS_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizeHex(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function decimalToBigInt(value) {
  return typeof value === "string" && /^[0-9]+$/.test(value)
    ? BigInt(value)
    : null;
}

/**
 * Validate the persisted request-side envelope of one recorded exchange.
 *
 * A response can only be attributed to a request when the request side itself
 * is complete: a JSON-RPC 2.0 object carrying an explicit `id`, a method, and
 * an array of params. Records that predate this field (or that had it stripped)
 * are rejected, so a response `id` is never accepted merely because it exists.
 */
export function requestEnvelope(record) {
  if (record === null || typeof record !== "object")
    return { ok: false, reason: "record is not an object" };
  const request = record.request;
  if (request === null || typeof request !== "object" || Array.isArray(request))
    return {
      ok: false,
      reason: "request envelope is missing or not an object",
    };
  if (request.jsonrpc !== RPC_VERSION)
    return {
      ok: false,
      reason: `request JSON-RPC version ${JSON.stringify(request.jsonrpc)} is not ${RPC_VERSION}`,
    };
  if (!Object.hasOwn(request, "id") || request.id === undefined)
    return { ok: false, reason: "request id is missing" };
  if (typeof request.method !== "string" || request.method.length === 0)
    return { ok: false, reason: "request method is missing" };
  if (!Array.isArray(request.params))
    return { ok: false, reason: "request params are missing or not an array" };
  return { ok: true, request };
}

/**
 * Resolve one semantic context to a single request-bound record.
 *
 * The record must carry the expected context, an expected method on both the
 * sanitized request object and the top-level record, and a complete request
 * envelope. Response `id` equality is enforced later by `readResult`.
 */
export function boundRecord(record, { label, method, context }) {
  if (record === null || typeof record !== "object")
    return { ok: false, reason: `${label}: record is missing` };
  if (record.context !== context)
    return {
      ok: false,
      reason: `${label}: record context ${JSON.stringify(record.context)} is not ${context}`,
    };
  const requestOutcome = requestEnvelope(record);
  if (!requestOutcome.ok)
    return { ok: false, reason: `${label}: ${requestOutcome.reason}` };
  if (requestOutcome.request.method !== method)
    return {
      ok: false,
      reason: `${label}: request method ${JSON.stringify(requestOutcome.request.method)} is not ${method}`,
    };
  if (record.method !== method)
    return {
      ok: false,
      reason: `${label}: recorded method ${JSON.stringify(record.method)} is not ${method}`,
    };
  return { ok: true, request: requestOutcome.request };
}

/**
 * Decode the exact `exactInputSingle` calldata emitted by this probe.
 *
 * Field order and ABI shape are fixed by the documented Algebra
 * `ISwapRouter.exactInputSingle` tuple, not guessed: selector followed by seven
 * 32-byte words `(tokenIn, tokenOut, recipient, deadline, amountIn,
 * amountOutMinimum, limitSqrtPrice)`. Any other selector, word count, or
 * non-hex body is rejected.
 */
export function decodeExactInputSingleCalldata(data) {
  if (typeof data !== "string") throw new Error("calldata is not a hex string");
  if (!HEX_BYTES_PATTERN.test(data))
    throw new Error("calldata is not hex-encoded");
  const hex = data.slice(2);
  if (hex.length !== 8 + 7 * 64)
    throw new Error(
      `expected a 4-byte selector and exactly 7 ABI words, got ${hex.length / 2} byte(s)`,
    );
  const selector = `0x${hex.slice(0, 8)}`;
  if (selector !== EXACT_INPUT_SINGLE_SELECTOR)
    throw new Error(
      `selector ${selector} is not the Camelot exactInputSingle selector ${EXACT_INPUT_SINGLE_SELECTOR}`,
    );
  const fields = hex.slice(8).match(/.{64}/g);
  return {
    selector,
    tokenIn: `0x${fields[0].slice(24)}`,
    tokenOut: `0x${fields[1].slice(24)}`,
    recipient: `0x${fields[2].slice(24)}`,
    deadline: BigInt(`0x${fields[3]}`),
    amountIn: BigInt(`0x${fields[4]}`),
    amountOutMinimum: BigInt(`0x${fields[5]}`),
    limitSqrtPrice: BigInt(`0x${fields[6]}`),
  };
}

/**
 * Decode the exact `IQuoter.quoteExactInputSingle` calldata emitted by this
 * probe: selector followed by four 32-byte words `(tokenIn, tokenOut, amountIn,
 * limitSqrtPrice)`.
 */
export function decodeQuoteCalldata(data) {
  if (typeof data !== "string")
    throw new Error("quote calldata is not a hex string");
  if (!HEX_BYTES_PATTERN.test(data))
    throw new Error("quote calldata is not hex-encoded");
  const hex = data.slice(2);
  if (hex.length !== 8 + 4 * 64)
    throw new Error(
      `expected a 4-byte selector and exactly 4 ABI words, got ${hex.length / 2} byte(s)`,
    );
  const selector = `0x${hex.slice(0, 8)}`;
  if (selector !== QUOTE_EXACT_INPUT_SINGLE_SELECTOR)
    throw new Error(
      `selector ${selector} is not the IQuoter quoteExactInputSingle selector ${QUOTE_EXACT_INPUT_SINGLE_SELECTOR}`,
    );
  const fields = hex.slice(8).match(/.{64}/g);
  return {
    selector,
    tokenIn: `0x${fields[0].slice(24)}`,
    tokenOut: `0x${fields[1].slice(24)}`,
    amountIn: BigInt(`0x${fields[2]}`),
    limitSqrtPrice: BigInt(`0x${fields[3]}`),
  };
}

/**
 * Check the transaction params of one prepared `eth_call`/`eth_estimateGas`
 * request against the stored prepared transaction. Addresses and hex quantities
 * are compared case-insensitively; any extra or missing field is rejected so a
 * different transaction cannot ride along under the same context.
 */
export function checkPreparedTxParams(params, preparedTx, label) {
  const reasons = [];
  if (!Array.isArray(params) || params.length !== 2)
    return [`${label} params are not [transactionObject, blockTag]`];
  const [callObject] = params;
  if (
    callObject === null ||
    typeof callObject !== "object" ||
    Array.isArray(callObject)
  )
    return [`${label} transaction params are not an object`];
  const actual = Object.keys(callObject).sort();
  if (
    actual.length !== PREPARED_TX_FIELDS.length ||
    actual.join(",") !== PREPARED_TX_FIELDS.join(",")
  )
    reasons.push(
      `${label} transaction params fields ${JSON.stringify(actual)} are not exactly ${JSON.stringify(PREPARED_TX_FIELDS)}`,
    );
  const expectedFrom = normalizeAddress(preparedTx?.from);
  const expectedTo = normalizeAddress(preparedTx?.to);
  const expectedData = normalizeHex(preparedTx?.data);
  const expectedValue = normalizeHex(preparedTx?.value);
  if (
    normalizeAddress(callObject.from) !== expectedFrom ||
    expectedFrom === null
  )
    reasons.push(`${label} from does not match preparedSwap.tx.from`);
  if (normalizeAddress(callObject.to) !== expectedTo || expectedTo === null)
    reasons.push(`${label} to does not match preparedSwap.tx.to`);
  if (normalizeHex(callObject.data) !== expectedData || expectedData === null)
    reasons.push(`${label} data does not match preparedSwap.tx.data`);
  if (
    normalizeHex(callObject.value) !== expectedValue ||
    expectedValue === null
  )
    reasons.push(`${label} value does not match preparedSwap.tx.value`);
  return reasons;
}

/**
 * Structural read of one recorded JSON-RPC exchange.
 *
 * A result is usable as qualified evidence only when the persisted request
 * envelope is complete (JSON-RPC 2.0, an explicit `id`, a method, and params),
 * the HTTP status is successful, the response is a JSON-RPC 2.0 object carrying
 * an `id` that equals the request `id`, no `error` member is present, and
 * `result` is present with the expected type. A body carrying both `result` and
 * `error`, a non-2xx body carrying a `result`, a missing request or response
 * `id`, and a mismatched `id` are all rejected. Never throws, so expected
 * reverts can be classified without silently recovering a success that never
 * happened.
 */
export function readResult(record, expectedType = "string") {
  if (record === null || typeof record !== "object")
    return { ok: false, reason: "record is not an object" };
  const requestOutcome = requestEnvelope(record);
  if (!requestOutcome.ok) return { ok: false, reason: requestOutcome.reason };
  const request = requestOutcome.request;
  if (
    !Number.isInteger(record.httpStatus) ||
    record.httpStatus < 200 ||
    record.httpStatus >= 300
  )
    return {
      ok: false,
      reason: `HTTP status ${JSON.stringify(record.httpStatus)} is not successful`,
    };
  const body = record.response;
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return { ok: false, reason: "JSON-RPC envelope is not an object" };
  if (body.jsonrpc !== RPC_VERSION)
    return {
      ok: false,
      reason: `JSON-RPC version ${JSON.stringify(body.jsonrpc)} is not ${RPC_VERSION}`,
    };
  // The response must echo the request id. Presence alone is not enough.
  if (!Object.hasOwn(body, "id") || body.id === undefined)
    return { ok: false, reason: "JSON-RPC response id is missing" };
  if (body.id !== request.id)
    return {
      ok: false,
      reason: `JSON-RPC response id ${JSON.stringify(body.id)} does not match request id ${JSON.stringify(request.id)}`,
    };
  // A conforming success envelope omits `error` entirely. Any present error --
  // even alongside a result -- disqualifies the exchange as evidence.
  if (body.error !== undefined)
    return {
      ok: false,
      reason: `JSON-RPC error present: ${JSON.stringify(body.error)}`,
    };
  if (!Object.hasOwn(body, "result"))
    return { ok: false, reason: "JSON-RPC result is missing" };
  const result = body.result;
  const actualType =
    result === null ? "null" : Array.isArray(result) ? "array" : typeof result;
  if (actualType !== expectedType)
    return {
      ok: false,
      reason: `JSON-RPC result type ${actualType} is not ${expectedType}`,
    };
  return { ok: true, result };
}

/** Strict `readResult`: throws instead of returning a rejection. */
export function asResult(record, label, expectedType = "string") {
  const outcome = readResult(record, expectedType);
  if (!outcome.ok) throw new Error(`${label}: ${outcome.reason}`);
  return outcome.result;
}

/**
 * Require exactly one ABI word: 32 bytes, 64 hex characters after `0x`.
 * Rejects empty, short, longer/multi-word, odd-length and non-hex results.
 */
export function readAbiWord(raw, label) {
  if (typeof raw !== "string")
    throw new Error(`${label}: ABI result is not a hex string`);
  if (!HEX_BYTES_PATTERN.test(raw))
    throw new Error(`${label}: ABI result is not hex-encoded`);
  const hex = raw.slice(2);
  if (hex.length === 0) throw new Error(`${label}: ABI result is empty`);
  if (hex.length % 2 !== 0)
    throw new Error(`${label}: ABI result has an odd number of hex digits`);
  if (!ABI_WORD_PATTERN.test(raw))
    throw new Error(
      `${label}: expected exactly one 32-byte ABI word, got ${hex.length / 2} byte(s)`,
    );
  return `0x${hex.toLowerCase()}`;
}

/** Decode a single uint256 ABI word after enforcing the exact width. */
export function decodeUint256Word(raw, label) {
  return BigInt(readAbiWord(raw, label));
}

/** Decode a JSON-RPC quantity such as `eth_estimateGas` output. */
export function decodeQuantity(raw, label) {
  if (typeof raw !== "string")
    throw new Error(`${label}: quantity is not a hex string`);
  if (!HEX_QUANTITY_PATTERN.test(raw))
    throw new Error(`${label}: quantity ${JSON.stringify(raw)} is malformed`);
  return BigInt(raw);
}

function isAddress(value) {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isPinnedBlock(pinnedBlock) {
  return (
    pinnedBlock !== null &&
    typeof pinnedBlock === "object" &&
    typeof pinnedBlock.number === "string" &&
    HEX_QUANTITY_PATTERN.test(pinnedBlock.number) &&
    typeof pinnedBlock.hash === "string" &&
    BLOCK_HASH_PATTERN.test(pinnedBlock.hash)
  );
}

/**
 * A transaction obtained through `eth_getTransactionByHash` may only supply the
 * `from` context when it is pinned to the evidence block: it must exist, carry a
 * valid sender, and its `blockNumber`/`blockHash` must both equal the pinned
 * block. Any mismatch - or missing provenance - rejects the candidate instead of
 * silently using its sender.
 */
export function pinnedSenderFromTransaction(record, pinnedBlock) {
  if (!isPinnedBlock(pinnedBlock))
    return { ok: false, reason: "pinned block number/hash is unavailable" };
  const outcome = readResult(record, "object");
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  const transaction = outcome.result;
  if (transaction === null || Array.isArray(transaction))
    return { ok: false, reason: "transaction result is not an object" };
  const sender = transaction.from;
  if (!isAddress(sender))
    return { ok: false, reason: "transaction has no valid sender" };
  if (
    typeof transaction.blockNumber !== "string" ||
    !HEX_QUANTITY_PATTERN.test(transaction.blockNumber)
  )
    return { ok: false, reason: "transaction has no block number" };
  if (
    typeof transaction.blockHash !== "string" ||
    !BLOCK_HASH_PATTERN.test(transaction.blockHash)
  )
    return { ok: false, reason: "transaction has no block hash" };
  if (BigInt(transaction.blockNumber) !== BigInt(pinnedBlock.number))
    return {
      ok: false,
      reason: `transaction block number ${transaction.blockNumber} does not match pinned block ${pinnedBlock.number}`,
    };
  if (transaction.blockHash.toLowerCase() !== pinnedBlock.hash.toLowerCase())
    return {
      ok: false,
      reason: `transaction block hash ${transaction.blockHash} does not match the pinned block hash`,
    };
  return {
    ok: true,
    sender: sender.toLowerCase(),
    blockNumber: transaction.blockNumber,
    blockHash: transaction.blockHash,
  };
}

/** Decode the two-word `IQuoter.quoteExactInputSingle` result, or `null`. */
function decodeTwoWordQuote(raw) {
  if (typeof raw !== "string" || !ABI_WORDS_PATTERN.test(raw)) return null;
  const hex = raw.slice(2);
  if (hex.length !== 128) return null;
  return [BigInt(`0x${hex.slice(0, 64)}`), BigInt(`0x${hex.slice(64)}`)];
}

function indexByContext(recordList) {
  const byContext = new Map();
  for (const record of recordList) {
    if (
      record &&
      typeof record.context === "string" &&
      !byContext.has(record.context)
    )
      byContext.set(record.context, record);
  }
  return byContext;
}

/**
 * Recompute `QUALIFIED_REAL` from raw records and observations.
 *
 * Qualification proves more than response values: every value that certifies
 * this swap must come from the exact request the evidence claims. Each required
 * observation is bound to one context, one JSON-RPC method, and one persisted
 * request/response id pair; the quote is bound to its canonical Quoter calldata
 * and pinned block; the prepared `eth_call`/`eth_estimateGas` params are bound to
 * the exact `preparedSwap.tx` and pinned block; the sender record is bound to
 * `senderTransactionHash`; and the prepared calldata is decoded against the
 * canonical target (chainId, SwapRouter, WETH -> test USDC, recipient, 0.001
 * WETH amountIn, protection value, deadline and call shape). Missing
 * optional-chaining targets can no longer compare as `undefined === undefined`
 * and qualify.
 */
export function assessQualification({
  observations,
  records: recordList,
} = {}) {
  const reasons = [];
  const byContext = indexByContext(Array.isArray(recordList) ? recordList : []);
  const preparedSwap = observations?.preparedSwap;
  if (preparedSwap === null || typeof preparedSwap !== "object") {
    reasons.push("preparedSwap is missing");
    return { qualified: false, classification: PARTIAL, reasons };
  }

  const pinnedBlock = observations?.pinnedBlock;
  const pinnedOk = isPinnedBlock(pinnedBlock);
  if (!pinnedOk) reasons.push("pinned block number/hash is unavailable");
  const pinnedNumber = pinnedOk ? pinnedBlock.number : null;

  // ---- A. qualifying quote bound to its exact Quoter request --------------------
  const quoteProbes = Array.isArray(observations?.quoteProbes)
    ? observations.quoteProbes
    : [];
  const quote = quoteProbes.find(
    (item) =>
      item?.direction === "WETH_TO_USDC" &&
      item?.version === "IQuoter" &&
      item?.error === null &&
      decodeTwoWordQuote(item?.raw) !== null,
  );
  let quoteAmountOut = null;
  if (!quote) {
    reasons.push("no successful two-word IQuoter WETH_TO_USDC quote");
  } else {
    const context = `quote:${quote.version}:${quote.direction}`;
    const record = byContext.get(context);
    const binding = boundRecord(record, {
      label: context,
      method: "eth_call",
      context,
    });
    if (!binding.ok) {
      reasons.push(
        `qualifying quote is not bound to its request: ${binding.reason}`,
      );
    } else {
      const params = binding.request.params;
      if (
        params.length !== 2 ||
        params[0] === null ||
        typeof params[0] !== "object" ||
        Array.isArray(params[0])
      ) {
        reasons.push("quote request params are not [callObject, blockTag]");
      } else {
        if (normalizeAddress(params[0].to) !== QUOTER.toLowerCase())
          reasons.push("quote request target is not the pinned Camelot Quoter");
        if (params[0].data !== quote.calldata)
          reasons.push(
            "quote request calldata does not match quoteProbes.calldata",
          );
        if (pinnedNumber === null || params[1] !== pinnedNumber)
          reasons.push("quote request block does not match the pinned block");
      }
      try {
        const decodedQuote = decodeQuoteCalldata(quote.calldata);
        if (decodedQuote.tokenIn !== WETH.toLowerCase())
          reasons.push("quote calldata tokenIn is not canonical WETH");
        if (decodedQuote.tokenOut !== USDC.toLowerCase())
          reasons.push("quote calldata tokenOut is not canonical test USDC");
        if (decodedQuote.amountIn !== decimalToBigInt(quote.amountInAtomic))
          reasons.push(
            "quote calldata amountIn does not match the stored quote amountIn",
          );
        if (decodedQuote.limitSqrtPrice !== 0n)
          reasons.push("quote calldata limitSqrtPrice is not zero");
      } catch (error) {
        reasons.push(`quote calldata cannot be decoded: ${error.message}`);
      }
      const outcome = readResult(record);
      if (!outcome.ok) {
        reasons.push(
          `qualifying quote record is not a usable result: ${outcome.reason}`,
        );
      } else {
        const parsed = decodeTwoWordQuote(outcome.result);
        if (parsed === null) {
          reasons.push(
            "qualifying quote raw result is not exactly two ABI words",
          );
        } else {
          quoteAmountOut = parsed[0].toString();
          if (quote.raw !== outcome.result)
            reasons.push(
              "stored quote raw result does not match the raw record",
            );
          if (quote.decodedAmountOutAtomic !== quoteAmountOut)
            reasons.push("stored quote amount does not match its raw result");
          if (quote.decodedFee !== parsed[1].toString())
            reasons.push("stored quote fee does not match its raw result");
          if (parsed[0] <= 0n)
            reasons.push("qualifying quote amountOut is not positive");
        }
      }
    }
  }
  if (
    quoteAmountOut !== null &&
    preparedSwap.quoteAmountOutAtomic !== quoteAmountOut
  )
    reasons.push(
      "prepared swap quote amount does not match the observed quote",
    );

  // ---- E. prepared transaction and calldata semantics ---------------------------
  const tx = preparedSwap.tx;
  let decodedTx = null;
  if (tx === null || typeof tx !== "object" || Array.isArray(tx)) {
    reasons.push("exact prepared transaction is missing or malformed");
  } else {
    if (Number(tx.chainId) !== Number(CHAIN_ID))
      reasons.push("prepared transaction chainId is not 421614");
    if (!isAddress(tx.from))
      reasons.push("prepared transaction has no valid from");
    if (normalizeAddress(tx.to) !== ROUTER.toLowerCase())
      reasons.push(
        "prepared transaction to is not the canonical Camelot SwapRouter",
      );
    if (typeof tx.value !== "string" || !HEX_QUANTITY_PATTERN.test(tx.value))
      reasons.push("prepared transaction value is malformed");
    try {
      decodedTx = decodeExactInputSingleCalldata(tx.data);
      if (decodedTx.tokenIn !== WETH.toLowerCase())
        reasons.push("prepared calldata tokenIn is not canonical WETH");
      if (decodedTx.tokenOut !== USDC.toLowerCase())
        reasons.push("prepared calldata tokenOut is not canonical test USDC");
      if (
        normalizeAddress(tx.from) === null ||
        normalizeAddress(tx.from) !== decodedTx.recipient
      )
        reasons.push(
          "prepared calldata recipient does not match the prepared transaction from",
        );
      if (decodedTx.amountIn !== CANONICAL_AMOUNT_IN)
        reasons.push("prepared calldata amountIn is not exactly 0.001 WETH");
      if (
        typeof tx.value === "string" &&
        HEX_QUANTITY_PATTERN.test(tx.value) &&
        BigInt(tx.value) !== decodedTx.amountIn
      )
        reasons.push(
          "prepared transaction value does not equal the native WETH input amount",
        );
      if (
        decodedTx.amountOutMinimum !==
        decimalToBigInt(preparedSwap.amountOutMinimumAtomic)
      )
        reasons.push(
          "prepared calldata amountOutMinimum does not match the stored protection value",
        );
      if (decodedTx.deadline !== decimalToBigInt(preparedSwap.deadlineUnix))
        reasons.push(
          "prepared calldata deadline does not match the stored deadline",
        );
      if (
        pinnedOk &&
        decodedTx.deadline !== BigInt(pinnedBlock.timestamp) + 3600n
      )
        reasons.push(
          "prepared calldata deadline is not the pinned block timestamp plus one hour",
        );
      if (decodedTx.limitSqrtPrice !== 0n)
        reasons.push("prepared calldata limitSqrtPrice is not zero");
      if (
        quoteAmountOut !== null &&
        decodedTx.amountOutMinimum !== (BigInt(quoteAmountOut) * 99n) / 100n
      )
        reasons.push(
          "prepared calldata amountOutMinimum is not 99% of the observed quote",
        );
    } catch (error) {
      reasons.push(
        `prepared transaction calldata cannot be decoded: ${error.message}`,
      );
    }
    if (normalizeAddress(preparedSwap.route?.tokenIn) !== WETH.toLowerCase())
      reasons.push("prepared route tokenIn is not canonical WETH");
    if (normalizeAddress(preparedSwap.route?.tokenOut) !== USDC.toLowerCase())
      reasons.push("prepared route tokenOut is not canonical test USDC");
    if (
      normalizeAddress(preparedSwap.route?.pool) !==
      CANDIDATE_POOL.toLowerCase()
    )
      reasons.push("prepared route pool is not the canonical Camelot pool");
  }

  // ---- B. prepared swap eth_call bound to the exact prepared tx and block -------
  const callContext = "preparedSwap.ethCall";
  const callRecord = byContext.get(callContext);
  const callBinding = boundRecord(callRecord, {
    label: callContext,
    method: "eth_call",
    context: callContext,
  });
  let callAmountOut = null;
  let callResult = null;
  if (!callBinding.ok) {
    reasons.push(
      `pinned eth_call is not bound to its request: ${callBinding.reason}`,
    );
  } else {
    reasons.push(
      ...checkPreparedTxParams(callBinding.request.params, tx, callContext),
    );
    if (pinnedNumber === null || callBinding.request.params[1] !== pinnedNumber)
      reasons.push(
        "pinned eth_call block parameter does not match the pinned block",
      );
    const outcome = readResult(callRecord);
    if (!outcome.ok) {
      reasons.push(
        `pinned eth_call is not a successful result: ${outcome.reason}`,
      );
    } else {
      callResult = outcome.result;
      try {
        callAmountOut = decodeUint256Word(
          outcome.result,
          callContext,
        ).toString();
      } catch (error) {
        reasons.push(
          `pinned eth_call output is not exactly one ABI word: ${error.message}`,
        );
      }
    }
  }
  if (callAmountOut !== null) {
    if (quoteAmountOut !== null && callAmountOut !== quoteAmountOut)
      reasons.push("decoded eth_call output does not match the quote output");
    if (preparedSwap.ethCallAmountOutAtomic !== callAmountOut)
      reasons.push(
        "stored eth_call amount does not match the raw eth_call result",
      );
  }
  if (callResult !== null && preparedSwap.ethCall?.result !== callResult)
    reasons.push(
      "observations.preparedSwap.ethCall does not match the raw record",
    );

  // ---- C. prepared swap eth_estimateGas bound to the same tx and block ----------
  const gasContext = "preparedSwap.ethEstimateGas";
  const gasRecord = byContext.get(gasContext);
  const gasBinding = boundRecord(gasRecord, {
    label: gasContext,
    method: "eth_estimateGas",
    context: gasContext,
  });
  let gas = null;
  let gasResult = null;
  if (!gasBinding.ok) {
    reasons.push(
      `pinned eth_estimateGas is not bound to its request: ${gasBinding.reason}`,
    );
  } else {
    reasons.push(
      ...checkPreparedTxParams(gasBinding.request.params, tx, gasContext),
    );
    if (pinnedNumber === null || gasBinding.request.params[1] !== pinnedNumber)
      reasons.push(
        "pinned eth_estimateGas block parameter does not match the pinned block",
      );
    const outcome = readResult(gasRecord);
    if (!outcome.ok) {
      reasons.push(
        `pinned eth_estimateGas is not a successful result: ${outcome.reason}`,
      );
    } else {
      gasResult = outcome.result;
      try {
        gas = decodeQuantity(outcome.result, gasContext);
        if (gas <= 0n) reasons.push("pinned eth_estimateGas is not positive");
      } catch (error) {
        reasons.push(`pinned eth_estimateGas is malformed: ${error.message}`);
      }
    }
  }
  if (gas !== null && preparedSwap.estimatedGas !== gas.toString())
    reasons.push(
      "stored gas estimate does not match the raw estimateGas result",
    );
  if (gasResult !== null && preparedSwap.ethEstimateGas?.result !== gasResult)
    reasons.push(
      "observations.preparedSwap.ethEstimateGas does not match the raw record",
    );

  // ---- D. sender transaction bound to the requested hash and pinned block -------
  const senderHash = preparedSwap.senderTransactionHash;
  if (typeof senderHash !== "string" || !BLOCK_HASH_PATTERN.test(senderHash)) {
    reasons.push("prepared swap has no pinned public sender transaction");
  } else {
    const context = `senderCandidate:${senderHash}`;
    const senderRecord = byContext.get(context);
    const binding = boundRecord(senderRecord, {
      label: context,
      method: "eth_getTransactionByHash",
      context,
    });
    if (!binding.ok) {
      reasons.push(
        `sender transaction evidence is not bound to its request: ${binding.reason}`,
      );
    } else {
      const params = binding.request.params;
      if (
        params.length !== 1 ||
        normalizeHex(params[0]) !== senderHash.toLowerCase()
      )
        reasons.push(
          "sender transaction request hash does not match the stored senderTransactionHash",
        );
      const outcome = pinnedSenderFromTransaction(senderRecord, pinnedBlock);
      if (!outcome.ok) {
        reasons.push(
          `sender transaction provenance is not pinned: ${outcome.reason}`,
        );
      } else {
        if (
          normalizeHex(senderRecord.response?.result?.hash) !==
          senderHash.toLowerCase()
        )
          reasons.push(
            "sender transaction result hash does not match the requested hash",
          );
        if (decodedTx !== null && outcome.sender !== decodedTx.recipient)
          reasons.push(
            "prepared calldata recipient does not match the pinned sender transaction",
          );
        if (isAddress(tx?.from) && outcome.sender !== tx.from.toLowerCase())
          reasons.push(
            "prepared transaction sender does not match the pinned sender transaction",
          );
      }
    }
  }

  const qualified = reasons.length === 0;
  return {
    qualified,
    classification: qualified ? QUALIFIED : PARTIAL,
    reasons,
  };
}

/**
 * Structural audit of one stored request record. Returns every integrity
 * violation found, so a capture that carries a result on a non-2xx response,
 * both `result` and `error`, an incomplete request envelope, or a response id
 * that does not match its request id can never stay silently qualified.
 */
export function auditRecord(record, index = 0) {
  const label = `record ${index + 1}`;
  if (record === null || typeof record !== "object")
    return [`${label} is not an object`];
  const reasons = [];
  if (typeof record.context !== "string" || record.context.length === 0)
    reasons.push(`${label} has no context`);
  if (!allowed.has(record.method))
    reasons.push(
      `${label} uses non-allowlisted method ${JSON.stringify(record.method)}`,
    );
  const requestOutcome = requestEnvelope(record);
  if (!requestOutcome.ok) {
    reasons.push(`${label} ${requestOutcome.reason}`);
  } else {
    const request = requestOutcome.request;
    if (request.method !== record.method)
      reasons.push(
        `${label} request method ${JSON.stringify(request.method)} does not match recorded method ${JSON.stringify(record.method)}`,
      );
    if (JSON.stringify(request.params) !== JSON.stringify(record.params))
      reasons.push(`${label} request params do not match the recorded params`);
  }
  if (
    !Number.isInteger(record.httpStatus) ||
    record.httpStatus < 200 ||
    record.httpStatus >= 300
  )
    reasons.push(
      `${label} has non-successful HTTP status ${JSON.stringify(record.httpStatus)}`,
    );
  const body = record.response;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    reasons.push(`${label} JSON-RPC envelope is not an object`);
    return reasons;
  }
  if (body.jsonrpc !== RPC_VERSION)
    reasons.push(`${label} has an invalid JSON-RPC version`);
  if (!Object.hasOwn(body, "id") || body.id === undefined)
    reasons.push(`${label} has no response id`);
  else if (requestOutcome.ok && body.id !== requestOutcome.request.id)
    reasons.push(
      `${label} response id ${JSON.stringify(body.id)} does not match request id ${JSON.stringify(requestOutcome.request.id)}`,
    );
  const hasResult = Object.hasOwn(body, "result");
  const hasError = body.error !== undefined;
  if (hasResult && hasError)
    reasons.push(`${label} contains both result and error`);
  if (!hasResult && !hasError)
    reasons.push(`${label} contains neither result nor error`);
  return reasons;
}

/**
 * Revalidate a stored capture against the hardened probe criteria without any
 * network access. This is the offline replay used to prove that historical real
 * observations still qualify under the tightened rules.
 */
export function revalidateCapture(capture) {
  if (capture === null || typeof capture !== "object")
    return {
      qualified: false,
      classification: PARTIAL,
      reasons: ["capture is not an object"],
      recordCount: 0,
    };
  const reasons = [];
  const recordList = Array.isArray(capture.records) ? capture.records : [];
  if (recordList.length === 0) reasons.push("capture has no raw records");
  recordList.forEach((record, index) => {
    reasons.push(...auditRecord(record, index));
  });
  const assessment = assessQualification({
    observations: capture.observations,
    records: recordList,
  });
  reasons.push(...assessment.reasons);
  const qualified = reasons.length === 0;
  return {
    qualified,
    classification: qualified ? QUALIFIED : PARTIAL,
    reasons,
    recordCount: recordList.length,
  };
}

async function rpc(method, params, context) {
  if (!allowed.has(method)) throw new Error(`Forbidden RPC method: ${method}`);
  const request = { jsonrpc: RPC_VERSION, id: nextId++, method, params };
  const fetchedAt = new Date().toISOString();
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  // Persist the sanitized request alongside the response so the pair can be
  // verified later: method, params, and the JSON-RPC id are all recorded.
  const record = {
    context,
    fetchedAt,
    method,
    params,
    request,
    httpStatus: response.status,
    response: body,
  };
  records.push(record);
  return record;
}
async function call(to, data, block, context) {
  return rpc("eth_call", [{ to, data }, block], context);
}

async function main() {
  const chain = asResult(await rpc("eth_chainId", [], "chain"), "chain");
  if (BigInt(chain) !== CHAIN_ID) throw new Error(`Wrong chain: ${chain}`);
  const head = asResult(
    await rpc("eth_blockNumber", [], "observedHead"),
    "head",
  );
  const blockRecord = await rpc(
    "eth_getBlockByNumber",
    [head, false],
    "pinnedBlock",
  );
  const block = readResult(blockRecord, "object");
  if (!block.ok) throw new Error(`Block read failed: ${block.reason}`);
  if (
    block.result.number !== head ||
    !BLOCK_HASH_PATTERN.test(block.result.hash)
  )
    throw new Error("Block mismatch");
  const observations = {
    chainId: chain,
    observedHead: head,
    pinnedBlock: {
      number: head,
      hash: block.result.hash,
      timestamp: block.result.timestamp,
    },
    contracts: {},
    tokenFacts: {},
    pool: {},
    quoteProbes: [],
    senderCandidateRejections: [],
    preparedSwap: null,
  };

  for (const [name, target] of Object.entries({
    FACTORY,
    QUOTER,
    ROUTER,
    WETH,
    USDC,
    CANDIDATE_POOL,
  })) {
    const code = asResult(
      await rpc("eth_getCode", [target, head], `code:${name}`),
      `${name} code`,
    );
    observations.contracts[name] = {
      address: target,
      codePresent: code !== "0x",
      codeBytes: (code.length - 2) / 2,
    };
    if (code === "0x") throw new Error(`${name} has no code at pinned block`);
  }
  for (const [name, token] of Object.entries({ WETH, USDC })) {
    const decimals = asResult(
      await call(token, "0x313ce567", head, `decimals:${name}`),
      `${name} decimals`,
    );
    const balance = asResult(
      await call(
        token,
        `0x70a08231${addressWord(CANDIDATE_POOL)}`,
        head,
        `poolBalance:${name}`,
      ),
      `${name} pool balance`,
    );
    observations.tokenFacts[name] = {
      address: token,
      decimals: uint(decimals).toString(),
      poolBalanceAtomic: uint(balance).toString(),
    };
    if (uint(decimals) !== 18n) throw new Error(`${name} decimals changed`);
  }
  const foundPool = asResult(
    await call(
      FACTORY,
      `0xd9a641e1${addressWord(WETH)}${addressWord(USDC)}`,
      head,
      "factory.poolByPair",
    ),
    "poolByPair",
  );
  observations.pool.factoryLookup = address(foundPool);
  if (
    observations.pool.factoryLookup.toLowerCase() !==
    CANDIDATE_POOL.toLowerCase()
  )
    throw new Error("Factory does not resolve candidate pool");
  for (const [name, selector] of Object.entries({
    token0: "0x0dfe1681",
    token1: "0xd21220a7",
    liquidity: "0x1a686502",
    safelyGetStateOfAMM: "0x97ce1c51",
    globalState: "0xe76c01e4",
  })) {
    const result = await call(CANDIDATE_POOL, selector, head, `pool.${name}`);
    const outcome = readResult(result);
    if (outcome.ok) {
      observations.pool[name] = outcome.result;
      continue;
    }
    // Only the Integral-only selector is expected to revert; anything else must
    // fail loudly instead of feeding a partial observation into the capture.
    if (name !== "safelyGetStateOfAMM")
      throw new Error(`pool.${name}: ${outcome.reason}`);
    observations.pool[name] = { error: result.response?.error ?? null };
  }
  if (
    address(observations.pool.token0).toLowerCase() !== WETH.toLowerCase() ||
    address(observations.pool.token1).toLowerCase() !== USDC.toLowerCase()
  )
    throw new Error("Pool token order differs from candidate");
  observations.pool.activeLiquidity = uint(
    observations.pool.liquidity,
  ).toString();
  if (BigInt(observations.pool.activeLiquidity) <= 0n)
    throw new Error("Pool has no active liquidity");
  const globalStateWords = words(observations.pool.globalState);
  if (globalStateWords.length !== 8)
    throw new Error("Unexpected globalState shape; do not guess its ABI");
  observations.pool.decodedGlobalState = {
    sqrtPriceX96: BigInt(`0x${globalStateWords[0]}`).toString(),
    tick: Number(BigInt.asIntN(24, BigInt(`0x${globalStateWords[1]}`))),
    feeZto: BigInt(`0x${globalStateWords[2]}`).toString(),
    feeOtz: BigInt(`0x${globalStateWords[3]}`).toString(),
    interpretation:
      "Eight-word directional-fee Algebra globalState; source and deployed-version caveat in README",
  };

  for (const [direction, tokenIn, tokenOut] of [
    ["WETH_TO_USDC", WETH, USDC],
    ["USDC_TO_WETH", USDC, WETH],
  ]) {
    const inputBalance = BigInt(
      observations.tokenFacts[tokenIn === WETH ? "WETH" : "USDC"]
        .poolBalanceAtomic,
    );
    const amountIn =
      inputBalance / 1000n < 10n ** 15n ? inputBalance / 1000n : 10n ** 15n;
    if (amountIn <= 0n) {
      observations.quoteProbes.push({
        direction,
        skipped: "Pool input-token balance is zero or below 1000 atomic units",
      });
      continue;
    }
    for (const [version, selector] of [
      ["IQuoter", "0x2d9ebd1d"],
      ["IQuoterV2", "0x5e5e6e0f"],
    ]) {
      const data = `${selector}${addressWord(tokenIn)}${addressWord(tokenOut)}${word(amountIn)}${word(0n)}`;
      const result = await call(
        QUOTER,
        data,
        head,
        `quote:${version}:${direction}`,
      );
      const outcome = readResult(result);
      const raw = outcome.ok ? outcome.result : null;
      let decodedAmountOutAtomic = null;
      let decodedFee = null;
      let decodeError = null;
      if (typeof raw === "string") {
        const parsed = decodeTwoWordQuote(raw);
        if (parsed) {
          decodedAmountOutAtomic = parsed[0].toString();
          decodedFee = parsed[1].toString();
        } else {
          decodeError = "IQuoter result is not exactly two 32-byte ABI words";
        }
      }
      observations.quoteProbes.push({
        direction,
        version,
        amountInAtomic: amountIn.toString(),
        selection: "min(pool input-token balance / 1000, 0.001 token)",
        calldata: data,
        raw,
        decodedAmountOutAtomic,
        decodedFee,
        decodeError,
        error: outcome.ok ? null : (result.response?.error ?? null),
      });
    }
  }

  const quote = observations.quoteProbes.find(
    (item) =>
      item.direction === "WETH_TO_USDC" &&
      item.version === "IQuoter" &&
      typeof item.raw === "string" &&
      words(item.raw).length === 2,
  );
  if (
    quote &&
    observations.pool.factoryLookup.toLowerCase() ===
      CANDIDATE_POOL.toLowerCase()
  ) {
    const amountIn = BigInt(quote.amountInAtomic);
    if (amountIn !== CANONICAL_AMOUNT_IN)
      throw new Error(
        `Canonical target requires exactly 0.001 WETH exact input, observed ${quote.amountInAtomic}`,
      );
    const amountOut = uint(quote.raw);
    const minOut = (amountOut * 99n) / 100n;
    let publicSender = null;
    let publicSenderBalance = null;
    let publicSenderTransactionHash = null;
    for (const transactionHash of block.result.transactions.slice(0, 8)) {
      const txRecord = await rpc(
        "eth_getTransactionByHash",
        [transactionHash],
        `senderCandidate:${transactionHash}`,
      );
      const senderOutcome = pinnedSenderFromTransaction(
        txRecord,
        observations.pinnedBlock,
      );
      if (!senderOutcome.ok) {
        observations.senderCandidateRejections.push({
          transactionHash,
          reason: senderOutcome.reason,
        });
        continue;
      }
      const balanceRecord = await rpc(
        "eth_getBalance",
        [senderOutcome.sender, head],
        `senderNativeBalance:${senderOutcome.sender}`,
      );
      const balanceOutcome = readResult(balanceRecord);
      if (!balanceOutcome.ok) {
        observations.senderCandidateRejections.push({
          transactionHash,
          reason: `balance read failed: ${balanceOutcome.reason}`,
        });
        continue;
      }
      let balance = null;
      try {
        balance = decodeQuantity(
          balanceOutcome.result,
          `senderNativeBalance:${senderOutcome.sender}`,
        );
      } catch (error) {
        observations.senderCandidateRejections.push({
          transactionHash,
          reason: error.message,
        });
        continue;
      }
      if (balance > amountIn + 10n ** 15n) {
        publicSender = senderOutcome.sender;
        publicSenderBalance = balanceOutcome.result;
        publicSenderTransactionHash = transactionHash;
        break;
      }
    }
    const deadline = BigInt(block.result.timestamp) + 3600n;
    const data = `0xbc651188${addressWord(WETH)}${addressWord(USDC)}${addressWord(publicSender ?? "0x0000000000000000000000000000000000000000")}${word(deadline)}${word(amountIn)}${word(minOut)}${word(0n)}`;
    const tx = {
      from: publicSender,
      to: ROUTER,
      data,
      value: `0x${amountIn.toString(16)}`,
      chainId: Number(CHAIN_ID),
    };
    observations.preparedSwap = {
      tx,
      function:
        "exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))",
      route: {
        tokenIn: WETH,
        tokenOut: USDC,
        pool: CANDIDATE_POOL,
        feeParameter: null,
        limitSqrtPrice: "0",
      },
      quoteAmountOutAtomic: amountOut.toString(),
      amountOutMinimumAtomic: minOut.toString(),
      deadlineUnix: deadline.toString(),
      senderSource: publicSender
        ? "from a public transaction included in the pinned block"
        : "unavailable",
      senderTransactionHash: publicSenderTransactionHash,
      senderNativeBalanceAtPinnedBlock: publicSenderBalance,
      nativeInputHypothesis:
        "Router may wrap msg.value as WETH; verify through pinned eth_call, not inferred from payable ABI alone",
      ethCall: null,
      ethEstimateGas: null,
      ethCallAmountOutAtomic: null,
      estimatedGas: null,
    };
    if (publicSender) {
      const rpcTx = {
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      };
      const swapCall = await rpc(
        "eth_call",
        [rpcTx, head],
        "preparedSwap.ethCall",
      );
      observations.preparedSwap.ethCall = swapCall.response;
      const gas = await rpc(
        "eth_estimateGas",
        [rpcTx, head],
        "preparedSwap.ethEstimateGas",
      );
      observations.preparedSwap.ethEstimateGas = gas.response;
      const callOutcome = readResult(swapCall);
      if (callOutcome.ok) {
        try {
          observations.preparedSwap.ethCallAmountOutAtomic = decodeUint256Word(
            callOutcome.result,
            "preparedSwap.ethCall",
          ).toString();
        } catch (error) {
          observations.preparedSwap.ethCallDecodeError = error.message;
        }
      }
      const gasOutcome = readResult(gas);
      if (gasOutcome.ok) {
        try {
          observations.preparedSwap.estimatedGas = decodeQuantity(
            gasOutcome.result,
            "preparedSwap.ethEstimateGas",
          ).toString();
        } catch (error) {
          observations.preparedSwap.ethEstimateGasDecodeError = error.message;
        }
      }
    }
  }

  const assessment = assessQualification({ observations, records });

  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  const dir = join(
    "fixtures",
    "provider-registry",
    "be-063",
    `camelot-sepolia-real-${stamp}`,
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "capture.json"),
    `${JSON.stringify({ schemaVersion: "be-063-camelot-readonly-v2", classification: assessment.classification, qualificationReasons: assessment.reasons, real: true, endpointClass: "arbitrum-official-public", repositoryHeadAtCapture: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), source: "https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/", observations, records }, null, 2)}\n`,
    { flag: "wx" },
  );
  console.log(
    JSON.stringify(
      {
        dir,
        classification: assessment.classification,
        qualificationReasons: assessment.reasons,
        observations,
      },
      null,
      2,
    ),
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
