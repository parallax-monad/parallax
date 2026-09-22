import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
  convertAtomicAmountToHuman,
  convertHumanAmountToAtomic,
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
} from "@parallax/contracts";
import {
  type ArbitrumRpcClient,
  createArbitrumRpcClient,
} from "./arbitrum-chain-adapter.js";
import type {
  ProtocolQuoteOptions,
  ProtocolTransactionOptions,
} from "./protocol-adapter.js";
import {
  isProtocolAdapterError,
  type ProtocolAdapter,
  ProtocolAdapterError,
  type UnsignedTransaction,
} from "./protocol-adapter.js";

export type CamelotV3QuoteSeam = (
  intent: NormalizedSwapIntent,
  options?: ProtocolQuoteOptions,
) => unknown | Promise<unknown>;

export type CamelotV3Transaction = Readonly<Record<string, unknown>>;

export type CamelotV3TransactionSeam = (
  intent: NormalizedSwapIntent,
  options?: ProtocolTransactionOptions<unknown>,
) =>
  | CamelotV3Transaction
  | UnsignedTransaction<CamelotV3Transaction>
  | Promise<CamelotV3Transaction | UnsignedTransaction<CamelotV3Transaction>>;

export type CamelotV3ProtocolAdapterOptions = {
  /** Controlled feasibility seam; no pool or quote is inferred when absent. */
  readonly quote?: CamelotV3QuoteSeam;
  /** Controlled unsigned-transaction seam; signing and broadcasting are absent. */
  readonly buildTransaction?: CamelotV3TransactionSeam;
  /** Runtime-configured JSON-RPC client used by the executable Camelot path. */
  readonly rpcClient?: ArbitrumRpcClient;
  /** Runtime-configured JSON-RPC URL used when a client is not injected. */
  readonly rpcUrl?: string;
  /** Output-token decimals used only for the public quote projection. */
  readonly tokenOutDecimals?: number;
  readonly runtimeVersion?: string;
  readonly runtimeRevision?: string;
};

export const CAMELOT_SEPOLIA_WETH =
  "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" as const;
export const CAMELOT_SEPOLIA_USDC =
  "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7" as const;
export const CAMELOT_SEPOLIA_QUOTER =
  "0xe49ef2F48539EA7498605CC1B3a242042cb5FC83" as const;
export const CAMELOT_SEPOLIA_ROUTER =
  "0x171B925C51565F5D2a7d8C494ba3188D304EFD93" as const;

const QUOTE_EXACT_INPUT_SINGLE_SELECTOR = "2d9ebd1d";
const ROUTER_EXACT_INPUT_SINGLE_SELECTOR = "bc651188";
const UINT160_ZERO = 0n;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_UINT_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const ABI_WORDS_PATTERN = /^0x(?:[0-9a-fA-F]{64})*$/;
const UINT256_MAX = (1n << 256n) - 1n;

/**
 * Camelot V3 protocol boundary for Arbitrum Sepolia.
 *
 * Without an explicitly configured RPC client or URL, the adapter remains
 * inert and exposes only the controlled seams used by feasibility tests. The
 * live path is read-only for quote/build purposes: it never signs or submits.
 */
