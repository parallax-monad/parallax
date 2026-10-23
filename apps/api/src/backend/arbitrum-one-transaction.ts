import { createHash } from "node:crypto";
import {
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
  type P0BasicSimulation,
  type Quote,
  quoteSchema,
  type TokenMetadataPair,
} from "@parallax/contracts";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
} from "../runtime-config.js";
import { isValidArbitrumOneQuoteProvenance } from "./arbitrum-one-quote.js";
import {
  CAMELOT_V3_ROUTER_EXACT_INPUT_SINGLE_SELECTOR,
  encodeWords,
  resolveCamelotV3TransactionProtection,
} from "./camelot-v3-protocol-adapter.js";
import { fingerprintPreparedTransaction } from "./prepared-transaction-fingerprint.js";

const DECIMAL_UINT_PATTERN = /^(?:0|[1-9]\d*)$/;
const RPC_QUANTITY_PATTERN = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const ABI_WORD_LENGTH = 64;
const ABI_WORD_COUNT = 7;
const UINT160_ZERO = 0n;
const TRANSACTION_DEADLINE_SECONDS = 90n;
const UINT256_MAX = (1n << 256n) - 1n;

export type ArbitrumOneTransactionPayload = Readonly<{
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: string;
}>;

export type PreparedArbitrumOneTransaction = Readonly<{
  kind: "unsigned";
  payload: ArbitrumOneTransactionPayload;
  fingerprint: string;
}>;

export type ArbitrumOneTransactionBinding = NonNullable<
  P0BasicSimulation["transactionBinding"]
>;

export type ArbitrumOneTransactionInspection =
  | { readonly ok: true; readonly binding: ArbitrumOneTransactionBinding }
  | { readonly ok: false; readonly reason: string };

/**
 * Prepare the exact unsigned One transaction only from the backend-owned route
 * profile and a quote whose full provenance matches the normalized Intent.
 * This is an internal preparation seam; it is not wired to production Check.
 */
export function prepareArbitrumOneTransaction(input: {
  readonly intent: NormalizedSwapIntent;
  readonly quote: Quote;
  readonly now?: () => Date;
}): PreparedArbitrumOneTransaction {
  const intent = normalizedSwapIntentSchema.parse(input.intent);
  const quote = quoteSchema.parse(input.quote);
  const provenance = quote.provenance;
  if (provenance === undefined) {
    throw new Error("Arbitrum One transaction requires quote provenance");
  }
  const tokenMetadata: TokenMetadataPair = {
    tokenIn: provenance.inputAsset,
    tokenOut: provenance.outputAsset,
  };
  if (!isValidArbitrumOneQuoteProvenance({ quote, intent, tokenMetadata })) {
    throw new Error("Arbitrum One quote is not bound to the verified Intent");
  }

  const observedAt = (input.now ?? (() => new Date()))();
  if (Number.isNaN(observedAt.getTime())) {
    throw new Error("Arbitrum One transaction clock is invalid");
  }
  const deadline =
    BigInt(Math.floor(observedAt.getTime() / 1000)) +
    TRANSACTION_DEADLINE_SECONDS;
  const sourceTimestamp = BigInt(provenance.sourceBlock.timestamp);
  if (deadline <= sourceTimestamp) {
    throw new Error(
      "Arbitrum One transaction deadline predates the quote block",
    );
  }

  const amountIn = parseAtomic(provenance.amountInAtomic, "quote amountIn");
  const amountOut = parseAtomic(provenance.amountOutAtomic, "quote amountOut");
  const amountOutMinimum = resolveCamelotV3TransactionProtection(
    intent,
    amountOut,
  );
  const { deployments, route } = ARBITRUM_ONE_RUNTIME_PROFILE;
  const data = `0x${encodeWords(CAMELOT_V3_ROUTER_EXACT_INPUT_SINGLE_SELECTOR, [
    route.tokenIn.wrappedAddress,
    deployments.usdcAddress,
    intent.recipient,
    deadline,
    amountIn,
    amountOutMinimum,
    UINT160_ZERO,
  ])}`;
  const transaction: ArbitrumOneTransactionPayload = Object.freeze({
    from: intent.sender,
    to: deployments.routerAddress,
    data,
    value: toRpcQuantity(amountIn),
    chainId: toRpcQuantity(BigInt(ARBITRUM_ONE_CHAIN_ID)),
  });

  const inspection = inspectArbitrumOneTransaction({
    intent,
    quote,
    transaction,
    now: observedAt,
  });
  if (!inspection.ok) {
    throw new Error("Arbitrum One transaction failed backend binding");
  }
  return Object.freeze({
    kind: "unsigned",
    payload: transaction,
    fingerprint: fingerprintArbitrumOneTransaction(transaction),
  });
}

