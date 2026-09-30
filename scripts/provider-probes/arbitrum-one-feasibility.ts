/** #90: one bounded, read-only Arbitrum One × Camelot AMMv3 scenario. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeRpcClient } from "../../apps/api/src/backend/native-rpc-client.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = "scripts/provider-probes/arbitrum-one-feasibility.ts";
const OFFICIAL_RPC = "https://arb1.arbitrum.io/rpc";

/** Persist a source category only, never an endpoint or its credentials. */
export function classifyArbitrumOneEndpoint(endpoint: string) {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Invalid RPC endpoint");
  }
  assert(parsed.protocol === "https:", "HTTPS RPC required");
  // URL parsing normalizes host case, default ports and path segments. Full
  // equality also checks path, credentials, query and fragment; a lookalike
  // host or a credential-bearing variation must not acquire official identity.
  return parsed.href === new URL(OFFICIAL_RPC).href
    ? "official_public_arbitrum_one_https_rpc"
    : "custom_arbitrum_one_https_rpc";
}
const CHAIN_ID = 42161n;
// Deployment identity comes from Camelot's One AMMv3 table, not Sepolia config.
const FACTORY = "0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B";
const QUOTER = "0x0Fc73040b26E9bC8514fA028D998E73A254Fa76E";
const ROUTER = "0x1F721E2E82F6676FCE4eA07A5958cF098D339e18";
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const AMOUNT_IN = 1_000_000_000_000_000n; // 0.001 native ETH
// Confirmed transaction in Arbitrum One block 0x1e66c45f. This is a public
// third-party EOA used only for read-only simulation, not a Parallax user.
const SENDER = "0x61094e6ac4285f18961db65927e0f8b3756379a2";
const SENDER_TX =
  "0x37bb3de61f7b948af13af7810f8e3242ad1f057b213e3427d9834a6f8464ad01";
const SENDER_TX_BLOCK_HASH =
  "0x429f77188f370c8ed08e8280dc48dce8291154f423cc19c496b2b19f687663e9";
const READ_METHODS = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionByHash",
  "eth_estimateGas",
  "eth_gasPrice",
  "debug_traceCall",
]);
const sha = (value: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const word = (address: string) =>
  address.slice(2).toLowerCase().padStart(64, "0");
const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const hex = (value: bigint) => `0x${value.toString(16)}`;
function assert(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
function asUint(value: unknown, label: string): bigint {
  assert(
    typeof value === "string" && /^0x[0-9a-f]+$/i.test(value),
    `${label} is not a hex uint`,
  );
  return BigInt(value);
}
function asAddressWord(value: unknown, label: string): string {
  assert(
    typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value),
    `${label} is not an ABI address`,
  );
  return `0x${value.slice(-40).toLowerCase()}`;
}
function asSymbol(value: unknown, label: string): string {
  assert(
    typeof value === "string" && /^0x(?:[0-9a-f]{64})+$/i.test(value),
    `${label} is not ABI encoded`,
  );
  const words = value.slice(2).match(/.{64}/g) ?? [];
  assert(
    words.length >= 3 && BigInt(`0x${words[0]}`) === 32n,
    `${label} is not an ABI string`,
  );
  const length = Number(BigInt(`0x${words[1]}`));
  assert(length > 0 && length <= 32, `${label} length is unsupported`);
  return Buffer.from(words[2].slice(0, length * 2), "hex").toString("utf8");
}
function asBlock(value: unknown) {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "Block unavailable",
  );
  const block = value as Record<string, unknown>;
  assert(
    typeof block.number === "string" && /^0x[0-9a-f]+$/i.test(block.number),
    "Block number malformed",
  );
  assert(
    typeof block.hash === "string" && /^0x[0-9a-f]{64}$/i.test(block.hash),
    "Block hash malformed",
  );
  assert(
    typeof block.timestamp === "string" &&
      /^0x[0-9a-f]+$/i.test(block.timestamp),
    "Block timestamp malformed",
  );
  return {
    number: block.number,
    hash: block.hash.toLowerCase(),
    timestamp: block.timestamp,
  };
}
type Rpc = ReturnType<typeof createNativeRpcClient>;
async function required(
  rpc: Rpc,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  assert(READ_METHODS.has(method), "Write or unsupported RPC method rejected");
  try {
    return await rpc.request(method, params, { timeoutMs: 20_000 });
  } catch {
    // Provider errors may echo an endpoint. Never persist or print them.
    throw new Error(`${method} required read failed`);
  }
}
async function optional(rpc: Rpc, method: string, params: readonly unknown[]) {
  assert(READ_METHODS.has(method), "Write or unsupported RPC method rejected");
  try {
    return {
      status: "success" as const,
      value: await rpc.request(method, params, { timeoutMs: 20_000 }),
    };
  } catch {
    return { status: "unavailable" as const };
  }
}
async function call(rpc: Rpc, to: string, data: string, tag: string) {
  return required(rpc, "eth_call", [{ to, data }, tag]);
}
async function callUint(
  rpc: Rpc,
  to: string,
  data: string,
  tag: string,
  label: string,
) {
  return asUint(await call(rpc, to, data, tag), label);
}
function decodeCalldata(data: string) {
  assert(
    /^0xbc651188[0-9a-f]{448}$/i.test(data),
    "Router calldata is not seven-word exactInputSingle",
  );
  const words = Array.from({ length: 7 }, (_, index) =>
    data.slice(10 + index * 64, 10 + (index + 1) * 64),
  );
  return {
    tokenIn: `0x${words[0].slice(-40)}`,
    tokenOut: `0x${words[1].slice(-40)}`,
    recipient: `0x${words[2].slice(-40)}`,
    deadline: BigInt(`0x${words[3]}`).toString(),
    amountInAtomic: BigInt(`0x${words[4]}`).toString(),
    amountOutMinimumAtomic: BigInt(`0x${words[5]}`).toString(),
    sqrtPriceLimitX96: BigInt(`0x${words[6]}`).toString(),
  };
}

