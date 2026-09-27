import { createHash } from "node:crypto";
import type { NormalizedSwapIntent } from "@parallax/contracts";
import type { ArbitrumTransaction } from "./arbitrum-chain-adapter.js";

export const CAMELOT_V3_ROUTER_ADDRESS =
  "0x171B925C51565F5D2a7d8C494ba3188D304EFD93" as const;
export const CAMELOT_V3_WETH_ADDRESS =
  "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" as const;

const ROUTER_EXACT_INPUT_SINGLE_SELECTOR = "bc651188";
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const QUANTITY_PATTERN = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const DATA_PATTERN = /^0x(?:[0-9a-f]{2})*$/i;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const ABI_WORD_COUNT = 7;

export type CamelotV3TransactionBinding = {
  readonly chainId: number;
  readonly protocol: string;
  readonly sender: string;
  readonly recipient: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountInAtomic: string;
  readonly amountOutMinimumAtomic: string;
  readonly router: string;
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly dataFingerprint: string;
};

export type CamelotV3BindingInspection =
  | { readonly ok: true; readonly binding: CamelotV3TransactionBinding }
  | { readonly ok: false; readonly reason: string };

/**
 * Decodes the concrete Camelot exactInputSingle transaction produced by the
 * protocol adapter and checks every Intent-owned field that reaches calldata.
 * The quote's private `amountOutAtomic` is required when no explicit economic
 * boundary is available so the protocol-derived 99% floor is actually bound;
 * public quote projection never exposes it.
 */
export function inspectCamelotV3Transaction(
  intent: NormalizedSwapIntent,
  quote: unknown,
  transaction: ArbitrumTransaction,
): CamelotV3BindingInspection {
  if (!isAddress(transaction.from) || !isAddress(transaction.to)) {
    return invalid("Camelot prepared transaction has invalid from/to");
  }
  if (transaction.from.toLowerCase() !== intent.sender.toLowerCase()) {
    return invalid("Camelot prepared transaction sender differs from Intent");
  }
  if (
    transaction.to.toLowerCase() !== CAMELOT_V3_ROUTER_ADDRESS.toLowerCase()
  ) {
    return invalid("Camelot prepared transaction router differs from Intent");
  }
  if (!isHexQuantity(transaction.value)) {
    return invalid("Camelot prepared transaction value is invalid");
  }
  if (
    transaction.chainId !== undefined &&
    transaction.chainId.toLowerCase() !== "0x66eee"
  ) {
    return invalid(
      "Camelot prepared transaction chainId is not Arbitrum Sepolia",
    );
  }
  if (!isHexData(transaction.data)) {
    return invalid("Camelot prepared transaction calldata is invalid");
  }

  const encoded = transaction.data.slice(2);
  if (
    encoded.length !== 8 + ABI_WORD_COUNT * 64 ||
    encoded.slice(0, 8).toLowerCase() !== ROUTER_EXACT_INPUT_SINGLE_SELECTOR
  ) {
    return invalid(
      "Camelot prepared transaction calldata is not exactInputSingle",
    );
  }
  const words = Array.from({ length: ABI_WORD_COUNT }, (_, index) =>
    encoded.slice(8 + index * 64, 8 + (index + 1) * 64),
  );
  const tokenIn = wordAddress(words[0]);
  const tokenOut = wordAddress(words[1]);
  const recipient = wordAddress(words[2]);
  if (
    tokenIn === undefined ||
    tokenOut === undefined ||
    recipient === undefined
  ) {
    return invalid(
      "Camelot prepared transaction calldata contains an invalid address",
    );
  }
  const amountInAtomic = wordQuantity(words[4]);
  const amountOutMinimumAtomic = wordQuantity(words[5]);
  if (amountInAtomic === undefined || amountOutMinimumAtomic === undefined) {
    return invalid(
      "Camelot prepared transaction calldata contains an invalid amount",
    );
  }

  const expectedTokenIn = protocolToken(intent.tokenIn);
  const expectedTokenOut = protocolToken(intent.tokenOut);
  if (tokenIn !== expectedTokenIn || tokenOut !== expectedTokenOut) {
    return invalid("Camelot token pair is not bound to the Intent");
  }
  if (recipient !== intent.recipient.toLowerCase()) {
    return invalid("Camelot recipient is not bound to the Intent");
  }
  if (amountInAtomic !== intent.amountInAtomic) {
    return invalid("Camelot amountIn is not bound to the Intent");
  }

  const expectedValue = intent.tokenIn.kind === "native" ? amountInAtomic : "0";
  if (BigInt(transaction.value) !== BigInt(expectedValue)) {
    return invalid("Camelot transaction value is not bound to amountIn");
  }

  const expectedMinimum = expectedAmountOutMinimum(intent, quote);
  if (expectedMinimum === undefined) {
    return invalid(
      "Camelot amountOutMinimum cannot be verified without an atomic quote or explicit boundary",
    );
  }
  if (amountOutMinimumAtomic !== expectedMinimum) {
    return invalid(
      "Camelot amountOutMinimum is not bound to protection policy",
    );
  }

  return {
    ok: true,
    binding: {
      chainId: intent.chainId,
      protocol: intent.protocol,
      sender: intent.sender,
      recipient: intent.recipient,
      tokenIn: assetKey(intent.tokenIn),
      tokenOut: assetKey(intent.tokenOut),
      amountInAtomic,
      amountOutMinimumAtomic,
      router: CAMELOT_V3_ROUTER_ADDRESS,
      from: transaction.from,
      to: transaction.to,
      value: transaction.value,
      dataFingerprint: fingerprint(transaction.data.toLowerCase()),
    },
  };
}

function expectedAmountOutMinimum(
  intent: NormalizedSwapIntent,
  quote: unknown,
): string | undefined {
  if (intent.economicBoundary.availability === "available") {
    return intent.economicBoundary.minimumReceivedAtomic;
  }
  if (
    !isRecord(quote) ||
    !DECIMAL_PATTERN.test(String(quote.amountOutAtomic))
  ) {
    return undefined;
  }
  return ((BigInt(String(quote.amountOutAtomic)) * 99n) / 100n).toString();
}

function protocolToken(asset: NormalizedSwapIntent["tokenIn"]): string {
  return asset.kind === "native"
    ? CAMELOT_V3_WETH_ADDRESS.toLowerCase()
    : asset.address.toLowerCase();
}

function assetKey(asset: NormalizedSwapIntent["tokenIn"]): string {
  return asset.kind === "native" ? "native" : asset.address.toLowerCase();
}

function wordAddress(word: string | undefined): string | undefined {
  if (word === undefined || !/^[0-9a-f]{64}$/i.test(word)) return undefined;
  if (!/^0{24}/i.test(word)) return undefined;
  return `0x${word.slice(-40).toLowerCase()}`;
}

function wordQuantity(word: string | undefined): string | undefined {
  if (word === undefined || !/^[0-9a-f]{64}$/i.test(word)) return undefined;
  return BigInt(`0x${word}`).toString();
}

function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function invalid(reason: string): CamelotV3BindingInspection {
  return { ok: false, reason };
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isHexData(value: unknown): value is string {
  return typeof value === "string" && DATA_PATTERN.test(value);
}

function isHexQuantity(value: unknown): value is string {
  return typeof value === "string" && QUANTITY_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
