import { describe, expect, it } from "vitest";
import { prepareArbitrumOneTransaction } from "../../apps/api/src/backend/arbitrum-one-transaction.js";
import { NativeRpcClientError } from "../../apps/api/src/backend/native-rpc-client.js";
import { ARBITRUM_ONE_RUNTIME_PROFILE } from "../../apps/api/src/runtime-config.js";
import {
  createReadOnlyForkRpcClient,
  ForkSmokeError,
  getForkHarnessConfig,
  type RpcClient,
  readArbitrumOnePinnedQuote,
  runForkQuoteSmoke,
} from "./smoke.js";
import {
  createLocalForkSimulationRpcClient,
  runForkTransactionSimulation,
} from "./transaction-smoke.js";

const config = getForkHarnessConfig();
const blockNumber = BigInt(config.source.blockNumber);
const blockTag = `0x${blockNumber.toString(16)}`;
const sender = "0x1111111111111111111111111111111111111111";
const instanceId = "00000000-0000-4000-8000-000000000001";
const quoterAmount = 2_414_272n;

class FakeRpc implements RpcClient {
  readonly calls: { method: string; params: readonly unknown[] }[] = [];
  readonly balances = new Map<string, string>();
  readonly snapshots = new Map<string, Map<string, string>>();
  chainId: string;
  blockHash: string;
  headNumber: string | undefined;
  forkInstanceId: string;
  code = "0x6000";
  version = `anvil/v${config.anvil.version}`;
  quoteAmount = quoterAmount;
  failRevert = false;
  private nextSnapshot = 1;

  constructor(
    readonly kind: "source" | "local",
    options: {
      chainId?: string;
      blockHash?: string;
      headNumber?: string;
      code?: string;
      quoteAmount?: bigint;
      version?: string;
      failRevert?: boolean;
      transactionCallFailure?: "revert" | "unavailable";
      transactionTraceFailure?: boolean;
      transactionReturnAmount?: bigint;
      failGasEstimate?: boolean;
      forkInstanceId?: string;
    } = {},
  ) {
    this.chainId = options.chainId ?? (kind === "source" ? "0xa4b1" : "0x7a69");
    this.blockHash = options.blockHash ?? config.source.blockHash;
    this.headNumber = options.headNumber;
    this.code = options.code ?? "0x6000";
    this.quoteAmount = options.quoteAmount ?? quoterAmount;
    this.version = options.version ?? `anvil/v${config.anvil.version}`;
    this.failRevert = options.failRevert ?? false;
    this.transactionCallFailure = options.transactionCallFailure;
    this.transactionTraceFailure = options.transactionTraceFailure ?? false;
    this.transactionReturnAmount =
      options.transactionReturnAmount ?? quoterAmount;
    this.failGasEstimate = options.failGasEstimate ?? false;
    this.forkInstanceId = options.forkInstanceId ?? instanceId;
  }

  transactionCallFailure: "revert" | "unavailable" | undefined;
  transactionTraceFailure: boolean;
  transactionReturnAmount: bigint;
  failGasEstimate: boolean;