export class CamelotV3ProtocolAdapter
  implements
    ProtocolAdapter<NormalizedSwapIntent, unknown, CamelotV3Transaction>
{
  public readonly protocolId = CAMELOT_V3_PROTOCOL_ID;
  private readonly quoteSeam: CamelotV3QuoteSeam | undefined;
  private readonly transactionSeam: CamelotV3TransactionSeam | undefined;

  public constructor(options: CamelotV3ProtocolAdapterOptions = {}) {
    const liveClient =
      options.rpcClient ??
      (options.rpcUrl === undefined
        ? undefined
        : createArbitrumRpcClient(options.rpcUrl));
    const metadata = {
      tokenOutDecimals: options.tokenOutDecimals ?? 18,
      runtimeVersion: options.runtimeVersion ?? "arbitrum-camelot-v3",
      runtimeRevision: options.runtimeRevision ?? "native-rpc",
    };
    this.quoteSeam =
      options.quote ??
      (liveClient === undefined
        ? undefined
        : (intent, options) =>
            this.liveQuote(intent, liveClient, metadata, options));
    this.transactionSeam =
      options.buildTransaction ??
      (liveClient === undefined
        ? undefined
        : (intent, transactionOptions) =>
            this.liveTransaction(intent, metadata, transactionOptions));
  }

  public async quote(
    intent: NormalizedSwapIntent,
    options?: ProtocolQuoteOptions,
  ): Promise<unknown> {
    const normalized = this.validateIntent(intent, "quote");
    if (this.quoteSeam === undefined) {
      throw unavailable("quote");
    }
    try {
      return await this.quoteSeam(normalized, options);
    } catch (error) {
      throw protocolFailure("QUOTE_FAILED", "quote", error);
    }
  }

  public async buildTransaction(
    intent: NormalizedSwapIntent,
    options?: ProtocolTransactionOptions<unknown>,
  ): Promise<UnsignedTransaction<CamelotV3Transaction>> {
    const normalized = this.validateIntent(intent, "buildTransaction");
    if (this.transactionSeam === undefined) {
      throw unavailable("unsigned transaction construction");
    }
    try {
      const transaction = await this.transactionSeam(normalized, options);
      if (isUnsignedTransaction(transaction)) return transaction;
      return { kind: "unsigned", payload: transaction };
    } catch (error) {
      throw protocolFailure(
        "BUILD_TRANSACTION_FAILED",
        "unsigned transaction",
        error,
      );
    }
  }

  private validateIntent(
    intent: NormalizedSwapIntent,
    operation: "quote" | "buildTransaction",
  ): NormalizedSwapIntent {
    try {
      const normalized = normalizedSwapIntentSchema.parse(intent);
      if (
        normalized.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID ||
        normalized.protocol !== CAMELOT_V3_PROTOCOL_ID
      ) {
        throw new Error(
          `Camelot V3 requires chain ${ARBITRUM_SEPOLIA_CHAIN_ID} and protocol ${CAMELOT_V3_PROTOCOL_ID}`,
        );
      }
      return normalized;
    } catch (cause) {
      throw new ProtocolAdapterError({
        code: "INVALID_INTENT",
        protocol: CAMELOT_V3_PROTOCOL_ID,
        message: `Camelot V3 ${operation} received an unsupported intent`,
        retryable: false,
        cause,
      });
    }
  }

  private async liveQuote(
    intent: NormalizedSwapIntent,
    client: ArbitrumRpcClient,
    metadata: {
      tokenOutDecimals: number;
      runtimeVersion: string;
      runtimeRevision: string;
    },
    options?: ProtocolQuoteOptions,
  ): Promise<unknown> {
    const tokenIn = protocolToken(intent.tokenIn);
    const tokenOut = protocolToken(intent.tokenOut);
    const amountIn = parseAtomic(intent.amountInAtomic, "amountInAtomic");
    const data = encodeWords(QUOTE_EXACT_INPUT_SINGLE_SELECTOR, [
      tokenIn,
      tokenOut,
      amountIn.toString(),
      UINT160_ZERO,
    ]);
    const raw = await client.request("eth_call", [
      { to: CAMELOT_SEPOLIA_QUOTER, data: `0x${data}` },
      blockTag(options),
    ]);
    const decoded = decodeQuote(raw);
    return {
      estimatedAmountOut: convertAtomicAmountToHuman(
        decoded.amountOut.toString(),
        metadata.tokenOutDecimals,
      ),
      source: "quote",
      ...(options?.blockContext === undefined
        ? {}
        : { blockNumber: options.blockContext.blockNumber }),
      runtimeVersion: metadata.runtimeVersion,
      runtimeRevision: metadata.runtimeRevision,
    };
  }

  private async liveTransaction(
    intent: NormalizedSwapIntent,
    metadata: {
      tokenOutDecimals: number;
      runtimeVersion: string;
      runtimeRevision: string;
    },
    options?: ProtocolTransactionOptions<unknown>,
  ): Promise<CamelotV3Transaction> {
    const quote = readTransactionQuote(
      options?.quote,
      metadata.tokenOutDecimals,
    );
    const requestedBlock = options?.blockContext?.blockNumber;
    if (requestedBlock !== undefined && quote.blockNumber !== requestedBlock) {
      throw new Error(
        "Camelot quote is not bound to the requested pinned block",
      );
    }
    const amountOut = quote.amountOut;
    const amountIn = parseAtomic(intent.amountInAtomic, "amountInAtomic");
    const amountOutMinimum = transactionProtection(intent, amountOut);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const data = encodeWords(ROUTER_EXACT_INPUT_SINGLE_SELECTOR, [
      protocolToken(intent.tokenIn),
      protocolToken(intent.tokenOut),
      intent.recipient,
      deadline.toString(),
      amountIn.toString(),
      amountOutMinimum.toString(),
      UINT160_ZERO,
    ]);
    return {
      from: intent.sender,
      to: CAMELOT_SEPOLIA_ROUTER,
      data: `0x${data}`,
      value: intent.tokenIn.kind === "native" ? quantity(amountIn) : "0x0",
      chainId: quantity(BigInt(ARBITRUM_SEPOLIA_CHAIN_ID)),
    };
  }
}

export function createCamelotV3ProtocolAdapter(
  options: CamelotV3ProtocolAdapterOptions = {},
): CamelotV3ProtocolAdapter {
  return new CamelotV3ProtocolAdapter(options);
}

function unavailable(operation: string): ProtocolAdapterError {
  return new ProtocolAdapterError({
    code: "UNAVAILABLE",
    protocol: CAMELOT_V3_PROTOCOL_ID,
    message: `Camelot V3 ${operation} is not configured; provide an RPC client/URL or controlled feasibility seam`,
    retryable: false,
  });
}

