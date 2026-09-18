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

/**
 * Structural read of one recorded JSON-RPC exchange.
 *
 * A result is usable as qualified evidence only when the HTTP status is
 * successful, the envelope is a valid JSON-RPC 2.0 object, no `error` member is
 * present, and `result` is present with the expected type. A body carrying both
 * `result` and `error`, or a non-2xx body carrying a `result`, is rejected.
 * Never throws, so expected reverts can be classified without silently
 * recovering a success that never happened.
 */
export function readResult(record, expectedType = "string") {
  if (record === null || typeof record !== "object")
    return { ok: false, reason: "record is not an object" };
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
 * Qualification requires all of: a non-null prepared swap; a real two-word
 * `IQuoter` WETH->USDC quote; the exact prepared transaction; a successful
 * pinned `eth_call` whose decoded single-word output equals the quote output; a
 * successful pinned `eth_estimateGas`; and a sender drawn from a transaction
 * pinned to the evidence block. Missing optional-chaining targets can no longer
 * compare as `undefined === undefined` and qualify.
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
  const quoteAmountOut = quote
    ? decodeTwoWordQuote(quote.raw)[0].toString()
    : null;
  if (quoteAmountOut === null) {
    reasons.push("no successful two-word IQuoter WETH_TO_USDC quote");
  } else {
    if (quote.decodedAmountOutAtomic !== quoteAmountOut)
      reasons.push("stored quote amount does not match its raw result");
    if (preparedSwap.quoteAmountOutAtomic !== quoteAmountOut)
      reasons.push(
        "prepared swap quote amount does not match the observed quote",
      );
  }

  const tx = preparedSwap.tx;
  const txValid =
    tx !== null &&
    typeof tx === "object" &&
    isAddress(tx.from) &&
    isAddress(tx.to) &&
    typeof tx.data === "string" &&
    HEX_QUANTITY_PATTERN.test(tx.data) &&
    typeof tx.value === "string" &&
    HEX_QUANTITY_PATTERN.test(tx.value) &&
    tx.chainId === Number(CHAIN_ID);
  if (!txValid)
    reasons.push("exact prepared transaction is missing or malformed");

  const callRecord = byContext.get("preparedSwap.ethCall");
  const callOutcome = callRecord
    ? readResult(callRecord)
    : { ok: false, reason: "record is missing" };
  let callAmountOut = null;
  if (!callOutcome.ok) {
    reasons.push(
      `pinned eth_call is not a successful result: ${callOutcome.reason}`,
    );
  } else {
    try {
      callAmountOut = decodeUint256Word(
        callOutcome.result,
        "preparedSwap.ethCall",
      ).toString();
    } catch (error) {
      reasons.push(
        `pinned eth_call output is not exactly one ABI word: ${error.message}`,
      );
    }
  }
  if (callAmountOut !== null) {
    if (callAmountOut !== quoteAmountOut)
      reasons.push("decoded eth_call output does not match the quote output");
    if (preparedSwap.ethCallAmountOutAtomic !== callAmountOut)
      reasons.push(
        "stored eth_call amount does not match the raw eth_call result",
      );
    if (preparedSwap.ethCall?.result !== callOutcome.result)
      reasons.push(
        "observations.preparedSwap.ethCall does not match the raw record",
      );
  }

  const gasRecord = byContext.get("preparedSwap.ethEstimateGas");
  const gasOutcome = gasRecord
    ? readResult(gasRecord)
    : { ok: false, reason: "record is missing" };
  let gas = null;
  if (!gasOutcome.ok) {
    reasons.push(
      `pinned eth_estimateGas is not a successful result: ${gasOutcome.reason}`,
    );
  } else {
    try {
      gas = decodeQuantity(gasOutcome.result, "preparedSwap.ethEstimateGas");
      if (gas <= 0n) reasons.push("pinned eth_estimateGas is not positive");
    } catch (error) {
      reasons.push(`pinned eth_estimateGas is malformed: ${error.message}`);
    }
  }
  if (gas !== null && gasOutcome.ok) {
    if (preparedSwap.estimatedGas !== gas.toString())
      reasons.push(
        "stored gas estimate does not match the raw estimateGas result",
      );
    if (preparedSwap.ethEstimateGas?.result !== gasOutcome.result)
      reasons.push(
        "observations.preparedSwap.ethEstimateGas does not match the raw record",
      );
  }

  const senderHash = preparedSwap.senderTransactionHash;
  if (typeof senderHash !== "string" || senderHash.length === 0) {
    reasons.push("prepared swap has no pinned public sender transaction");
  } else {
    const senderRecord = byContext.get(`senderCandidate:${senderHash}`);
    const senderOutcome = senderRecord
      ? pinnedSenderFromTransaction(senderRecord, observations?.pinnedBlock)
      : { ok: false, reason: "sender transaction record is missing" };
    if (!senderOutcome.ok) {
      reasons.push(
        `sender transaction provenance is not pinned: ${senderOutcome.reason}`,
      );
    } else if (txValid && senderOutcome.sender !== tx.from.toLowerCase()) {
      reasons.push(
        "prepared transaction sender does not match the pinned sender transaction",
      );
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
 * violation found, so a capture that carries a result on a non-2xx response or
 * both `result` and `error` can never stay silently qualified.
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
  const record = {
    context,
    fetchedAt,
    method,
    params,
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
    `${JSON.stringify({ schemaVersion: "be-063-camelot-readonly-v1", classification: assessment.classification, qualificationReasons: assessment.reasons, real: true, endpointClass: "arbitrum-official-public", repositoryHeadAtCapture: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), source: "https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/", observations, records }, null, 2)}\n`,
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
