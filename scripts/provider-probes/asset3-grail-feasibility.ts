/** #109: bounded, read-only GRAIL candidate qualification. No write RPC. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCamelotV3Transaction } from "../../apps/api/src/backend/camelot-v3-binding.js";
import {
  CAMELOT_SEPOLIA_QUOTER,
  CAMELOT_SEPOLIA_ROUTER,
  CAMELOT_SEPOLIA_USDC,
  createCamelotV3ProtocolAdapter,
} from "../../apps/api/src/backend/camelot-v3-protocol-adapter.js";
import { createNativeRpcClient } from "../../apps/api/src/backend/native-rpc-client.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = "scripts/provider-probes/asset3-grail-feasibility.ts";
const SOURCE_103 =
  "fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-29T10-09-52-993Z/capture.json";
const FACTORY = "0xaA37Bea711D585478E1c04b04707cCb0f10D762a";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const GRAIL = "0x52CFD1d72A64f8D13711bb7Dc3899653dbd4191B";
const XGRAIL = "0x60A186019F81bFD04aFc16c9C01804a04E79e68B";
const SENDER = "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";
const AMOUNT_IN = 1_000_000_000_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const OFFICIAL_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const sha = (value: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const word = (address: string) =>
  address.slice(2).toLowerCase().padStart(64, "0");
const asAddress = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new Error(`${name} is not an ABI address`);
  return `0x${value.slice(-40).toLowerCase()}`;
};
const asUint = (value: unknown, name: string): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error(`${name} is not a hex uint`);
  return BigInt(value);
};
function asSymbol(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{64})+$/i.test(value))
    throw new Error(`${name} is not ABI-encoded`);
  const words = value.slice(2).match(/.{64}/g) ?? [];
  const length = Number(BigInt(`0x${words[1] ?? "0"}`));
  if (BigInt(`0x${words[0]}`) !== 32n || length < 1 || length > 32 || !words[2])
    throw new Error(`${name} is not an ABI string`);
  return Buffer.from(words[2].slice(0, length * 2), "hex").toString("utf8");
}
function assert(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
type Rpc = ReturnType<typeof createNativeRpcClient>;
async function read(
  rpc: Rpc,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  try {
    return await rpc.request(method, params, { timeoutMs: 15_000 });
  } catch {
    throw new Error(`${method} required observation failed`);
  }
}
async function optional(rpc: Rpc, method: string, params: readonly unknown[]) {
  try {
    return {
      status: "success" as const,
      value: await rpc.request(method, params, { timeoutMs: 15_000 }),
    };
  } catch {
    return { status: "unavailable" as const };
  }
}
async function callUint(
  rpc: Rpc,
  to: string,
  data: string,
  tag: string,
  name: string,
) {
  return asUint(await read(rpc, "eth_call", [{ to, data }, tag]), name);
}
async function poolFor(rpc: Rpc, a: string, b: string, tag: string) {
  return asAddress(
    await read(rpc, "eth_call", [
      { to: FACTORY, data: `0xd9a641e1${word(a)}${word(b)}` },
      tag,
    ]),
    "factory pool",
  );
}
function traceSpender(value: unknown): string | null {
  let spender: string | null = null;
  function visit(node: unknown): void {
    if (typeof node !== "object" || node === null || Array.isArray(node))
      return;
    const entry = node as Record<string, unknown>;
    if (
      typeof entry.from === "string" &&
      typeof entry.to === "string" &&
      typeof entry.input === "string" &&
      entry.to.toLowerCase() === CAMELOT_SEPOLIA_USDC.toLowerCase() &&
      entry.input.toLowerCase().startsWith("0x23b872dd")
    )
      spender = entry.from.toLowerCase();
    if (Array.isArray(entry.calls)) entry.calls.forEach(visit);
  }
  visit(value);
  return spender;
}
function block(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Block unavailable");
  const record = value as Record<string, unknown>;
  assert(
    typeof record.number === "string" && /^0x[0-9a-f]+$/i.test(record.number),
    "Block number malformed",
  );
  assert(
    typeof record.hash === "string" && /^0x[0-9a-f]{64}$/i.test(record.hash),
    "Block hash malformed",
  );
  return { number: record.number, hash: record.hash };
}

async function main() {
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert(dirty.trim() === "", "Capture requires a clean committed source head");
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL ?? OFFICIAL_RPC;
  assert(new URL(rpcUrl).protocol === "https:", "HTTPS RPC required");
  const rpc = createNativeRpcClient({ rpcUrl });
  const chain = asUint(await read(rpc, "eth_chainId", []), "chainId");
  assert(chain === 421614n, "Wrong chain");
  const pinned = block(
    await read(rpc, "eth_getBlockByNumber", ["latest", false]),
  );
  const tag = pinned.number;
  const blockNumber = BigInt(tag).toString();

  // Candidate addresses are from Camelot's Arbitrum Sepolia contract documentation.
  // Selection is made from pinned factory and pool observations below.
  const candidates = [];
  for (const [symbol, address] of [
    ["GRAIL", GRAIL],
    ["xGRAIL", XGRAIL],
  ] as const) {
    const code = await read(rpc, "eth_getCode", [address, tag]);
    assert(
      typeof code === "string" && code !== "0x",
      `${symbol} has no contract code`,
    );
    const decimals = await callUint(
      rpc,
      address,
      "0x313ce567",
      tag,
      `${symbol} decimals`,
    );
    const observedSymbol = asSymbol(
      await read(rpc, "eth_call", [{ to: address, data: "0x95d89b41" }, tag]),
      `${symbol} symbol`,
    );
    assert(observedSymbol === symbol, `${symbol} onchain symbol changed`);
    const wethPool = await poolFor(rpc, address, WETH, tag);
    const usdcPool = await poolFor(rpc, address, CAMELOT_SEPOLIA_USDC, tag);
    candidates.push({
      symbol,
      address,
      decimals: Number(decimals),
      observedSymbol,
      addressSource:
        "https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/",
      decimalsSource: "onchain_at_pinned_block",
      wethPool,
      usdcPool,
    });
  }
  const selected = candidates.find(
    (candidate) => candidate.usdcPool !== ZERO_ADDRESS,
  );
  assert(selected?.symbol === "GRAIL", "No qualified GRAIL/USDC candidate");
  const rejected = candidates
    .filter((candidate) => candidate.symbol !== selected.symbol)
    .map((candidate) => ({
      ...candidate,
      reason: "No direct WETH or USDC Camelot V3 pool at pinned block",
    }));
  assert(
    rejected.every(
      (candidate) =>
        candidate.usdcPool === ZERO_ADDRESS &&
        candidate.wethPool === ZERO_ADDRESS,
    ),
    "Candidate rejection changed",
  );
  const pool = selected.usdcPool;
  const poolCode = await read(rpc, "eth_getCode", [pool, tag]);
  assert(typeof poolCode === "string" && poolCode !== "0x", "Pool has no code");
  const token0 = asAddress(
    await read(rpc, "eth_call", [{ to: pool, data: "0x0dfe1681" }, tag]),
    "token0",
  );
  const token1 = asAddress(
    await read(rpc, "eth_call", [{ to: pool, data: "0xd21220a7" }, tag]),
    "token1",
  );
  assert(
    token0 === GRAIL.toLowerCase() &&
      token1 === CAMELOT_SEPOLIA_USDC.toLowerCase(),
    "Pool token identity changed",
  );
  const liquidity = await callUint(rpc, pool, "0x1a686502", tag, "liquidity");
  const poolGrail = await callUint(
    rpc,
    GRAIL,
    `0x70a08231${word(pool)}`,
    tag,
    "pool GRAIL balance",
  );
  const poolUsdc = await callUint(
    rpc,
    CAMELOT_SEPOLIA_USDC,
    `0x70a08231${word(pool)}`,
    tag,
    "pool USDC balance",
  );
  assert(
    liquidity > 0n && poolGrail > 0n && poolUsdc > 0n,
    "Pool has no active liquidity",
  );
  const usdcDecimals = await callUint(
    rpc,
    CAMELOT_SEPOLIA_USDC,
    "0x313ce567",
    tag,
    "USDC decimals",
  );
  assert(
    usdcDecimals === 18n && selected.decimals === 18,
    "Decimals do not match onchain metadata",
  );
  const usdcBalance = await callUint(
    rpc,
    CAMELOT_SEPOLIA_USDC,
    `0x70a08231${word(SENDER)}`,
    tag,
    "sender USDC balance",
  );
  const allowance = await callUint(
    rpc,
    CAMELOT_SEPOLIA_USDC,
    `0xdd62ed3e${word(SENDER)}${word(CAMELOT_SEPOLIA_ROUTER)}`,
    tag,
    "router allowance",
  );
  const nativeBalance = asUint(
    await read(rpc, "eth_getBalance", [SENDER, tag]),
    "native balance",
  );
  const gasPrice = asUint(await read(rpc, "eth_gasPrice", []), "gas price");
  assert(
    usdcBalance >= AMOUNT_IN && allowance >= AMOUNT_IN && nativeBalance > 0n,
    "No qualifying public account state",
  );
  const intent = {
    chainId: 421614,
    protocol: "camelot-v3" as const,
    sender: SENDER,
    recipient: SENDER,
    recipientSource: "defaulted_from_sender" as const,
    tokenIn: { kind: "erc20" as const, address: CAMELOT_SEPOLIA_USDC },
    tokenOut: { kind: "erc20" as const, address: GRAIL },
    amountInAtomic: AMOUNT_IN.toString(),
    economicBoundary: {
      availability: "unavailable" as const,
      source: "unavailable" as const,
    },
  };
  const adapter = createCamelotV3ProtocolAdapter({
    rpcClient: rpc,
    tokenOutDecimals: selected.decimals,
  });
  const blockContext = { blockNumber, blockHash: pinned.hash };
  const quoteRaw = await adapter.quote(intent, { blockContext });
  assert(
    typeof quoteRaw === "object" &&
      quoteRaw !== null &&
      "amountOutAtomic" in quoteRaw,
    "No quote",
  );
  const quote = quoteRaw as {
    amountOutAtomic: string;
    estimatedAmountOut: string;
    blockNumber: string;
  };
  assert(
    /^[1-9][0-9]*$/.test(quote.amountOutAtomic) &&
      quote.blockNumber === blockNumber,
    "Quote unavailable or unbound",
  );
  const unsigned = await adapter.buildTransaction(intent, {
    quote,
    blockContext,
  });
  const raw = unsigned.payload;
  assert(
    typeof raw.from === "string" &&
      typeof raw.to === "string" &&
      typeof raw.data === "string" &&
      typeof raw.value === "string" &&
      typeof raw.chainId === "string",
    "Prepared tx incomplete",
  );
  const tx = {
    from: raw.from,
    to: raw.to,
    data: raw.data,
    value: raw.value,
    chainId: raw.chainId,
  };
  const binding = inspectCamelotV3Transaction(intent, quote, tx);
  assert(
    binding.ok && tx.value === "0x0",
    "Prepared transaction binding failed",
  );
  const rpcTx = { from: tx.from, to: tx.to, data: tx.data, value: tx.value };
  const call = await optional(rpc, "eth_call", [rpcTx, tag]);
  const gas = await optional(rpc, "eth_estimateGas", [rpcTx, tag]);
  const trace = await optional(rpc, "debug_traceCall", [
    rpcTx,
    tag,
    { tracer: "callTracer" },
  ]);
  const rechecked = block(
    await read(rpc, "eth_getBlockByNumber", [tag, false]),
  );
  assert(
    rechecked.number === pinned.number && rechecked.hash === pinned.hash,
    "Pinned block hash changed",
  );
  const callAmount =
    call.status === "success" ? asUint(call.value, "call amount out") : null;
  const gasUnits =
    gas.status === "success" ? asUint(gas.value, "gas units") : null;
  const observedSpender =
    trace.status === "success" ? traceSpender(trace.value) : null;
  const prior = JSON.parse(
    readFileSync(join(ROOT, SOURCE_103), "utf8"),
  ) as Record<string, unknown>;
  const priorEvaluation = prior.evaluation as {
    callTrace?: {
      status?: string;
      erc20TransferFromObserved?: boolean;
      actualSpender?: string;
    };
  };
  const priorTrace = priorEvaluation.callTrace;
  const priorSpenderBound =
    prior.status === "QUALIFIED_REAL" &&
    priorTrace?.status === "success" &&
    priorTrace.erc20TransferFromObserved === true &&
    priorTrace.actualSpender?.toLowerCase() ===
      CAMELOT_SEPOLIA_ROUTER.toLowerCase();
  const spenderBound =
    observedSpender === CAMELOT_SEPOLIA_ROUTER.toLowerCase() ||
    priorSpenderBound;
  const qualified =
    callAmount !== null &&
    gasUnits !== null &&
    spenderBound &&
    nativeBalance > gasUnits * gasPrice;
  const status = qualified
    ? "QUALIFIED_REAL_FEASIBILITY"
    : "BLOCKED_EXECUTION_OR_SPENDER";
  const manifestPaths = [
    SCRIPT,
    "apps/api/src/backend/camelot-v3-protocol-adapter.ts",
    "apps/api/src/backend/camelot-v3-binding.ts",
    "apps/api/src/backend/native-rpc-client.ts",
    "apps/api/src/trusted-token-registry.ts",
    SOURCE_103,
  ];
  const manifest = Object.fromEntries(
    manifestPaths.map((path) => [path, sha(readFileSync(join(ROOT, path)))]),
  );
  const capture = {
    schemaVersion: "be-109-asset3-feasibility-v1",
    status,
    productionSupport: false,
    real: true,
    readOnly: true,
    noStateOverride: true,
    noWriteRpc: true,
    capturedAt: new Date().toISOString(),
    sourceHead,
    endpointClass: "official_public_https_rpc",
    chain: {
      chainId: Number(chain),
      blockNumber,
      blockHash: pinned.hash,
      blockHashRechecked: true,
    },
    discovery: {
      method:
        "Camelot official token list, pinned factory poolByPair for WETH and USDC, pinned liquidity and quote",
      candidates,
      rejected,
      selected: "GRAIL",
      selectedReason:
        "GRAIL/USDC has a real direct Camelot V3 pool, nonzero liquidity and quote; xGRAIL has no direct route; the #103 public USDC sender retains real balance, router allowance and native gas",
    },
    token: {
      chainId: 421614,
      address: GRAIL,
      symbol: "GRAIL",
      decimals: selected.decimals,
      addressSource: selected.addressSource,
      decimalsSource: "eth_call decimals() at pinned block",
    },
    route: {
      factory: FACTORY,
      pool,
      token0,
      token1,
      activeLiquidity: liquidity.toString(),
      poolGrailBalanceAtomic: poolGrail.toString(),
      poolUsdcBalanceAtomic: poolUsdc.toString(),
    },
    sender: {
      address: SENDER,
      provenance: `public third-party EOA from ${SOURCE_103}; not the user's account`,
      usdcBalanceAtomic: usdcBalance.toString(),
      allowanceAtomic: allowance.toString(),
      spender: CAMELOT_SEPOLIA_ROUTER,
      spenderBinding:
        observedSpender === CAMELOT_SEPOLIA_ROUTER.toLowerCase()
          ? "current_trace_transferFrom"
          : priorSpenderBound
            ? `prior_qualified_USDC_router_trace:${SOURCE_103}`
            : "unverified",
      nativeBalanceWei: nativeBalance.toString(),
      observedGasPriceWei: gasPrice.toString(),
    },
    quote: {
      amountInAtomic: AMOUNT_IN.toString(),
      amountOutAtomic: quote.amountOutAtomic,
      estimatedAmountOut: quote.estimatedAmountOut,
      quoter: CAMELOT_SEPOLIA_QUOTER,
      blockNumber,
    },
    prepared: {
      intent,
      unsignedTransaction: tx,
      transactionFingerprint: sha(JSON.stringify(tx)),
      binding: binding.ok ? binding.binding : null,
      calldataDecodedBy: "inspectCamelotV3Transaction",
      amountOutMinimumPolicy: "99_percent_of_pinned_quote_floor",
    },
    evaluation: {
      ethCall: {
        status: callAmount === null ? "unavailable" : "success",
        amountOutAtomic: callAmount?.toString() ?? null,
      },
      ethEstimateGas: {
        status: gasUnits === null ? "unavailable" : "success",
        gasUnits: gasUnits?.toString() ?? null,
      },
      debugTraceCall: {
        status: trace.status,
        erc20TransferFromObserved: observedSpender !== null,
        actualSpender: observedSpender,
        rawFingerprint:
          trace.status === "success" ? sha(JSON.stringify(trace.value)) : null,
      },
      nativeBalanceCoversObservedGasEstimate:
        gasUnits !== null && nativeBalance > gasUnits * gasPrice,
    },
    limitations: [
      "No transaction was signed, approved, broadcast, or executed onchain.",
      "The selected public sender is not controlled by this probe.",
      "This is Provider feasibility, not Backend composition, browser acceptance, Asset Coverage PASS, or production support.",
      "eth_estimateGas was requested with the pinned block tag; node state-selection semantics are not independently proven.",
    ],
    provenance: { manifest },
  };
  const serialized = `${JSON.stringify(capture, null, 2)}\n`;
  assert(!serialized.includes(rpcUrl), "Endpoint leaked into capture");
  const stamp = capture.capturedAt.replaceAll(":", "-").replaceAll(".", "-");
  const directory = join(
    ROOT,
    "fixtures/provider-registry/be-109",
    `grail-usdc-${stamp}`,
  );
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "capture.json");
  writeFileSync(path, serialized, { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({
      status,
      blockNumber,
      pool,
      call: call.status,
      gas: gas.status,
      trace: trace.status,
      capture: relative(ROOT, path),
      sha256: sha(serialized),
    })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `Asset 3 feasibility stopped: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