function protocolFailure(
  code: "QUOTE_FAILED" | "BUILD_TRANSACTION_FAILED",
  operation: string,
  error: unknown,
): ProtocolAdapterError {
  if (isProtocolAdapterError(error)) return error;
  return new ProtocolAdapterError({
    code,
    protocol: CAMELOT_V3_PROTOCOL_ID,
    message: `Camelot V3 ${operation} seam failed`,
    retryable: false,
    cause: error,
  });
}

function isUnsignedTransaction(
  value: CamelotV3Transaction | UnsignedTransaction<CamelotV3Transaction>,
): value is UnsignedTransaction<CamelotV3Transaction> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "unsigned" &&
    Object.hasOwn(value, "payload")
  );
}

function protocolToken(token: NormalizedSwapIntent["tokenIn"]): string {
  if (token.kind === "native") return CAMELOT_SEPOLIA_WETH;
  if (!ADDRESS_PATTERN.test(token.address)) {
    throw new Error("Camelot token address is malformed");
  }
  return token.address.toLowerCase();
}

function parseAtomic(value: string, label: string): bigint {
  if (!DECIMAL_UINT_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical unsigned decimal integer`);
  }
  const amount = BigInt(value);
  if (amount > UINT256_MAX) {
    throw new Error(`${label} exceeds uint256`);
  }
  return amount;
}

function encodeWords(
  selector: string,
  values: readonly (string | bigint)[],
): string {
  if (!/^[0-9a-fA-F]{8}$/.test(selector)) {
    throw new Error("Camelot selector must be a four-byte hex value");
  }
  return `${selector.toLowerCase()}${values.map(encodeWord).join("")}`;
}

function encodeWord(value: string | bigint): string {
  if (typeof value === "string" && ADDRESS_PATTERN.test(value)) {
    return value.slice(2).toLowerCase().padStart(64, "0");
  }

  const numeric =
    typeof value === "bigint" ? value : parseAtomic(value, "ABI word");
  if (numeric < 0n || numeric > UINT256_MAX) {
    throw new Error("ABI word is outside uint256 range");
  }
  return numeric.toString(16).padStart(64, "0");
}

function decodeQuote(raw: unknown): { amountOut: bigint } {
  if (typeof raw !== "string" || !ABI_WORDS_PATTERN.test(raw)) {
    throw new Error("Camelot quote result is not ABI-encoded");
  }
  const words = raw.slice(2).match(/.{64}/g) ?? [];
  if (words.length !== 2) {
    throw new Error("Camelot quote result must contain exactly two ABI words");
  }
  return { amountOut: BigInt(`0x${words[0]}`) };
}

function readTransactionQuote(
  value: unknown,
  tokenOutDecimals: number,
): { amountOut: bigint; blockNumber?: string } {
  const quote =
    isRecord(value) && value.status === "available" && isRecord(value.quote)
      ? value.quote
      : value;
  if (!isRecord(quote) || typeof quote.estimatedAmountOut !== "string") {
    throw new Error(
      "Camelot transaction construction requires the quote produced for this execution",
    );
  }
  const converted = convertHumanAmountToAtomic(
    quote.estimatedAmountOut,
    tokenOutDecimals,
  );
  if (!converted.success) {
    throw new Error(
      `Camelot quote amount is not representable in atomic units: ${converted.error.message}`,
    );
  }
  if (
    quote.blockNumber !== undefined &&
    (typeof quote.blockNumber !== "string" ||
      !DECIMAL_UINT_PATTERN.test(quote.blockNumber))
  ) {
    throw new Error("Camelot quote block number is malformed");
  }
  return {
    amountOut: BigInt(converted.amountAtomic),
    ...(quote.blockNumber === undefined
      ? {}
      : { blockNumber: quote.blockNumber }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves the exact `amountOutMinimum` encoded into the prepared Camelot
 * calldata, so the Transaction Protection reported through Evidence/API and
 * the Transaction Protection of the prepared unsigned transaction share one
 * source of truth.
 *
 * A caller-declared boundary is protocol Transaction Protection (#70), so the
 * canonical atomic amount is bound verbatim with no float or percentage
 * reinterpretation. Only when no boundary was supplied does the adapter fall
 * back to a protocol-side derived floor of the quote output.
 */
function transactionProtection(
  intent: NormalizedSwapIntent,
  quoteAmountOut: bigint,
): bigint {
  const boundary = intent.economicBoundary;
  if (boundary.availability === "available") {
    return parseAtomic(
      boundary.minimumReceivedAtomic,
      "economicBoundary.minimumReceivedAtomic",
    );
  }
  return (quoteAmountOut * 99n) / 100n;
}

function quantity(value: bigint): string {
  if (value < 0n) throw new Error("RPC quantity cannot be negative");
  return `0x${value.toString(16)}`;
}

function blockTag(options: ProtocolQuoteOptions | undefined): string {
  const blockNumber = options?.blockContext?.blockNumber;
  if (blockNumber === undefined || !DECIMAL_UINT_PATTERN.test(blockNumber)) {
    return "latest";
  }
  return quantity(BigInt(blockNumber));
}
