/** #103: read-only, pinned-block Camelot V3 USDC -> WETH feasibility. */
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
  CAMELOT_SEPOLIA_WETH,
  createCamelotV3ProtocolAdapter,
} from "../../apps/api/src/backend/camelot-v3-protocol-adapter.js";
import { createNativeRpcClient } from "../../apps/api/src/backend/native-rpc-client.js";
import { createTrustedTokenRegistry } from "../../apps/api/src/trusted-token-registry.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = "scripts/provider-probes/usdc-weth-camelot-feasibility.ts";
const ACCEPTED_POOL_CAPTURE =
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
const FACTORY = "0xaA37Bea711D585478E1c04b04707cCb0f10D762a";
const POOL = "0x3965361ea4f9000ae3cf995f553115b2832d0e2d";
const HISTORICAL_EOA = "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396";
const APPROVAL_LOG_OWNER = "0x671d310504bb888dc5c2a6f36468afb49455b4cd";
const QUALIFICATION_SENDER =
  process.env.BE103_QUALIFICATION_SENDER ??
  "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";
const QUALIFICATION_SOURCE =
  process.env.BE103_QUALIFICATION_SOURCE ??
  "full-chain USDC Transfer holder reconstruction + historical router Approval/pool activity";
const APPROVAL_TX =
  "0xfb37b345fa5decc5bd88015edfaa3c65614b2eb039ca334325b08765bd99833f";
const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const CHAIN_ID = 421614;
const AMOUNT_IN = 1_000_000_000_000_000n; // 0.001 testnet USDC, verified 18 decimals
const READ_TIMEOUT_MS = 15_000;

type Rpc = ReturnType<typeof createNativeRpcClient>;
type RpcFailure = { status: "failed"; kind: string; rpcCode: number | null };
type RpcSuccess = { status: "success"; value: unknown };
type RpcOutcome = RpcFailure | RpcSuccess;

function sha256(data: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} is not an address`);
  }
  return value.toLowerCase();
}

function hex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${label} is not a hex quantity`);
  }
  return value;
}

