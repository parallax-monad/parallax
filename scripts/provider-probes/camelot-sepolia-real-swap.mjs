/** Read-only Camelot V3 candidate probe. Never signs or submits transactions. */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const FACTORY = "0xaA37Bea711D585478E1c04b04707cCb0f10D762a";
const QUOTER = "0xe49ef2F48539EA7498605CC1B3a242042cb5FC83";
const ROUTER = "0x171B925C51565F5D2a7d8C494ba3188D304EFD93";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const USDC = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const CANDIDATE_POOL = "0x3965361ea4f9000ae3cf995f553115b2832d0e2d";
const allowed = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionByHash",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
]);
const records = [];
let nextId = 1;

function word(value) {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n || n >= 1n << 256n) throw new Error("ABI word out of range");
  return n.toString(16).padStart(64, "0");
}
function addressWord(address) {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error("Invalid address");
  return address.slice(2).toLowerCase().padStart(64, "0");
}
function words(raw) {
  if (!/^0x(?:[0-9a-f]{64})*$/i.test(raw))
    throw new Error(`Invalid ABI result: ${raw}`);
  return raw.slice(2).match(/.{64}/g) ?? [];
}
function uint(raw, index = 0) {
  return BigInt(`0x${words(raw)[index]}`);
}
function address(raw) {
  return `0x${words(raw)[0].slice(24)}`;
}
function asResult(record, label) {
  if (typeof record.response?.result !== "string")
    throw new Error(
      `${label}: ${JSON.stringify(record.response?.error ?? record.response)}`,
    );
  return record.response.result;
}
async function rpc(method, params, context) {
  if (!allowed.has(method)) throw new Error(`Forbidden RPC method: ${method}`);
  const request = { jsonrpc: "2.0", id: nextId++, method, params };
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

const chain = asResult(await rpc("eth_chainId", [], "chain"), "chain");
if (BigInt(chain) !== 421614n) throw new Error(`Wrong chain: ${chain}`);
const head = asResult(await rpc("eth_blockNumber", [], "observedHead"), "head");
const blockRecord = await rpc(
  "eth_getBlockByNumber",
  [head, false],
  "pinnedBlock",
);
const block = blockRecord.response?.result;
if (!block || typeof block !== "object")
  throw new Error(
    `Block read failed: ${JSON.stringify(blockRecord.response?.error)}`,
  );
if (block.number !== head || !/^0x[0-9a-f]{64}$/i.test(block.hash))
  throw new Error("Block mismatch");
const observations = {
  chainId: chain,
  observedHead: head,
  pinnedBlock: { number: head, hash: block.hash, timestamp: block.timestamp },
  contracts: {},
  tokenFacts: {},
  pool: {},
  quoteProbes: [],
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
  observations.pool.factoryLookup.toLowerCase() !== CANDIDATE_POOL.toLowerCase()
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
  observations.pool[name] = result.response?.result ?? {
    error: result.response?.error ?? null,
  };
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
    const raw = result.response?.result ?? null;
    observations.quoteProbes.push({
      direction,
      version,
      amountInAtomic: amountIn.toString(),
      selection: "min(pool input-token balance / 1000, 0.001 token)",
      calldata: data,
      raw,
      decodedAmountOutAtomic:
        typeof raw === "string" ? uint(raw).toString() : null,
      decodedFee:
        typeof raw === "string" && words(raw).length === 2
          ? uint(raw, 1).toString()
          : null,
      error: result.response?.error ?? null,
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
  observations.pool.factoryLookup.toLowerCase() === CANDIDATE_POOL.toLowerCase()
) {
  const amountIn = BigInt(quote.amountInAtomic);
  const amountOut = uint(quote.raw);
  const minOut = (amountOut * 99n) / 100n;
  let publicSender = null;
  let publicSenderBalance = null;
  let publicSenderTransactionHash = null;
  for (const transactionHash of block.transactions.slice(0, 8)) {
    const txRecord = await rpc(
      "eth_getTransactionByHash",
      [transactionHash],
      `senderCandidate:${transactionHash}`,
    );
    const sender = txRecord.response?.result?.from;
    if (typeof sender !== "string" || !/^0x[0-9a-f]{40}$/i.test(sender))
      continue;
    const balanceRecord = await rpc(
      "eth_getBalance",
      [sender, head],
      `senderNativeBalance:${sender}`,
    );
    const balanceRaw = balanceRecord.response?.result;
    if (typeof balanceRaw !== "string") continue;
    if (BigInt(balanceRaw) > amountIn + 10n ** 15n) {
      publicSender = sender;
      publicSenderBalance = balanceRaw;
      publicSenderTransactionHash = transactionHash;
      break;
    }
  }
  const deadline = BigInt(block.timestamp) + 3600n;
  const data = `0xbc651188${addressWord(WETH)}${addressWord(USDC)}${addressWord(publicSender ?? "0x0000000000000000000000000000000000000000")}${word(deadline)}${word(amountIn)}${word(minOut)}${word(0n)}`;
  const tx = {
    from: publicSender,
    to: ROUTER,
    data,
    value: `0x${amountIn.toString(16)}`,
    chainId: 421614,
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
  };
  if (publicSender) {
    const rpcTx = { from: tx.from, to: tx.to, data: tx.data, value: tx.value };
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
    observations.preparedSwap.ethCallAmountOutAtomic =
      typeof swapCall.response?.result === "string"
        ? uint(swapCall.response.result).toString()
        : null;
    observations.preparedSwap.estimatedGas =
      typeof gas.response?.result === "string"
        ? BigInt(gas.response.result).toString()
        : null;
  }
}

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
const success =
  observations.preparedSwap?.ethCallAmountOutAtomic ===
    observations.preparedSwap?.quoteAmountOutAtomic &&
  observations.preparedSwap?.estimatedGas !== null;
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "capture.json"),
  `${JSON.stringify({ schemaVersion: "be-063-camelot-readonly-v1", classification: success ? "QUALIFIED_REAL" : "PARTIALLY_QUALIFIED", real: true, endpointClass: "arbitrum-official-public", repositoryHeadAtCapture: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), source: "https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/", observations, records }, null, 2)}\n`,
  { flag: "wx" },
);
console.log(JSON.stringify({ dir, observations }, null, 2));
