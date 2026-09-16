import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
} from "@parallax/contracts";
import {
  isProtocolAdapterError,
  type ProtocolAdapter,
  ProtocolAdapterError,
  type UnsignedTransaction,
} from "./protocol-adapter.js";

export type CamelotV3QuoteSeam = (
  intent: NormalizedSwapIntent,
) => unknown | Promise<unknown>;

export type CamelotV3Transaction = Readonly<Record<string, unknown>>;

export type CamelotV3TransactionSeam = (
  intent: NormalizedSwapIntent,
) =>
  | CamelotV3Transaction
  | UnsignedTransaction<CamelotV3Transaction>
  | Promise<CamelotV3Transaction | UnsignedTransaction<CamelotV3Transaction>>;

export type CamelotV3ProtocolAdapterOptions = {
  /** Controlled feasibility seam; no pool or quote is inferred when absent. */
  readonly quote?: CamelotV3QuoteSeam;
  /** Controlled unsigned-transaction seam; signing and broadcasting are absent. */
  readonly buildTransaction?: CamelotV3TransactionSeam;
};

/**
 * Camelot V3 protocol boundary for Arbitrum Sepolia.
 *
 * The default adapter intentionally has no real pair, pool, quote, or calldata.
 * A controlled seam must be injected for feasibility scenarios; this keeps
 * BE-047 acceptance and production credentials outside PR-P0-A.
 */
export class CamelotV3ProtocolAdapter
  implements
    ProtocolAdapter<NormalizedSwapIntent, unknown, CamelotV3Transaction>
{
  public readonly protocolId = CAMELOT_V3_PROTOCOL_ID;
  private readonly quoteSeam: CamelotV3QuoteSeam | undefined;
  private readonly transactionSeam: CamelotV3TransactionSeam | undefined;

  public constructor(options: CamelotV3ProtocolAdapterOptions = {}) {
    this.quoteSeam = options.quote;
    this.transactionSeam = options.buildTransaction;
  }

  public async quote(intent: NormalizedSwapIntent): Promise<unknown> {
    const normalized = this.validateIntent(intent, "quote");
    if (this.quoteSeam === undefined) {
      throw unavailable("quote");
    }
    try {
      return await this.quoteSeam(normalized);
    } catch (error) {
      throw protocolFailure("QUOTE_FAILED", "quote", error);
    }
  }

  public async buildTransaction(
    intent: NormalizedSwapIntent,
  ): Promise<UnsignedTransaction<CamelotV3Transaction>> {
    const normalized = this.validateIntent(intent, "buildTransaction");
    if (this.transactionSeam === undefined) {
      throw unavailable("unsigned transaction construction");
    }
    try {
      const transaction = await this.transactionSeam(normalized);
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
    message: `Camelot V3 ${operation} is not configured; inject a controlled feasibility seam`,
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