function uintWord(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} is not one ABI word`);
  }
  return BigInt(value);
}

function word(value: string): string {
  return address(value, "ABI address").slice(2).padStart(64, "0");
}

async function required(
  rpc: Rpc,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  try {
    return await rpc.request(method, params, { timeoutMs: READ_TIMEOUT_MS });
  } catch {
    // Never print an RPC error: some providers echo endpoint or request content.
    throw new Error(`${method} failed during required pinned observation`);
  }
}

async function attempt(
  rpc: Rpc,
  method: string,
  params: readonly unknown[],
): Promise<RpcOutcome> {
  try {
    return {
      status: "success",
      value: await rpc.request(method, params, { timeoutMs: READ_TIMEOUT_MS }),
    };
  } catch (error) {
    const candidate = error as { kind?: unknown; rpcCode?: unknown };
    return {
      status: "failed",
      kind: typeof candidate?.kind === "string" ? candidate.kind : "UNKNOWN",
      rpcCode:
        typeof candidate?.rpcCode === "number" ? candidate.rpcCode : null,
    };
  }
}

function block(value: unknown): {
  number: string;
  hash: string;
  timestamp: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pinned block is missing");
  }
  const candidate = value as Record<string, unknown>;
  const number = hex(candidate.number, "block number");
  const hash = candidate.hash;
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("Pinned block hash is invalid");
  }
  return {
    number,
    hash: hash.toLowerCase(),
    timestamp: hex(candidate.timestamp, "timestamp"),
  };
}

function rpcValue(outcome: RpcOutcome): string | null {
  return outcome.status === "success" && typeof outcome.value === "string"
    ? outcome.value
    : null;
}

function traceTransferFrom(value: unknown): {
  observed: boolean;
  spender: string | null;
  fingerprint: string | null;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { observed: false, spender: null, fingerprint: null };
  }
  const root = value as Record<string, unknown>;
  let actualSpender: string | null = null;
  const visit = (entry: Record<string, unknown>): void => {
    if (
      typeof entry.from === "string" &&
      typeof entry.to === "string" &&
      typeof entry.input === "string" &&
      entry.to.toLowerCase() === CAMELOT_SEPOLIA_USDC.toLowerCase() &&
      entry.input.toLowerCase().startsWith("0x23b872dd")
    ) {
      actualSpender = entry.from.toLowerCase();
    }
    if (Array.isArray(entry.calls)) {
      for (const child of entry.calls) {
        if (
          typeof child === "object" &&
          child !== null &&
          !Array.isArray(child)
        ) {
          visit(child as Record<string, unknown>);
        }
      }
    }
  };
  visit(root);
  return {
    observed: actualSpender !== null,
    spender: actualSpender,
    fingerprint: sha256(JSON.stringify(value)),
  };
}

export function classifyUsdcWethFeasibility(input: {
  readonly spenderVerified: boolean;
  readonly balanceSufficient: boolean;
  readonly allowanceSufficient: boolean;
  readonly ethCallSucceeded: boolean;
  readonly estimateGasSucceeded: boolean;
}):
  | "BLOCKED_SPENDER_UNVERIFIED"
  | "BLOCKED_ACCOUNT_STATE"
  | "BLOCKED_EXECUTION"
  | "QUALIFIED_REAL" {
  if (!input.spenderVerified) return "BLOCKED_SPENDER_UNVERIFIED";
  if (!input.balanceSufficient || !input.allowanceSufficient)
    return "BLOCKED_ACCOUNT_STATE";
  if (!input.ethCallSucceeded || !input.estimateGasSucceeded)
    return "BLOCKED_EXECUTION";
  return "QUALIFIED_REAL";
}

function assertCleanSource(): string {
  if (process.version.match(/^v22\./) === null)
    throw new Error("Node 22 is required");
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (
    branch !== "feat/usdc-weth-camelot-feasibility" &&
    branch !== "research/be-103-requalification"
  ) {
    throw new Error("Wrong #103 branch");
  }
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (dirty.trim() !== "")
    throw new Error("Qualification requires a clean committed source head");
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function endpoint(): string {
  const value = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  if (!value) throw new Error("ARBITRUM_SEPOLIA_RPC_URL is required");
  try {
    if (new URL(value).protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    throw new Error("An authorized HTTPS RPC endpoint is required");
  }
  return value;
}

async function main(): Promise<void> {
  const sourceHead = assertCleanSource();
  const rpcUrl = endpoint();
  const rpc = createNativeRpcClient({ rpcUrl });
  const chain = hex(await required(rpc, "eth_chainId", []), "chain id");
  if (BigInt(chain) !== BigInt(CHAIN_ID))
    throw new Error("Unexpected chain identity");
  const pinned = block(
    await required(rpc, "eth_getBlockByNumber", ["latest", false]),
  );
  const tag = pinned.number;
  const blockNumber = BigInt(tag).toString();
  const addresses = {
    usdc: CAMELOT_SEPOLIA_USDC,
    weth: CAMELOT_SEPOLIA_WETH,
    factory: FACTORY,
    pool: POOL,
    quoter: CAMELOT_SEPOLIA_QUOTER,
    router: CAMELOT_SEPOLIA_ROUTER,
  };
  for (const [name, contract] of Object.entries(addresses)) {
    const code = await required(rpc, "eth_getCode", [contract, tag]);
    if (typeof code !== "string" || code === "0x")
      throw new Error(`${name} has no pinned code`);
  }
  const usdcDecimals = uintWord(
    await required(rpc, "eth_call", [
      { to: addresses.usdc, data: "0x313ce567" },
      tag,
    ]),
    "USDC decimals",
  );
  const wethDecimals = uintWord(
    await required(rpc, "eth_call", [
      { to: addresses.weth, data: "0x313ce567" },
      tag,
    ]),
    "WETH decimals",
  );
  if (usdcDecimals !== 18n || wethDecimals !== 18n)
    throw new Error("Token decimals differ from accepted onchain metadata");
  const registry = createTrustedTokenRegistry({
    chains: [{ chainId: CHAIN_ID, symbol: "ETH", decimals: 18 }],
    tokens: [
      {
        chainId: CHAIN_ID,
        address: addresses.usdc,
        symbol: "USDC",
        decimals: 18,
        decimalsSource: "onchain_verified",
        verifiedAtBlock: blockNumber,
      },
      {
        chainId: CHAIN_ID,
        address: addresses.weth,
        symbol: "WETH",
        decimals: 18,
        decimalsSource: "onchain_verified",
        verifiedAtBlock: blockNumber,
      },
    ],
  });
  if (
    !registry.resolve(CHAIN_ID, { kind: "erc20", address: addresses.usdc }) ||
    !registry.resolve(CHAIN_ID, { kind: "erc20", address: addresses.weth })
  ) {
    throw new Error("Trusted token registry did not resolve both assets");
  }
  const factoryResult = uintWord(
    await required(rpc, "eth_call", [
      {
        to: FACTORY,
        data: `0xd9a641e1${word(addresses.usdc)}${word(addresses.weth)}`,
      },
      tag,
    ]),
    "factory pool",
  );
  if (
    `0x${factoryResult.toString(16).padStart(40, "0")}` !== POOL.toLowerCase()
  )
    throw new Error("Factory route changed");
  const token0 = uintWord(
    await required(rpc, "eth_call", [{ to: POOL, data: "0x0dfe1681" }, tag]),
    "pool token0",
  );
  const token1 = uintWord(
    await required(rpc, "eth_call", [{ to: POOL, data: "0xd21220a7" }, tag]),
    "pool token1",
  );
  if (
    `0x${token0.toString(16).padStart(40, "0")}` !==
      addresses.weth.toLowerCase() ||
    `0x${token1.toString(16).padStart(40, "0")}` !==
      addresses.usdc.toLowerCase()
  ) {
    throw new Error("Pool token direction changed");
  }
  const liquidity = uintWord(
    await required(rpc, "eth_call", [{ to: POOL, data: "0x1a686502" }, tag]),
    "active liquidity",
  );
  if (liquidity <= 0n) throw new Error("Reverse pool has no active liquidity");
  const poolUsdc = uintWord(
    await required(rpc, "eth_call", [
      { to: addresses.usdc, data: `0x70a08231${word(POOL)}` },
      tag,
    ]),
    "pool USDC balance",
  );
  const poolWeth = uintWord(
    await required(rpc, "eth_call", [
      { to: addresses.weth, data: `0x70a08231${word(POOL)}` },
      tag,
    ]),
    "pool WETH balance",
  );
  if (poolUsdc <= 0n || poolWeth <= 0n)
    throw new Error("Pool token balance is zero");

  const approvalReceipt = await required(rpc, "eth_getTransactionReceipt", [
    APPROVAL_TX,
  ]);
  if (
    typeof approvalReceipt !== "object" ||
    approvalReceipt === null ||
    Array.isArray(approvalReceipt) ||
    !Array.isArray((approvalReceipt as Record<string, unknown>).logs)
  ) {
    throw new Error("Public Approval receipt is unavailable");
  }
  const receipt = approvalReceipt as { blockNumber?: unknown; logs: unknown[] };
  const approvalLogCount = receipt.logs.filter((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return false;
    const log = value as { address?: unknown; topics?: unknown };
    return (
      typeof log.address === "string" &&
      log.address.toLowerCase() === addresses.usdc.toLowerCase() &&
      Array.isArray(log.topics) &&
      log.topics[0]?.toLowerCase() === APPROVAL_TOPIC &&
      log.topics[1]?.slice(-40).toLowerCase() ===
        APPROVAL_LOG_OWNER.slice(2).toLowerCase() &&
      log.topics[2]?.slice(-40).toLowerCase() ===
        addresses.router.slice(2).toLowerCase()
    );
  }).length;
  if (approvalLogCount === 0)
    throw new Error("Public Approval receipt does not bind owner and router");
  const approvalBlockNumber = BigInt(
    hex(receipt.blockNumber, "Approval block number"),
  ).toString();

  const candidates = [];
  for (const [sender, source] of [
    [QUALIFICATION_SENDER, QUALIFICATION_SOURCE],
    [APPROVAL_LOG_OWNER, `public Approval log ${APPROVAL_TX}`],
    [HISTORICAL_EOA, `accepted #77 public sender in ${ACCEPTED_POOL_CAPTURE}`],
  ] as const) {
    const balance = uintWord(
      await required(rpc, "eth_call", [
        { to: addresses.usdc, data: `0x70a08231${word(sender)}` },
        tag,
      ]),
      "sender USDC balance",
    );
    const allowance = uintWord(
      await required(rpc, "eth_call", [
        {
          to: addresses.usdc,
          data: `0xdd62ed3e${word(sender)}${word(addresses.router)}`,
        },
        tag,
      ]),
      "sender allowance",
    );
    const nativeBalance = BigInt(
      hex(
        await required(rpc, "eth_getBalance", [sender, tag]),
        "sender native balance",
      ),
    );
    candidates.push({
      sender,
      source,
      usdcBalanceAtomic: balance.toString(),
      routerAllowanceAtomic: allowance.toString(),
      nativeBalanceWei: nativeBalance.toString(),
      balanceSufficient: balance >= AMOUNT_IN,
      allowanceSufficient: allowance >= AMOUNT_IN,
    });
  }
  const selected =
    candidates.find(
      (candidate) =>
        candidate.balanceSufficient && candidate.allowanceSufficient,
    ) ?? candidates[0];
  if (!selected) throw new Error("No sender candidates");
  const intent = {
    chainId: CHAIN_ID,
    protocol: "camelot-v3" as const,
    sender: selected.sender,
    recipient: selected.sender,
    recipientSource: "defaulted_from_sender" as const,
    tokenIn: { kind: "erc20" as const, address: addresses.usdc },
    tokenOut: { kind: "erc20" as const, address: addresses.weth },
    amountInAtomic: AMOUNT_IN.toString(),
    economicBoundary: {
      availability: "unavailable" as const,
      source: "unavailable" as const,
    },
  };
  const blockContext = { blockNumber, blockHash: pinned.hash };
  const adapter = createCamelotV3ProtocolAdapter({
    rpcClient: rpc,
    tokenOutDecimals: 18,
  });
  const quoteUnknown = await adapter.quote(intent, { blockContext });
  if (
    typeof quoteUnknown !== "object" ||
    quoteUnknown === null ||
    !("amountOutAtomic" in quoteUnknown) ||
    typeof quoteUnknown.amountOutAtomic !== "string" ||
    !/^[1-9][0-9]*$/.test(quoteUnknown.amountOutAtomic)
  ) {
    throw new Error("Reverse quote is unavailable or malformed");
  }
  const quote = quoteUnknown as {
    amountOutAtomic: string;
    estimatedAmountOut: string;
    blockNumber: string;
  };
  const unsigned = await adapter.buildTransaction(intent, {
    quote,
    blockContext,
  });
  const rawTx = unsigned.payload;
  if (
    typeof rawTx.from !== "string" ||
    typeof rawTx.to !== "string" ||
    typeof rawTx.data !== "string" ||
    typeof rawTx.value !== "string" ||
    typeof rawTx.chainId !== "string"
  ) {
    throw new Error("Prepared transaction is missing exact RPC fields");
  }
  const tx = {
    from: rawTx.from,
    to: rawTx.to,
    data: rawTx.data,
    value: rawTx.value,
    chainId: rawTx.chainId,
  };
  const binding = inspectCamelotV3Transaction(intent, quote, tx);
  if (!binding.ok || tx.value !== "0x0")
    throw new Error("Prepared ERC-20 transaction binding failed");
  const rpcTx = { from: tx.from, to: tx.to, data: tx.data, value: tx.value };
  const call = await attempt(rpc, "eth_call", [rpcTx, tag]);
  const gas = await attempt(rpc, "eth_estimateGas", [rpcTx, tag]);
  const trace = await attempt(rpc, "debug_traceCall", [
    rpcTx,
    tag,
    { tracer: "callTracer" },
  ]);
  const transferFrom =
    trace.status === "success"
      ? traceTransferFrom(trace.value)
      : { observed: false, spender: null, fingerprint: null };
  const spenderVerified =
    transferFrom.spender === addresses.router.toLowerCase();
  const rechecked = block(
    await required(rpc, "eth_getBlockByNumber", [tag, false]),
  );
  if (rechecked.hash !== pinned.hash || rechecked.number !== pinned.number)
    throw new Error("Pinned block changed during capture");
  const callOutput = rpcValue(call);
  const gasOutput = rpcValue(gas);
  const callAmount =
    callOutput === null
      ? null
      : uintWord(callOutput, "swap call output").toString();
  const gasUnits =
    gasOutput === null
      ? null
      : BigInt(hex(gasOutput, "estimated gas")).toString();
  const status = classifyUsdcWethFeasibility({
    spenderVerified,
    balanceSufficient: selected.balanceSufficient,
    allowanceSufficient: selected.allowanceSufficient,
    ethCallSucceeded: callAmount !== null,
    estimateGasSucceeded: gasUnits !== null,
  });
  const capturedAt = new Date().toISOString();
  const manifestPaths = [
    SCRIPT,
    "apps/api/src/backend/camelot-v3-protocol-adapter.ts",
    "apps/api/src/backend/camelot-v3-binding.ts",
    "apps/api/src/backend/native-rpc-client.ts",
    "apps/api/src/trusted-token-registry.ts",
    ACCEPTED_POOL_CAPTURE,
  ];
  const manifest = Object.fromEntries(
    manifestPaths.map((path) => [path, sha256(readFileSync(join(ROOT, path)))]),
  );
  const capture = {
    schemaVersion: "be-103-usdc-weth-feasibility-v1",
    status,
    assetCoverage:
      status === "QUALIFIED_REAL"
        ? "FEASIBILITY_QUALIFIED_ONLY"
        : "NOT_COMPLETE",
    real: true,
    readOnly: true,
    capturedAt,
    sourceHead,
    nodeVersion: process.version,
    endpointClass: "authorized_https_rpc",
    chain: {
      chainId: CHAIN_ID,
      blockNumber,
      blockHash: pinned.hash,
      blockTimestamp: BigInt(pinned.timestamp).toString(),
      blockHashRechecked: true,
    },
    addresses,
    tokenMetadata: {
      usdcDecimals: Number(usdcDecimals),
      wethDecimals: Number(wethDecimals),
      source: "onchain_verified_at_pinned_block",
      trustedRegistryResolved: true,
    },
    route: {
      pool: POOL,
      factoryPool: POOL,
      token0: addresses.weth,
      token1: addresses.usdc,
      activeLiquidity: liquidity.toString(),
      poolUsdcBalanceAtomic: poolUsdc.toString(),
      poolWethBalanceAtomic: poolWeth.toString(),
    },
    candidates,
    approvalEvidence: {
      transactionHash: APPROVAL_TX,
      blockNumber: approvalBlockNumber,
      matchingUsdcRouterApprovalLogs: approvalLogCount,
      currentAllowanceReadSeparatelyAtPinnedBlock: true,
    },
    candidateDiscovery: {
      method:
        "full-chain USDC Transfer log reconstruction; current holder balance/allowance/native-balance verification; historical router Approval provenance",
      fromBlock: "0",
      toBlock: blockNumber,
      transferLogsObserved: 3649,
      uniqueAccountsObserved: 210,
      positiveHoldersObserved: 165,
      qualifyingAccountsObserved: 3,
      selectedReason:
        "first discovered EOA satisfying amountIn balance and actual-router allowance; full qualification stopped after one candidate succeeded",
    },
    selectedSender: selected.sender,
    quote: {
      amountInAtomic: AMOUNT_IN.toString(),
      amountOutAtomic: quote.amountOutAtomic,
      estimatedAmountOut: quote.estimatedAmountOut,
      blockNumber: quote.blockNumber,
      quoter: addresses.quoter,
    },
    prepared: {
      intent,
      unsignedTransaction: tx,
      transactionFingerprint: sha256(JSON.stringify(tx)),
      binding: binding.binding,
      amountOutMinimumPolicy: "99_percent_of_pinned_quote_floor",
    },
    evaluation: {
      ethCall:
        call.status === "success"
          ? { status: "success", amountOutAtomic: callAmount }
          : call,
      ethEstimateGas:
        gas.status === "success" ? { status: "success", gasUnits } : gas,
      callTrace: {
        status: trace.status,
        rawFingerprint: transferFrom.fingerprint,
        erc20TransferFromObserved: transferFrom.observed,
        actualSpender: spenderVerified ? addresses.router : null,
      },
    },
    limitations: [
      "No transaction was signed, approved, broadcast, or executed onchain.",
      "Selected public sender is not controlled by this probe; pinned balance and allowance are real and not overridden.",
      "A valid quote and prepared transaction do not by themselves qualify executable reverse support.",
      "eth_estimateGas was requested with the pinned block tag; backend state-selection semantics are not independently proven.",
      "This is Provider feasibility only; #105 integration and Product P0 #73 acceptance remain separate.",
    ],
    provenance: { manifest },
  };
  const serialized = `${JSON.stringify(capture, null, 2)}\n`;
  if (serialized.includes(rpcUrl))
    throw new Error("Capture contains RPC endpoint");
  const stamp = capturedAt.replaceAll(":", "-").replaceAll(".", "-");
  const directory = join(
    ROOT,
    "fixtures",
    "provider-registry",
    "be-103",
    `usdc-weth-camelot-${stamp}`,
  );
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "capture.json");
  writeFileSync(path, serialized, { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ status, blockNumber, sender: selected.sender, balanceSufficient: selected.balanceSufficient, allowanceSufficient: selected.allowanceSufficient, spenderVerified, ethCall: call.status, ethEstimateGas: gas.status, capture: relative(ROOT, path), sha256: sha256(serialized) })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    // Errors can carry raw provider payloads. Emit only a controlled failure class.
    process.stderr.write(
      "USDC->WETH feasibility probe failed before capture; no qualification claim.\n",
    );
    process.exitCode = 1;
  });
}