  async request(
    method: string,
    params: readonly unknown[] = [],
  ): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "parallax_forkInstanceId") return this.forkInstanceId;
    if (method === "eth_chainId") return this.chainId;
    if (method === "eth_blockNumber") {
      return this.kind === "source"
        ? `0x${(blockNumber + 1n).toString(16)}`
        : (this.headNumber ?? blockTag);
    }
    if (method === "eth_getBlockByNumber") {
      return {
        number: blockTag,
        hash: this.blockHash,
        timestamp: "0x6ad45707",
      };
    }
    if (method === "eth_getCode") return this.code;
    if (method === "eth_accounts") return [];
    if (method === "web3_clientVersion") return this.version;
    if (method === "eth_estimateGas") {
      if (this.failGasEstimate)
        throw new Error("fake gas estimate unavailable");
      if (this.kind === "local") {
        const transaction = params[0] as {
          from?: unknown;
          value?: unknown;
        };
        const balance =
          typeof transaction.from === "string"
            ? BigInt(this.balances.get(transaction.from.toLowerCase()) ?? "0")
            : 0n;
        const value =
          typeof transaction.value === "string"
            ? BigInt(transaction.value)
            : -1n;
        if (params[1] !== "latest" || balance < value) {
          throw new Error("local simulation did not use prepared state");
        }
      }
      return "0x5208";
    }
    if (method === "debug_traceCall") {
      if (this.transactionTraceFailure) {
        throw new Error("TRACE_ENDPOINT_SENTINEL TRACE_PAYLOAD_SENTINEL");
      }
      const transaction = params[0] as { data?: unknown };
      if (typeof transaction.data !== "string") {
        throw new Error("trace call did not receive exact transaction data");
      }
      const recipientWord = transaction.data.slice(
        2 + 8 + 2 * 64,
        2 + 8 + 3 * 64,
      );
      return {
        type: "CALL",
        calls: [
          {
            type: "CALL",
            to: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
            logs: [
              {
                address: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
                topics: [
                  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                  `0x${"00".repeat(12)}${"22".repeat(20)}`,
                  `0x${recipientWord}`,
                ],
                data: word(this.transactionReturnAmount),
              },
            ],
          },
        ],
      };
    }
    if (method === "eth_getBalance") {
      const address = String(params[0]).toLowerCase();
      if (this.kind === "local" && params[1] === blockTag)
        return toQuantity(0n);
      return toQuantity(BigInt(this.balances.get(address) ?? "0"));
    }
    if (method === "anvil_setBalance") {
      const address = String(params[0]).toLowerCase();
      this.balances.set(address, BigInt(String(params[1])).toString());
      return true;
    }
    if (method === "evm_snapshot") {
      const snapshotId = `0x${this.nextSnapshot.toString(16)}`;
      this.nextSnapshot += 1;
      this.snapshots.set(snapshotId, new Map(this.balances));
      return snapshotId;
    }
    if (method === "evm_revert") {
      if (this.failRevert) return false;
      const snapshotId = String(params[0]);
      const snapshot = this.snapshots.get(snapshotId);
      if (snapshot === undefined) return false;
      this.balances.clear();
      for (const [address, balance] of snapshot)
        this.balances.set(address, balance);
      this.snapshots.delete(snapshotId);
      return true;
    }
    if (method === "eth_call") return this.ethCall(params);
    throw new Error(`Unexpected fake RPC method: ${method}`);
  }

  private ethCall(params: readonly unknown[]): string {
    const call = params[0] as { to: string; data: string };
    const target = call.to.toLowerCase();
    const selector = call.data.slice(2, 10).toLowerCase();
    const profile = ARBITRUM_ONE_RUNTIME_PROFILE;
    if (selector === "70a08231") return word(0n);
    if (selector === "95d89b41") {
      return encodeString(
        target === profile.deployments.wrappedNativeAddress.toLowerCase()
          ? "WETH"
          : "USDC",
      );
    }
    if (selector === "313ce567") {
      return word(
        target === profile.deployments.wrappedNativeAddress.toLowerCase()
          ? 18n
          : 6n,
      );
    }
    if (selector === "0dfe1681") {
      return encodeAddress(profile.deployments.wrappedNativeAddress);
    }
    if (selector === "d21220a7") {
      return encodeAddress(profile.deployments.usdcAddress);
    }
    if (selector === "1a686502") return word(100n);
    if (selector === "2d9ebd1d")
      return `0x${word(this.quoteAmount).slice(2)}${word(500n).slice(2)}`;
    if (selector === "bc651188") {
      if (this.transactionCallFailure === "revert") {
        throw new NativeRpcClientError(
          "RPC_ERROR",
          "execution reverted",
          -32000,
        );
      }
      if (this.transactionCallFailure === "unavailable") {
        throw new Error("RPC_URL_SENTINEL RPC_PAYLOAD_SENTINEL");
      }
      const transaction = params[0] as {
        from?: unknown;
        value?: unknown;
      };
      const balance =
        typeof transaction.from === "string"
          ? BigInt(this.balances.get(transaction.from.toLowerCase()) ?? "0")
          : 0n;
      const value =
        typeof transaction.value === "string" ? BigInt(transaction.value) : -1n;
      if (params[1] !== "latest" || balance < value) {
        throw new NativeRpcClientError(
          "RPC_ERROR",
          "execution reverted",
          -32000,
        );
      }
      return word(this.transactionReturnAmount);
    }
    throw new Error(`Unexpected fake eth_call selector: ${selector}`);
  }
}

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function encodeAddress(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function encodeString(value: string): string {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return `0x${word(32n).slice(2)}${word(BigInt(value.length)).slice(2)}${padded}`;
}

function toQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function isUsdcBalanceCall(call: {
  readonly method: string;
  readonly params: readonly unknown[];
}): boolean {
  if (call.method !== "eth_call") return false;
  const request = call.params[0];
  return (
    typeof request === "object" &&
    request !== null &&
    "data" in request &&
    typeof request.data === "string" &&
    request.data.slice(0, 10).toLowerCase() === "0x70a08231"
  );
}

function readUsdcBlockTags(rpc: FakeRpc): unknown[] {
  return rpc.calls.filter(isUsdcBalanceCall).map((call) => call.params[1]);
}

function run(
  sourceRpc = new FakeRpc("source"),
  localRpc = new FakeRpc("local"),
) {
  return runForkQuoteSmoke({
    sourceRpc,
    localRpc,
    forkInstanceId: instanceId,
    senderAddress: sender,
    now: () => new Date("2026-10-18T06:00:00.000Z"),
  });
}

async function runTransactionSimulation(
  sourceRpc = new FakeRpc("source"),
  localRpc = new FakeRpc("local"),
) {
  const now = new Date("2026-10-18T06:00:00.000Z");
  const quote = await readArbitrumOnePinnedQuote({
    rpc: createReadOnlyForkRpcClient(sourceRpc, "upstream"),
    senderAddress: sender,
    observedAt: now.toISOString(),
  });
  const preparedTransaction = prepareArbitrumOneTransaction({
    intent: quote.intent,
    quote: quote.quote,
    now: () => now,
  });
  const evidence = await runForkTransactionSimulation({
    sourceRpc,
    localRpc,
    forkInstanceId: instanceId,
    intent: quote.intent,
    quote: quote.quote,
    preparedTransaction,
    now: () => now,
  });
  return { evidence, localRpc, preparedTransaction, quote, sourceRpc };
}

describe("Arbitrum One local fork quote harness", () => {
  it("compares the same pinned Camelot quote and restores the local sender state", async () => {
    const source = new FakeRpc("source");
    const local = new FakeRpc("local");

    const evidence = await run(source, local);

    expect(evidence).toMatchObject({
      evidenceStatus: "READ_ONLY_QUOTE_REPRODUCIBILITY_NOT_SIMULATION",
      source: {
        chainId: 42161,
        blockNumber: config.source.blockNumber,
        blockHash: config.source.blockHash,
      },
      localExecution: {
        chainId: 31337,
        baseBlockNumber: config.source.blockNumber,
        forkInstanceId: instanceId,
      },
      senderPreparation: {
        address: sender,
        unlockedSignerCount: 0,
        localNativeBalanceOverrideAtomic: config.senderNativeBalanceAtomic,
        upstreamUsdcBalanceAtomic: "0",
        localUsdcBalanceAfterOverrideAtomic: "0",
        resetRestoredUpstreamBalances: true,
      },
      quote: {
        amountInAtomic: "1000000000000000",
        upstreamAmountOutAtomic: quoterAmount.toString(),
        forkAmountOutAtomic: quoterAmount.toString(),
        resetRerunAmountOutAtomic: quoterAmount.toString(),
        exactAtomicOutputMatched: true,
      },
      reset: {
        snapshotRevertedBetweenQuotes: true,
        repeatQuoteMatched: true,
        snapshotRevertedAfterSmoke: true,
        localBlockNumberRestored: true,
      },
      rpcSafety: {
        upstreamWritesAllowed: false,
        signingOrBroadcastingPerformed: false,
        gasOrSimulationMethodsPerformed: false,
        localTransactionsMined: false,
      },
    });
    expect(local.balances.get(sender)).toBeUndefined();
    expect(
      source.calls.every((call) => !call.method.startsWith("eth_send")),
    ).toBe(true);
    expect(local.calls.some((call) => call.method === "anvil_setBalance")).toBe(
      true,
    );
    expect(
      local.calls.some((call) => call.method === "eth_sendRawTransaction"),
    ).toBe(false);
    expect(
      source.calls
        .filter((call) => call.method === "eth_getBalance")
        .map((call) => call.params[1]),
    ).toEqual([blockTag]);
    expect(
      local.calls
        .filter((call) => call.method === "eth_getBalance")
        .map((call) => call.params[1]),
    ).toEqual([blockTag, "latest", "latest", blockTag]);
    expect(readUsdcBlockTags(source)).toEqual([blockTag]);
    expect(readUsdcBlockTags(local)).toEqual([
      blockTag,
      "latest",
      "latest",
      blockTag,
    ]);
    for (const rpc of [source, local]) {
      for (const call of rpc.calls) {
        if (call.method === "eth_getBlockByNumber") {
          expect(call.params[0]).toBe(blockTag);
        } else if (call.method === "eth_getCode") {
          expect(call.params[1]).toBe(blockTag);
        } else if (call.method === "eth_call" && !isUsdcBalanceCall(call)) {
          expect(call.params[1]).toBe(blockTag);
        }
      }
    }
  });

  it("rejects a second fork with matching chain, block, and Anvil version", async () => {
    const source = new FakeRpc("source");
    const secondFork = new FakeRpc("local", {
      forkInstanceId: "00000000-0000-4000-8000-000000000002",
    });

    await expect(run(source, secondFork)).rejects.toMatchObject({
      code: "FORK_INSTANCE_IDENTITY_MISMATCH",
    });
    expect(secondFork.calls).toEqual([
      { method: "parallax_forkInstanceId", params: [] },
    ]);
    expect(source.calls).toEqual([]);
    expect(secondFork.balances.size).toBe(0);
  });

  it("fails closed on a source chain mismatch", async () => {
    await expect(
      run(new FakeRpc("source", { chainId: "0x66eee" })),
    ).rejects.toMatchObject({
      code: "SOURCE_CHAIN_ID_MISMATCH",
    });
  });

  it("rejects a source block hash mismatch", async () => {
    await expect(
      run(new FakeRpc("source", { blockHash: `0x${"ab".repeat(32)}` })),
    ).rejects.toMatchObject({
      code: "SOURCE_BLOCK_HASH_MISMATCH",
    });
  });

  it("rejects missing verified route code before quoting", async () => {
    await expect(
      run(new FakeRpc("source", { code: "0x" })),
    ).rejects.toMatchObject({
      code: "REQUIRED_CONTRACT_CODE_MISSING",
    });
  });

  it("rejects a local Anvil version different from the pinned image", async () => {
    await expect(
      run(
        new FakeRpc("source"),
        new FakeRpc("local", { version: "anvil/v0.0.0" }),
      ),
    ).rejects.toMatchObject({
      code: "ANVIL_VERSION_MISMATCH",
    });
  });

  it("rejects a non-matching atomic quote and still reverts the local snapshot", async () => {
    const local = new FakeRpc("local", { quoteAmount: quoterAmount + 1n });
    await expect(run(new FakeRpc("source"), local)).rejects.toMatchObject({
      code: "QUOTE_PARITY_MISMATCH",
    });
    expect(local.balances.get(sender)).toBeUndefined();
  });

  it("surfaces failed snapshot reset for destroy-and-recreate recovery", async () => {
    await expect(
      run(new FakeRpc("source"), new FakeRpc("local", { failRevert: true })),
    ).rejects.toBeInstanceOf(ForkSmokeError);
    await expect(
      run(new FakeRpc("source"), new FakeRpc("local", { failRevert: true })),
    ).rejects.toMatchObject({
      code: "RESET_FAILED",
    });
  });
});

describe("Arbitrum One local fork transaction simulation", () => {
  it("prepares, inspects, simulates, fingerprints, and resets the unsigned transaction", async () => {
    const source = new FakeRpc("source");
    const local = new FakeRpc("local");
    const { evidence, preparedTransaction } = await runTransactionSimulation(
      source,
      local,
    );

    expect(preparedTransaction).toMatchObject({
      kind: "unsigned",
      payload: {
        from: sender,
        to: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.routerAddress,
        chainId: "0xa4b1",
        value: expect.stringMatching(/^0x[0-9a-f]+$/),
      },
      fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(evidence).toMatchObject({
      evidenceStatus: "LOCAL_FORK_BACKEND_EVIDENCE_NOT_PRODUCTION_SUPPORT",
      source: {
        chainId: 42161,
        quoteBlockNumber: config.source.blockNumber,
        quoteBlockHash: config.source.blockHash,
      },
      localExecution: {
        chainId: 31337,
        baseBlockNumber: config.source.blockNumber,
        observedHeadNumber: config.source.blockNumber,
        forkInstanceId: instanceId,
      },
      backendEvidence: {
        call: { status: "SUCCEEDED" },
        gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
        validityAtExecution: "VALID",
        preparedTransactionFingerprint: preparedTransaction.fingerprint,
      },
      transactionOutcome: {
        recipientTransfer: {
          status: "AVAILABLE",
          source: "LOCAL_DEBUG_TRACE_TRANSFER_LOG",
          tokenAddress:
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress.toLowerCase(),
          recipient: sender,
          amountOutAtomic: quoterAmount.toString(),
          transferEventCount: 1,
          matchesQuoteAmountOut: true,
          meetsMinimumOutput: true,
        },
        assetBalanceDelta: {
          status: "UNAVAILABLE",
          reason: "READ_ONLY_TRACE_DOES_NOT_PERSIST_STATE",
        },
      },
      senderPreparation: {
        unlockedSignerCount: 0,
        sourceUsdcBalanceAtomic: "0",
        localUsdcBalanceAfterOverrideAtomic: "0",
        resetRestoredSourceBalances: true,
      },
      rpcSafety: {
        upstreamWritesAllowed: false,
        signingOrBroadcastingPerformed: false,
        transactionSubmissionPerformed: false,
        localTransactionsMined: false,
      },
    });
    const serializedEvidence = JSON.stringify(evidence);
    expect(serializedEvidence).not.toContain(preparedTransaction.payload.data);
    expect(serializedEvidence).not.toContain("RPC_URL_SENTINEL");
    expect(serializedEvidence).not.toContain("RPC_PAYLOAD_SENTINEL");
    expect(serializedEvidence).not.toContain("0xddf252ad");
    expect(serializedEvidence).not.toContain('"topics"');

    const txCall = local.calls.find((call) => {
      const request = call.params[0];
      return (
        call.method === "eth_call" &&
        typeof request === "object" &&
        request !== null &&
        "data" in request &&
        typeof request.data === "string" &&
        request.data.startsWith("0xbc651188")
      );
    });
    const gasEstimate = local.calls.find(
      (call) => call.method === "eth_estimateGas",
    );
    const traceCall = local.calls.find(
      (call) => call.method === "debug_traceCall",
    );
    expect(txCall?.params).toEqual([preparedTransaction.payload, "latest"]);
    expect(gasEstimate?.params).toEqual([
      preparedTransaction.payload,
      "latest",
    ]);
    expect(traceCall?.params).toEqual([
      preparedTransaction.payload,
      "latest",
      { tracer: "callTracer", tracerConfig: { withLog: true } },
    ]);
    expect(local.balances.get(sender)).toBeUndefined();
    expect(
      source.calls.every((call) => !call.method.startsWith("eth_send")),
    ).toBe(true);
    expect(
      local.calls.some((call) => call.method === "eth_sendRawTransaction"),
    ).toBe(false);
    expect(local.calls.some((call) => call.method === "eth_estimateGas")).toBe(
      true,
    );
  });

  it("does not persist raw client-version RPC text in evidence", async () => {
    const sentinel = "RPC_URL_SENTINEL";
    const local = new FakeRpc("local", {
      version: `anvil/v${config.anvil.version}; ${sentinel}`,
    });
    const { evidence } = await runTransactionSimulation(
      new FakeRpc("source"),
      local,
    );

    expect(evidence.localExecution.anvilVersion).toBe(config.anvil.version);
    expect(JSON.stringify(evidence)).not.toContain(sentinel);
  });

  it("distinguishes reverts, RPC failures, and unavailable gas estimates", async () => {
    const reverted = await runTransactionSimulation(
      new FakeRpc("source"),
      new FakeRpc("local", { transactionCallFailure: "revert" }),
    );
    expect(reverted.evidence.backendEvidence).toMatchObject({
      call: { status: "REVERTED" },
      validityAtExecution: "INVALID",
      failureStage: "CALL",
      reason: "LOCAL_FORK_EVM_REVERT",
    });

    const unavailable = await runTransactionSimulation(
      new FakeRpc("source"),
      new FakeRpc("local", { transactionCallFailure: "unavailable" }),
    );
    expect(unavailable.evidence.backendEvidence).toMatchObject({
      call: { status: "UNAVAILABLE" },
      validityAtExecution: "UNKNOWN",
      failureStage: "CALL",
      reason: "LOCAL_FORK_CALL_UNAVAILABLE",
    });
    expect(JSON.stringify(unavailable.evidence)).not.toContain(
      "RPC_URL_SENTINEL",
    );
    expect(JSON.stringify(unavailable.evidence)).not.toContain(
      "RPC_PAYLOAD_SENTINEL",
    );

    const gasUnavailable = await runTransactionSimulation(
      new FakeRpc("source"),
      new FakeRpc("local", { failGasEstimate: true }),
    );
    expect(gasUnavailable.evidence.backendEvidence).toMatchObject({
      call: { status: "SUCCEEDED" },
      gasEstimate: { status: "UNAVAILABLE" },
      validityAtExecution: "UNKNOWN",
      failureStage: "GAS_ESTIMATE",
      reason: "LOCAL_FORK_GAS_ESTIMATE_UNAVAILABLE",
    });
  });

  it("separates recipient transfer logs from non-persisted balance changes", async () => {
    const { evidence } = await runTransactionSimulation(
      new FakeRpc("source"),
      new FakeRpc("local", {
        transactionReturnAmount: quoterAmount - 100_000n,
      }),
    );

    expect(evidence.backendEvidence.call.status).toBe("SUCCEEDED");
    expect(evidence.transactionOutcome).toMatchObject({
      recipientTransfer: {
        status: "AVAILABLE",
        source: "LOCAL_DEBUG_TRACE_TRANSFER_LOG",
        amountOutAtomic: (quoterAmount - 100_000n).toString(),
        matchesQuoteAmountOut: false,
        meetsMinimumOutput: false,
      },
      assetBalanceDelta: {
        status: "UNAVAILABLE",
        reason: "READ_ONLY_TRACE_DOES_NOT_PERSIST_STATE",
      },
    });
  });

  it("keeps recipient transfer unavailable when local tracing is unsupported", async () => {
    const traceUnavailable = await runTransactionSimulation(
      new FakeRpc("source"),
      new FakeRpc("local", { transactionTraceFailure: true }),
    );
    expect(
      traceUnavailable.evidence.transactionOutcome.recipientTransfer,
    ).toMatchObject({ status: "UNAVAILABLE", source: "NOT_OBSERVED" });
    const serialized = JSON.stringify(traceUnavailable.evidence);
    expect(serialized).not.toContain("TRACE_ENDPOINT_SENTINEL");
    expect(serialized).not.toContain("TRACE_PAYLOAD_SENTINEL");
  });

  it("blocks upstream writes and local signing, sending, and mining RPCs", async () => {
    const upstream = createReadOnlyForkRpcClient(
      new FakeRpc("source"),
      "upstream",
    );
    const local = createLocalForkSimulationRpcClient(new FakeRpc("local"));

    await expect(
      async () => await upstream.request("eth_sendRawTransaction", ["0x01"]),
    ).rejects.toMatchObject({ code: "UPSTREAM_WRITE_BLOCKED" });
    await expect(
      async () => await upstream.request("debug_traceCall", []),
    ).rejects.toMatchObject({ code: "UPSTREAM_WRITE_BLOCKED" });
    for (const method of [
      "eth_sendTransaction",
      "eth_sendRawTransaction",
      "eth_sign",
      "eth_signTransaction",
      "personal_sign",
      "anvil_mine",
    ]) {
      await expect(
        async () => await local.request(method, []),
      ).rejects.toMatchObject({ code: "LOCAL_SIMULATION_METHOD_REJECTED" });
    }
  });

  it("rejects a modified payload before contacting either RPC", async () => {
    const source = new FakeRpc("source");
    const local = new FakeRpc("local");
    const now = new Date("2026-10-18T06:00:00.000Z");
    const quote = await readArbitrumOnePinnedQuote({
      rpc: createReadOnlyForkRpcClient(source, "upstream"),
      senderAddress: sender,
      observedAt: now.toISOString(),
    });
    const prepared = prepareArbitrumOneTransaction({
      intent: quote.intent,
      quote: quote.quote,
      now: () => now,
    });
    const sourceCallCountBeforeSimulation = source.calls.length;
    const modified = {
      ...prepared,
      payload: {
        ...prepared.payload,
        data: `${prepared.payload.data.slice(0, -2)}01`,
      },
    };

    await expect(
      runForkTransactionSimulation({
        sourceRpc: source,
        localRpc: local,
        forkInstanceId: instanceId,
        intent: quote.intent,
        quote: quote.quote,
        preparedTransaction: modified,
        now: () => now,
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_FINGERPRINT_MISMATCH" });
    expect(source.calls).toHaveLength(sourceCallCountBeforeSimulation);
    expect(local.calls).toEqual([]);
  });

  it("rejects the wrong fork instance and local block before transaction simulation", async () => {
    const wrongInstance = new FakeRpc("local", {
      forkInstanceId: "00000000-0000-4000-8000-000000000002",
    });
    await expect(
      runTransactionSimulation(new FakeRpc("source"), wrongInstance),
    ).rejects.toMatchObject({ code: "FORK_INSTANCE_IDENTITY_MISMATCH" });
    expect(
      wrongInstance.calls.some(
        (call) =>
          call.method === "eth_call" &&
          typeof call.params[0] === "object" &&
          call.params[0] !== null &&
          "data" in call.params[0] &&
          typeof call.params[0].data === "string" &&
          call.params[0].data.startsWith("0xbc651188"),
      ),
    ).toBe(false);

    const wrongBlock = new FakeRpc("local", {
      headNumber: `0x${(blockNumber + 1n).toString(16)}`,
    });
    await expect(
      runTransactionSimulation(new FakeRpc("source"), wrongBlock),
    ).rejects.toMatchObject({ code: "LOCAL_FORK_BLOCK_MISMATCH" });
    expect(
      wrongBlock.calls.some(
        (call) =>
          call.method === "eth_call" &&
          typeof call.params[0] === "object" &&
          call.params[0] !== null &&
          "data" in call.params[0] &&
          typeof call.params[0].data === "string" &&
          call.params[0].data.startsWith("0xbc651188"),
      ),
    ).toBe(false);
  });

  it("rejects quote block provenance mismatch before contacting either RPC", async () => {
    const source = new FakeRpc("source");
    const local = new FakeRpc("local");
    const now = new Date("2026-10-18T06:00:00.000Z");
    const quote = await readArbitrumOnePinnedQuote({
      rpc: createReadOnlyForkRpcClient(source, "upstream"),
      senderAddress: sender,
      observedAt: now.toISOString(),
    });
    const preparedTransaction = prepareArbitrumOneTransaction({
      intent: quote.intent,
      quote: quote.quote,
      now: () => now,
    });
    if (quote.quote.provenance === undefined) {
      throw new Error("Test quote unexpectedly has no provenance");
    }
    const mismatchedQuote = {
      ...quote.quote,
      provenance: {
        ...quote.quote.provenance,
        sourceBlock: {
          ...quote.quote.provenance.sourceBlock,
          hash: `0x${"ab".repeat(32)}`,
        },
      },
    };

    await expect(
      runForkTransactionSimulation({
        sourceRpc: source,
        localRpc: local,
        forkInstanceId: instanceId,
        intent: quote.intent,
        quote: mismatchedQuote,
        preparedTransaction,
        now: () => now,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_BLOCK_MISMATCH" });
    expect(local.calls).toEqual([]);
  });

  it("fails closed when snapshot reset does not restore state", async () => {
    const local = new FakeRpc("local", { failRevert: true });
    await expect(
      runTransactionSimulation(new FakeRpc("source"), local),
    ).rejects.toMatchObject({ code: "RESET_FAILED" });
    expect(local.balances.get(sender)).toBe(config.senderNativeBalanceAtomic);
  });
});