/** Independently inspect, but never rebuild, a prepared One transaction. */
export function inspectArbitrumOneTransaction(input: {
  readonly intent: NormalizedSwapIntent;
  readonly quote: Quote;
  readonly transaction: unknown;
  readonly now?: Date;
}): ArbitrumOneTransactionInspection {
  const intentResult = normalizedSwapIntentSchema.safeParse(input.intent);
  const quoteResult = quoteSchema.safeParse(input.quote);
  if (!intentResult.success || !quoteResult.success) {
    return invalid("Intent or Quote is malformed");
  }
  const intent = intentResult.data;
  const quote = quoteResult.data;
  const provenance = quote.provenance;
  if (provenance === undefined) return invalid("Quote provenance is missing");
  const tokenMetadata: TokenMetadataPair = {
    tokenIn: provenance.inputAsset,
    tokenOut: provenance.outputAsset,
  };
  if (!isValidArbitrumOneQuoteProvenance({ quote, intent, tokenMetadata })) {
    return invalid("Quote does not match the verified One route and Intent");
  }
  if (!isRecord(input.transaction)) {
    return invalid("Prepared transaction is not an object");
  }
  const transaction = input.transaction;
  const expectedKeys = ["chainId", "data", "from", "to", "value"];
  if (
    Object.keys(transaction).sort().join(",") !== expectedKeys.join(",") ||
    !isAddress(transaction.from) ||
    !isAddress(transaction.to) ||
    typeof transaction.data !== "string" ||
    !/^0x(?:[0-9a-f]{2})+$/i.test(transaction.data) ||
    typeof transaction.value !== "string" ||
    !RPC_QUANTITY_PATTERN.test(transaction.value) ||
    typeof transaction.chainId !== "string" ||
    transaction.chainId.toLowerCase() !== "0xa4b1"
  ) {
    return invalid("Prepared transaction fields are malformed or unexpected");
  }

  const profile = ARBITRUM_ONE_RUNTIME_PROFILE;
  if (
    intent.chainId !== ARBITRUM_ONE_CHAIN_ID ||
    intent.protocol !== profile.protocolId ||
    intent.tokenIn.kind !== "native" ||
    intent.tokenOut.kind !== "erc20" ||
    intent.tokenOut.address.toLowerCase() !==
      profile.route.tokenOut.address.toLowerCase() ||
    transaction.from.toLowerCase() !== intent.sender.toLowerCase() ||
    transaction.to.toLowerCase() !==
      profile.deployments.routerAddress.toLowerCase()
  ) {
    return invalid("Prepared transaction is outside the verified One route");
  }

  const encoded = transaction.data.slice(2);
  if (
    encoded.length !== 8 + ABI_WORD_COUNT * ABI_WORD_LENGTH ||
    encoded.slice(0, 8).toLowerCase() !==
      CAMELOT_V3_ROUTER_EXACT_INPUT_SINGLE_SELECTOR
  ) {
    return invalid("Prepared transaction is not Camelot exactInputSingle");
  }
  const words = Array.from({ length: ABI_WORD_COUNT }, (_, index) =>
    encoded.slice(
      8 + index * ABI_WORD_LENGTH,
      8 + (index + 1) * ABI_WORD_LENGTH,
    ),
  );
  const tokenIn = decodeAddressWord(words[0]);
  const tokenOut = decodeAddressWord(words[1]);
  const recipient = decodeAddressWord(words[2]);
  const deadline = decodeUintWord(words[3]);
  const amountIn = decodeUintWord(words[4]);
  const amountOutMinimum = decodeUintWord(words[5]);
  const sqrtPriceLimitX96 = decodeUintWord(words[6]);
  if (
    tokenIn === undefined ||
    tokenOut === undefined ||
    recipient === undefined ||
    deadline === undefined ||
    amountIn === undefined ||
    amountOutMinimum === undefined ||
    sqrtPriceLimitX96 === undefined
  ) {
    return invalid(
      "Prepared transaction calldata contains an invalid ABI word",
    );
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime()))
    return invalid("Transaction clock is invalid");
  const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
  const sourceTimestamp = BigInt(provenance.sourceBlock.timestamp);
  if (deadline <= nowSeconds || deadline <= sourceTimestamp) {
    return invalid("Prepared transaction deadline is expired");
  }

  const expectedAmountIn = parseAtomic(
    provenance.amountInAtomic,
    "quote amountIn",
  );
  const expectedAmountOut = parseAtomic(
    provenance.amountOutAtomic,
    "quote amountOut",
  );
  let expectedMinimum: bigint;
  try {
    expectedMinimum = resolveCamelotV3TransactionProtection(
      intent,
      expectedAmountOut,
    );
  } catch {
    return invalid("Quote does not provide a valid minimum-output protection");
  }
  if (
    tokenIn.toLowerCase() !==
      profile.route.tokenIn.wrappedAddress.toLowerCase() ||
    tokenOut.toLowerCase() !== profile.deployments.usdcAddress.toLowerCase() ||
    recipient.toLowerCase() !== intent.recipient.toLowerCase() ||
    amountIn !== expectedAmountIn ||
    amountOutMinimum !== expectedMinimum ||
    sqrtPriceLimitX96 !== UINT160_ZERO ||
    BigInt(transaction.value) !== expectedAmountIn
  ) {
    return invalid(
      "Prepared transaction does not match its quote or protection",
    );
  }

  const transactionPayload = transaction as ArbitrumOneTransactionPayload;
  return {
    ok: true,
    binding: {
      chainId: ARBITRUM_ONE_CHAIN_ID,
      protocol: profile.protocolId,
      sender: intent.sender,
      recipient: intent.recipient,
      tokenIn: "native",
      tokenOut: profile.deployments.usdcAddress.toLowerCase(),
      amountInAtomic: expectedAmountIn.toString(),
      amountOutMinimumAtomic: expectedMinimum.toString(),
      router: profile.deployments.routerAddress,
      from: transactionPayload.from,
      to: transactionPayload.to,
      value: transactionPayload.value,
      dataFingerprint: fingerprintData(transactionPayload.data),
    },
  };
}

