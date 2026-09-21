import {
  convertAtomicAmountToHuman,
  type NormalizedSwapIntent,
} from "@parallax/contracts";
import type { NativeRpcPreparedExecution } from "./native-rpc-evidence.js";
import type { ProviderEvaluationInput } from "./provider-adapter.js";

const CHAIN_ID = 421_614;
const PROTOCOL = "camelot-v3";
const WETH = "0x980b62da83eff3d4576c647993b0c1d7faf17c73";
const USDC = "0xb893e3334d4bd6c5ba8277fd559e99ed683a9fc7";
const ROUTER = "0x171b925c51565f5d2a7d8c494ba3188d304efd93";
const POOL = "0x3965361ea4f9000ae3cf995f553115b2832d0e2d";
const SWAP_SELECTOR = "0xbc651188";
const TOKEN_OUT_DECIMALS = 18;

export type CanonicalNativeRpcCapture = {
  readonly classification: string;
  readonly real: boolean;
  readonly endpointClass: string;
  readonly qualificationReasons: readonly string[];
  readonly observations: {
    readonly pinnedBlock: {
      readonly number: string;
      readonly hash: string;
      readonly timestamp: string;
    };
    readonly preparedSwap: {
      readonly tx: {
        readonly from: string;
        readonly to: string;
        readonly data: string;
        readonly value: string;
        readonly chainId: number;
      };
      readonly route: {
        readonly tokenIn: string;
        readonly tokenOut: string;
        readonly pool: string;
      };
      readonly quoteAmountOutAtomic: string;
      readonly amountOutMinimumAtomic: string;
      readonly estimatedGas: string;
      readonly ethCallAmountOutAtomic: string;
      readonly ethCall: { readonly result: string };
      readonly ethEstimateGas: { readonly result: string };
    };
  };
};

export type CanonicalNativeRpcEvaluationInput = ProviderEvaluationInput<
  NormalizedSwapIntent,
  NativeRpcPreparedExecution<NormalizedSwapIntent>
>;

/**
 * Reconstructs the accepted #77 transaction as the exact execution input for
 * the concrete NativeRpcProvider. It refuses partial or internally divergent
 * captures rather than inventing missing quote, block, or transaction fields.
 */