/** Audit only files present in the current research source tree. */
export function collectArbitrumOneSourceManifest(root = ROOT) {
  const manifestPaths = [
    SCRIPT,
    "apps/api/src/backend/native-rpc-client.ts",
    "apps/api/src/backend/camelot-v3-protocol-adapter.ts",
    "apps/api/src/backend/camelot-v3-binding.ts",
    "apps/api/src/backend/native-rpc-provider.ts",
    "apps/api/src/backend/trace-rpc-evidence-source.ts",
    "apps/api/src/backend/arbitrum-chain-adapter.ts",
    "apps/api/src/backend/arbitrum-account-state-reader.ts",
    "apps/api/src/runtime-config.ts",
    "apps/api/src/bootstrap/backend.ts",
    "apps/web/src/lib/analyze/api-helpers.ts",
    "apps/web/src/lib/analyze/service.ts",
    "packages/contracts/src/common.ts",
    "packages/risk/src/verdict.ts",
    "fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-29T10-09-52-993Z/capture.json",
    "fixtures/provider-registry/be-105/asset-coverage-reverse-2026-09-29T11-44-09.949Z/capture.json",
    "fixtures/provider-registry/be-109/grail-usdc-2026-09-29T13-31-53-975Z/capture.json",
  ];
  // Main removed the qualified-spender and SDK client implementations. They
  // remain historical inputs in the immutable 2026-09-29 capture, but must not
  // be required by a new probe. Missing required current inputs still fail.
  return Object.fromEntries(
    manifestPaths.map((path) => [path, sha(readFileSync(join(root, path)))]),
  );
}

type ArbitrumOneSourceState = {
  readonly sourceHead: string;
  readonly worktreeStatus: string;
  readonly manifest: Record<string, string>;
};