export function fingerprintArbitrumOneTransaction(
  transaction: ArbitrumOneTransactionPayload,
): string {
  return fingerprintPreparedTransaction(transaction);
}

function parseAtomic(value: string, label: string): bigint {
  if (!DECIMAL_UINT_PATTERN.test(value)) {
    throw new Error(`${label} is not a canonical atomic integer`);
  }
  const amount = BigInt(value);
  if (amount <= 0n || amount > UINT256_MAX) {
    throw new Error(`${label} is outside uint256`);
  }
  return amount;
}

function toRpcQuantity(value: bigint): string {
  if (value < 0n) throw new Error("RPC quantity cannot be negative");
  return `0x${value.toString(16)}`;
}

function decodeUintWord(word: string | undefined): bigint | undefined {
  if (word === undefined || !/^[0-9a-f]{64}$/i.test(word)) return undefined;
  return BigInt(`0x${word}`);
}

function decodeAddressWord(word: string | undefined): string | undefined {
  if (
    word === undefined ||
    !/^[0-9a-f]{64}$/i.test(word) ||
    !/^0{24}$/i.test(word.slice(0, 24))
  ) {
    return undefined;
  }
  return `0x${word.slice(24).toLowerCase()}`;
}

function fingerprintData(data: string): string {
  return `sha256:${createHash("sha256").update(data.toLowerCase()).digest("hex")}`;
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(reason: string): ArbitrumOneTransactionInspection {
  return { ok: false, reason };
}