export function createCanonicalNativeRpcEvaluationInput(
  capture: CanonicalNativeRpcCapture,
  runId: string,
): CanonicalNativeRpcEvaluationInput {
  if (
    capture.classification !== "QUALIFIED_REAL" ||
    capture.real !== true ||
    capture.endpointClass !== "arbitrum-official-public"
  ) {
    throw new TypeError(
      "Native RPC exercise requires a QUALIFIED_REAL canonical capture",
    );
  }
  if (capture.qualificationReasons.length !== 0) {
    throw new TypeError(
      "Native RPC exercise requires a QUALIFIED_REAL capture without qualification reasons",
    );
  }
  if (typeof runId !== "string" || runId.trim() === "") {
    throw new TypeError("Native RPC exercise runId must be non-empty");
  }

  const { pinnedBlock, preparedSwap } = capture.observations;
  const { tx, route } = preparedSwap;
  const blockNumber = parseHexQuantity(
    pinnedBlock.number,
    "pinned block number",
  );
  const blockTimestamp = parseHexQuantity(
    pinnedBlock.timestamp,
    "pinned block timestamp",
  );
  if (!/^0x[0-9a-fA-F]{64}$/.test(pinnedBlock.hash)) {
    throw new TypeError("Native RPC exercise requires a pinned block hash");
  }
  if (tx.chainId !== CHAIN_ID || route.pool.toLowerCase() !== POOL) {
    throw new TypeError(
      "Native RPC exercise capture is not the accepted target",
    );
  }
  if (
    route.tokenIn.toLowerCase() !== WETH ||
    route.tokenOut.toLowerCase() !== USDC ||
    tx.to.toLowerCase() !== ROUTER
  ) {
    throw new TypeError(
      "Native RPC exercise capture is not the accepted target",
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(tx.from)) {
    throw new TypeError("Native RPC exercise requires a valid sender");
  }

  const calldata = decodeCanonicalSwap(tx.data);
  const amountIn = BigInt(parseHexQuantity(tx.value, "transaction value"));
  const quoteAmountOut = parseDecimalQuantity(
    preparedSwap.quoteAmountOutAtomic,
    "quote output",
  );
  const minimumReceived = parseDecimalQuantity(
    preparedSwap.amountOutMinimumAtomic,
    "minimum received",
  );
  const gasUnits = parseDecimalQuantity(
    preparedSwap.estimatedGas,
    "gas estimate",
  );
  const callAmountOut = decodeSingleWord(
    preparedSwap.ethCall.result,
    "pinned eth_call result",
  );
  const gasFromRpc = BigInt(
    parseHexQuantity(
      preparedSwap.ethEstimateGas.result,
      "pinned eth_estimateGas result",
    ),
  );

  if (
    calldata.tokenIn !== WETH ||
    calldata.tokenOut !== USDC ||
    calldata.recipient !== tx.from.toLowerCase() ||
    amountIn !== 1_000_000_000_000_000n ||
    BigInt(calldata.amountIn) !== amountIn ||
    BigInt(calldata.minimumReceived) !== minimumReceived ||
    BigInt(calldata.deadline) !== BigInt(blockTimestamp) + 3600n ||
    calldata.limitSqrtPrice !== 0n
  ) {
    throw new TypeError(
      "Canonical transaction calldata does not match its prepared fields",
    );
  }
  if (
    callAmountOut !== quoteAmountOut ||
    parseDecimalQuantity(
      preparedSwap.ethCallAmountOutAtomic,
      "decoded pinned eth_call output",
    ) !== callAmountOut ||
    gasFromRpc !== gasUnits ||
    quoteAmountOut <= 0n ||
    minimumReceived <= 0n ||
    gasUnits <= 0n
  ) {
    throw new TypeError(
      "Canonical quote, pinned execution result, and prepared estimates disagree",
    );
  }

  const sender = tx.from.toLowerCase();
  const intent: NormalizedSwapIntent = {
    chainId: CHAIN_ID,
    protocol: PROTOCOL,
    sender,
    recipient: sender,
    recipientSource: "defaulted_from_sender",
    tokenIn: { kind: "native" },
    tokenOut: { kind: "erc20", address: USDC },
    amountInAtomic: amountIn.toString(),
    economicBoundary: { availability: "unavailable", source: "unavailable" },
  };
  const preparedExecution: NativeRpcPreparedExecution<NormalizedSwapIntent> = {
    runId,
    intent,
    chainId: CHAIN_ID,
    protocol: PROTOCOL,
    blockContext: {
      blockNumber,
      blockHash: pinnedBlock.hash.toLowerCase(),
      observedAt: new Date(Number(blockTimestamp) * 1000).toISOString(),
    },
    quote: {
      estimatedAmountOut: convertAtomicAmountToHuman(
        quoteAmountOut.toString(),
        TOKEN_OUT_DECIMALS,
      ),
      source: "quote",
      blockNumber,
      runtimeVersion: "arbitrum-camelot-v3",
      runtimeRevision: "native-rpc",
    },
    unsignedTransaction: {
      kind: "unsigned",
      payload: {
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      },
    },
    gasEstimate: { gasUnits: gasUnits.toString() },
    finality: { status: "unknown" },
  };

  return {
    runId,
    intent,
    chainId: CHAIN_ID,
    protocol: PROTOCOL,
    input: preparedExecution,
  };
}

function decodeCanonicalSwap(data: string): {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly recipient: string;
  readonly deadline: string;
  readonly amountIn: string;
  readonly minimumReceived: string;
  readonly limitSqrtPrice: bigint;
} {
  const wordPattern = "[0-9a-fA-F]{64}";
  const calldataPattern = new RegExp(
    `^${SWAP_SELECTOR}${wordPattern}(?:${wordPattern}){6}$`,
  );
  if (typeof data !== "string" || !calldataPattern.test(data)) {
    throw new TypeError("Canonical transaction calldata has an invalid shape");
  }
  const words = data.slice(10).match(/.{64}/g);
  if (words === null || words.length !== 7) {
    throw new TypeError("Canonical transaction calldata has an invalid shape");
  }
  const addressWord = (word: string) => `0x${word.slice(24).toLowerCase()}`;
  return {
    tokenIn: addressWord(words[0]),
    tokenOut: addressWord(words[1]),
    recipient: addressWord(words[2]),
    deadline: BigInt(`0x${words[3]}`).toString(),
    amountIn: BigInt(`0x${words[4]}`).toString(),
    minimumReceived: BigInt(`0x${words[5]}`).toString(),
    limitSqrtPrice: BigInt(`0x${words[6]}`),
  };
}

function decodeSingleWord(value: string, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`Native RPC exercise ${label} must be one ABI word`);
  }
  return BigInt(value);
}

function parseHexQuantity(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    throw new TypeError(`Native RPC exercise ${label} must be a hex quantity`);
  }
  return BigInt(value).toString(10);
}

function parseDecimalQuantity(value: string, label: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(
      `Native RPC exercise ${label} must be a decimal quantity`,
    );
  }
  return BigInt(value);
}