function readSourceState(): ArbitrumOneSourceState {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  const sourceHead = git(["rev-parse", "HEAD"]);
  const manifest = collectArbitrumOneSourceManifest();
  const worktreeStatus = git([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  assert(
    sourceHead === git(["rev-parse", "HEAD"]),
    "Source HEAD changed while reading the manifest",
  );
  return {
    sourceHead,
    worktreeStatus,
    manifest,
  };
}

function assertSameSource(
  expected: ArbitrumOneSourceState,
  actual: ArbitrumOneSourceState,
) {
  assert(
    expected.worktreeStatus === "" && actual.worktreeStatus === "",
    "Capture requires a clean committed source head",
  );
  assert(
    expected.sourceHead === actual.sourceHead &&
      JSON.stringify(expected.manifest) === JSON.stringify(actual.manifest),
    "Source state changed during capture; refusing to write evidence",
  );
}

/** Two complete reads bracket manifest collection before any RPC request. */
export function snapshotArbitrumOneSourceState(read = readSourceState) {
  const before = read();
  assertSameSource(before, read());
  return before;
}

/** Must succeed immediately before creating or writing a new capture. */
export function assertArbitrumOneSourceUnchanged(
  initial: ArbitrumOneSourceState,
  read = readSourceState,
) {
  assertSameSource(initial, snapshotArbitrumOneSourceState(read));
}

async function main() {
  const startedAt = new Date().toISOString();
  const startedNs = process.hrtime.bigint();
  const sourceState = snapshotArbitrumOneSourceState();
  const rpcUrl = process.env.ARBITRUM_ONE_RPC_URL ?? OFFICIAL_RPC;
  const endpointClass = classifyArbitrumOneEndpoint(rpcUrl);
  const rpc = createNativeRpcClient({ rpcUrl });

  // Chain identity is the first RPC observation; no address is queried earlier.
  assert(
    asUint(await required(rpc, "eth_chainId", []), "chainId") === CHAIN_ID,
    "Unexpected chain",
  );
  const pinned = asBlock(
    await required(rpc, "eth_getBlockByNumber", ["latest", false]),
  );
  const tag = pinned.number;
  const blockNumber = BigInt(tag).toString();
  const contracts = {
    factory: FACTORY,
    quoter: QUOTER,
    router: ROUTER,
    weth: WETH,
    usdc: USDC,
  };
  const codeHashes: Record<string, string> = {};
  for (const [name, address] of Object.entries(contracts)) {
    const code = await required(rpc, "eth_getCode", [address, tag]);
    assert(
      typeof code === "string" && /^0x[0-9a-f]+$/i.test(code) && code !== "0x",
      `${name} has no pinned code`,
    );
    codeHashes[name] = sha(code.toLowerCase());
  }
  const wethDecimals = await callUint(
    rpc,
    WETH,
    "0x313ce567",
    tag,
    "WETH decimals",
  );
  const usdcDecimals = await callUint(
    rpc,
    USDC,
    "0x313ce567",
    tag,
    "USDC decimals",
  );
  const wethSymbol = asSymbol(
    await call(rpc, WETH, "0x95d89b41", tag),
    "WETH symbol",
  );
  const usdcSymbol = asSymbol(
    await call(rpc, USDC, "0x95d89b41", tag),
    "USDC symbol",
  );
  assert(
    wethDecimals === 18n &&
      usdcDecimals === 6n &&
      wethSymbol === "WETH" &&
      usdcSymbol === "USDC",
    "Token metadata differs from expected One contracts",
  );

  const pool = asAddressWord(
    await call(rpc, FACTORY, `0xd9a641e1${word(WETH)}${word(USDC)}`, tag),
    "factory pool",
  );
  assert(
    pool !== "0x0000000000000000000000000000000000000000",
    "No direct AMMv3 pool",
  );
  const poolCode = await required(rpc, "eth_getCode", [pool, tag]);
  assert(
    typeof poolCode === "string" && poolCode !== "0x",
    "Pool has no pinned code",
  );
  const token0 = asAddressWord(
    await call(rpc, pool, "0x0dfe1681", tag),
    "pool token0",
  );
  const token1 = asAddressWord(
    await call(rpc, pool, "0xd21220a7", tag),
    "pool token1",
  );
  assert(
    token0 === WETH.toLowerCase() && token1 === USDC.toLowerCase(),
    "Pool token identity changed",
  );
  const liquidity = await callUint(
    rpc,
    pool,
    "0x1a686502",
    tag,
    "active liquidity",
  );
  const poolWeth = await callUint(
    rpc,
    WETH,
    `0x70a08231${word(pool)}`,
    tag,
    "pool WETH",
  );
  const poolUsdc = await callUint(
    rpc,
    USDC,
    `0x70a08231${word(pool)}`,
    tag,
    "pool USDC",
  );
  assert(
    liquidity > 0n && poolWeth > 0n && poolUsdc > 0n,
    "Pool liquidity or reserves are zero",
  );

  const quoteData = `0x2d9ebd1d${word(WETH)}${word(USDC)}${uintWord(AMOUNT_IN)}${uintWord(0n)}`;
  const quoteRaw = await call(rpc, QUOTER, quoteData, tag);
  assert(
    typeof quoteRaw === "string" && /^0x[0-9a-f]{128}$/i.test(quoteRaw),
    "Quoter response ABI differs",
  );
  const amountOut = BigInt(`0x${quoteRaw.slice(2, 66)}`);
  assert(amountOut > 0n, "Quote unavailable");
  const amountOutMinimum = (amountOut * 99n) / 100n;

  const provenanceTx = await required(rpc, "eth_getTransactionByHash", [
    SENDER_TX,
  ]);
  assert(
    typeof provenanceTx === "object" &&
      provenanceTx !== null &&
      !Array.isArray(provenanceTx),
    "Sender provenance transaction unavailable",
  );
  const observedTx = provenanceTx as Record<string, unknown>;
  assert(
    typeof observedTx.from === "string" &&
      observedTx.from.toLowerCase() === SENDER.toLowerCase() &&
      typeof observedTx.blockHash === "string" &&
      observedTx.blockHash.toLowerCase() === SENDER_TX_BLOCK_HASH,
    "Sender provenance mismatch",
  );
  const senderCode = await required(rpc, "eth_getCode", [SENDER, tag]);
  assert(
    senderCode === "0x",
    "Selected sender is not an EOA at the pinned block",
  );
  const nativeBalance = asUint(
    await required(rpc, "eth_getBalance", [SENDER, tag]),
    "sender native balance",
  );
  assert(nativeBalance >= AMOUNT_IN, "Selected sender lacks native input");

  const deadline = asUint(pinned.timestamp, "block timestamp") + 3600n;
  const data = `0xbc651188${word(WETH)}${word(USDC)}${word(SENDER)}${uintWord(deadline)}${uintWord(AMOUNT_IN)}${uintWord(amountOutMinimum)}${uintWord(0n)}`;
  const prepared = {
    from: SENDER,
    to: ROUTER,
    data,
    value: hex(AMOUNT_IN),
    chainId: hex(CHAIN_ID),
  };
  const decoded = decodeCalldata(data);
  assert(
    decoded.tokenIn === WETH.toLowerCase() &&
      decoded.tokenOut === USDC.toLowerCase() &&
      decoded.recipient === SENDER.toLowerCase() &&
      decoded.amountInAtomic === AMOUNT_IN.toString() &&
      decoded.amountOutMinimumAtomic === amountOutMinimum.toString() &&
      decoded.sqrtPriceLimitX96 === "0" &&
      BigInt(prepared.value) === AMOUNT_IN &&
      BigInt(prepared.chainId) === CHAIN_ID,
    "Prepared One transaction binding failed",
  );
  const rpcTx = {
    from: prepared.from,
    to: prepared.to,
    data: prepared.data,
    value: prepared.value,
  };
  const callResult = await optional(rpc, "eth_call", [rpcTx, tag]);
  const gasResult = await optional(rpc, "eth_estimateGas", [rpcTx, tag]);
  const traceResult = await optional(rpc, "debug_traceCall", [
    rpcTx,
    tag,
    { tracer: "callTracer" },
  ]);
  const callAmount =
    callResult.status === "success"
      ? asUint(callResult.value, "router output")
      : null;
  const gasUnits =
    gasResult.status === "success"
      ? asUint(gasResult.value, "gas units")
      : null;
  const gasPrice = asUint(
    await required(rpc, "eth_gasPrice", []),
    "observed gas price",
  );
  const chainRecheck = asUint(
    await required(rpc, "eth_chainId", []),
    "rechecked chain",
  );
  const blockRecheck = asBlock(
    await required(rpc, "eth_getBlockByNumber", [tag, false]),
  );
  assert(
    chainRecheck === CHAIN_ID &&
      blockRecheck.number === tag &&
      blockRecheck.hash === pinned.hash,
    "Chain or pinned block recheck failed",
  );
  const nativeBalanceSufficient =
    gasUnits !== null && nativeBalance >= AMOUNT_IN + gasUnits * gasPrice;
  const qualified =
    callAmount === amountOut &&
    gasUnits !== null &&
    gasUnits > 0n &&
    nativeBalanceSufficient;
  const status = qualified
    ? "ARBITRUM_ONE_FEASIBILITY_QUALIFIED"
    : "BLOCKED_REAL_EXECUTION";
  const finishedAt = new Date().toISOString();
  const capture = {
    schemaVersion: "be-090-arbitrum-one-feasibility-v1",
    status,
    productionSupport: false,
    productAccepted: false,
    real: true,
    readOnly: true,
    noStateOverride: true,
    noWriteRpc: true,
    capturedAt: finishedAt,
    probeTiming: {
      startedAt,
      finishedAt,
      elapsedMs: Number(process.hrtime.bigint() - startedNs) / 1_000_000,
      scope: "this_runner_observation_window_only",
    },
    sourceHead: sourceState.sourceHead,
    endpointClass,
    target: {
      chain: "Arbitrum One",
      chainId: Number(CHAIN_ID),
      protocol: "Camelot AMMv3",
      path: "native ETH to USDC",
      amountInWei: AMOUNT_IN.toString(),
      selectionReason:
        "official AMMv3 deployment facts; factory-linked WETH/USDC direct pool; nonzero liquidity; native input avoids unqualified ERC20 spender",
    },
    authoritativeSources: {
      chain: "https://docs.arbitrum.io/arbitrum-bridge/quickstart",
      deployment:
        "https://docs.camelot.exchange/contracts/arbitrum/one-mainnet/",
    },
    pinnedBlock: {
      number: blockNumber,
      hash: pinned.hash,
      timestamp: BigInt(pinned.timestamp).toString(),
      chainIdRechecked: true,
      blockHashRechecked: true,
    },
    contracts: {
      ...contracts,
      codeHashes,
      poolCodeHash: sha(poolCode.toLowerCase()),
    },
    tokens: {
      input: {
        kind: "native",
        symbol: "ETH",
        decimals: 18,
        wrappedForRoute: WETH,
        nativeRepresentationSource:
          "Arbitrum chain currency plus Camelot WETH deployment",
      },
      output: {
        kind: "erc20",
        address: USDC,
        symbol: usdcSymbol,
        decimals: Number(usdcDecimals),
        decimalsSource: "onchain_at_pinned_block",
      },
      weth: {
        address: WETH,
        symbol: wethSymbol,
        decimals: Number(wethDecimals),
        decimalsSource: "onchain_at_pinned_block",
      },
    },
    route: {
      factory: FACTORY,
      pool,
      token0,
      token1,
      activeLiquidity: liquidity.toString(),
      poolWethBalanceAtomic: poolWeth.toString(),
      poolUsdcBalanceAtomic: poolUsdc.toString(),
    },
    sender: {
      address: SENDER,
      provenance: "confirmed public third-party EOA transaction",
      provenanceTxHash: SENDER_TX,
      provenanceTxBlockHash: SENDER_TX_BLOCK_HASH,
      eoaCodeEmptyAtPinnedBlock: true,
      nativeBalanceWei: nativeBalance.toString(),
      allowance: "NOT_APPLICABLE",
      spender: "NOT_APPLICABLE",
      observedGasPriceWei: gasPrice.toString(),
      nativeBalanceCoversInputAndObservedGas: nativeBalanceSufficient,
    },
    quote: {
      quoter: QUOTER,
      inputAtomic: AMOUNT_IN.toString(),
      outputAtomic: amountOut.toString(),
      outputDecimals: Number(usdcDecimals),
      blockNumber,
      selector: "0x2d9ebd1d",
    },
    prepared: {
      unsignedTransaction: prepared,
      decoded,
      transactionFingerprint: sha(JSON.stringify(prepared)),
      binding: {
        chainId: Number(CHAIN_ID),
        protocol: "camelot-v3",
        factory: FACTORY,
        pool,
        router: ROUTER,
        quoter: QUOTER,
        nativeInputWrappedAs: WETH,
        tokenOut: USDC,
        inputAtomic: AMOUNT_IN.toString(),
        quoteOutputAtomic: amountOut.toString(),
        amountOutMinimumAtomic: amountOutMinimum.toString(),
        protectionPolicy: "99_percent_of_pinned_quote_floor",
        recipient: SENDER,
        txValue: prepared.value,
      },
      construction:
        "explicit One deployment and AMMv3 ABI verified by pinned router eth_call; production Sepolia adapter not reused",
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
        status: traceResult.status,
        rawFingerprint:
          traceResult.status === "success"
            ? sha(JSON.stringify(traceResult.value))
            : null,
      },
    },
    abstractionAssessment: {
      classification: "BACKEND_ARCH_CHANGE",
      configOnly: false,
      reason:
        "Sepolia chain ID and deployments are fixed across runtime config, Camelot adapter/binding, chain adapter, NativeRpcProvider, Trace source, account-state reader, bootstrap, and frontend routing. The shared RPC transport and canonical Contract/Risk shapes are chain-bound but generic.",
      productChangeRequiredForFeasibility: false,
      contractSemanticChangeRequired: false,
      riskSemanticChangeRequired: false,
      backendPromotionImplemented: false,
    },
    limitations: [
      "Read-only external RPC feasibility, not assembled NativeRpcProvider or Backend execution.",
      "The public sender is not a Parallax user or controlled wallet.",
      "The public RPC did not supply debug_traceCall; trace is supplementary and unavailable.",
      "The gas price is an observed current value, not a pinned-block value.",
      "No signing, approval, broadcast, custody, state override, or write RPC occurred.",
      "No Product acceptance or production Arbitrum One support is claimed.",
    ],
    provenance: { manifest: sourceState.manifest, worktreeDirty: false },
  };
  const prescan = JSON.stringify(capture);
  const credentialPattern =
    /rpcUrl|rpc_url|api[_-]?key|private[_-]?key|authorization|bearer|mnemonic|quicknode|alchemy|infura/i;
  assert(
    !prescan.includes(rpcUrl) &&
      !prescan.includes(OFFICIAL_RPC) &&
      !credentialPattern.test(prescan),
    "Capture secret scan failed",
  );
  const referenceUrls = prescan.match(/https?:\/\/[^"\\\s]+/g) ?? [];
  assert(
    referenceUrls.every((url) =>
      ["docs.arbitrum.io", "docs.camelot.exchange"].includes(
        new URL(url).hostname,
      ),
    ),
    "Capture contains an unapproved URL",
  );
  const captureWithScan = {
    ...capture,
    secretScan: {
      status: "PASS",
      scope: "normalized_capture_json",
      credentialPatternHits: 0,
      endpointRecorded: false,
      referenceUrlCount: referenceUrls.length,
    },
  };
  const serialized = `${JSON.stringify(captureWithScan, null, 2)}\n`;
  const stamp = capture.capturedAt.replaceAll(":", "-").replaceAll(".", "-");
  const directory = join(
    ROOT,
    "fixtures/provider-registry/be-090",
    `one-eth-usdc-${stamp}`,
  );
  assertArbitrumOneSourceUnchanged(sourceState);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "capture.json");
  writeFileSync(path, serialized, { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({
      status,
      blockNumber,
      pool,
      call: callResult.status,
      gas: gasResult.status,
      trace: traceResult.status,
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
      `Arbitrum One feasibility stopped: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
