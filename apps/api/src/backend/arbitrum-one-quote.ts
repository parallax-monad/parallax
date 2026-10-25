import {
  convertAtomicAmountToHuman,
  type NormalizedSwapIntent,
  type Quote,
  type QuoteProvenance,
  type TokenMetadataPair,
  type TrustedTokenMetadata,
} from "@parallax/contracts";
import type { QuoteAgentFlowPort } from "../ports.js";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_PROFILE_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
  type BackendRuntime,
} from "../runtime-config.js";
import { resolveTokenMetadata } from "../token-metadata.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import { createArbitrumOneQuoteRuntime } from "./arbitrum-one-runtime.js";
import type { ChainOperationOptions } from "./chain-adapter.js";

const QUOTE_EXACT_INPUT_SINGLE_SELECTOR = "2d9ebd1d";
const TOKEN0_SELECTOR = "0dfe1681";
const TOKEN1_SELECTOR = "d21220a7";
const LIQUIDITY_SELECTOR = "1a686502";
const DECIMALS_SELECTOR = "313ce567";
const SYMBOL_SELECTOR = "95d89b41";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const RPC_QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const defaultRpcTimeoutMs = 30_000;

export type ArbitrumOneQuoteFlowOptions = {
  /** Internal deterministic-test seam; never populated from an API request. */
  readonly rpcClient?: ArbitrumRpcClient;
  readonly fetchImplementation?: typeof fetch;
  /** Clock seam used only to make pinned-block provenance tests deterministic. */
  readonly now?: () => Date;
  /** Optional source block pin supplied only by the validated local-fork Check. */
  readonly sourceBlockNumber?: string;
};

type RpcBlock = {
  readonly number?: unknown;
  readonly hash?: unknown;
  readonly timestamp?: unknown;
};

/** Quote-only flow for the one verified Arbitrum One direct pool. */
export function createArbitrumOneQuoteFlow(
  runtime: BackendRuntime,
  options: ArbitrumOneQuoteFlowOptions = {},
): QuoteAgentFlowPort {
  return {
    async quote(input) {
      if (!supportsVerifiedRoute(input.intent)) {
        return { status: "unavailable", reason: "NO_ROUTE" };
      }

      try {
        const metadata = resolveTokenMetadata(
          runtime.tokenRegistry,
          input.intent,
        );
        assertTrustedMetadata(
          metadata,
          input.tokenInDecimals,
          input.tokenOutDecimals,
        );
        const quoteRuntime = await createArbitrumOneQuoteRuntime(runtime, {
          ...(options.rpcClient === undefined
            ? {}
            : { rpcClient: options.rpcClient }),
          ...(options.fetchImplementation === undefined
            ? {}
            : { fetchImplementation: options.fetchImplementation }),
        });
        const quote = await readPinnedQuote(
          quoteRuntime.rpcClient,
          input.intent,
          metadata.tokenIn,
          metadata.tokenOut,
          options.now ?? (() => new Date()),
          options.sourceBlockNumber,
        );
        return { status: "available", quote };
      } catch {
        // Provider details, endpoint values, and low-level RPC errors do not
        // cross the public Quote boundary. Missing or unverified facts are
        // represented as unavailable, never as a partial Quote.
        return { status: "unavailable", reason: "QUOTE_UNAVAILABLE" };
      }
    },
  };
}

function supportsVerifiedRoute(intent: NormalizedSwapIntent): boolean {
  return (
    intent.chainId === ARBITRUM_ONE_CHAIN_ID &&
    intent.protocol === ARBITRUM_ONE_RUNTIME_PROFILE.protocolId &&
    intent.tokenIn.kind === "native" &&
    intent.tokenOut.kind === "erc20" &&
    intent.tokenOut.address.toLowerCase() ===
      ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.address.toLowerCase()
  );
}

function assertTrustedMetadata(
  metadata: { tokenIn: TrustedTokenMetadata; tokenOut: TrustedTokenMetadata },
  tokenInDecimals: number,
  tokenOutDecimals: number,
): void {
  const { tokenIn, tokenOut } = metadata;
  if (
    tokenIn.chainId !== ARBITRUM_ONE_CHAIN_ID ||
    tokenIn.asset.kind !== "native" ||
    tokenIn.symbol !== "ETH" ||
    tokenIn.decimals !== ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenIn.decimals ||
    tokenInDecimals !== tokenIn.decimals ||
    tokenOut.chainId !== ARBITRUM_ONE_CHAIN_ID ||
    tokenOut.asset.kind !== "erc20" ||
    tokenOut.asset.address.toLowerCase() !==
      ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.address.toLowerCase() ||
    tokenOut.symbol !== "USDC" ||
    tokenOut.decimals !==
      ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.decimals ||
    tokenOut.decimalsSource !== "onchain_verified" ||
    tokenOutDecimals !== tokenOut.decimals
  ) {
    throw new Error(
      "Arbitrum One quote metadata does not match the verified route",
    );
  }
}

async function readPinnedQuote(
  rpc: {
    request(
      method:
        | "eth_blockNumber"
        | "eth_getBlockByNumber"
        | "eth_getCode"
        | "eth_call",
      params?: readonly unknown[],
      options?: ChainOperationOptions,
    ): Promise<unknown>;
  },
  intent: NormalizedSwapIntent,
  inputAsset: TrustedTokenMetadata,
  outputAsset: TrustedTokenMetadata,
  now: () => Date,
  sourceBlockNumber?: string,
): Promise<Record<string, unknown>> {
  const sourceHead = parseRpcQuantity(
    await rpc.request("eth_blockNumber", [], {
      timeoutMs: defaultRpcTimeoutMs,
    }),
  );
  const selectedBlock =
    sourceBlockNumber === undefined
      ? sourceHead
      : parseDecimalBlockNumber(sourceBlockNumber);
  if (selectedBlock > sourceHead) {
    throw new Error("Pinned source block is ahead of the source RPC head");
  }
  const blockTag = toRpcQuantity(selectedBlock);
  const sourceBlock = await readBlock(rpc, blockTag, selectedBlock);
  if (
    outputAsset.decimalsSource !== "onchain_verified" ||
    BigInt(outputAsset.verifiedAtBlock) > selectedBlock
  ) {
    throw new Error(
      "Trusted output metadata is not verified at the pinned block",
    );
  }

  const { deployments, route } = ARBITRUM_ONE_RUNTIME_PROFILE;
  const codeAddresses = [
    deployments.factoryAddress,
    deployments.quoterAddress,
    deployments.routerAddress,
    deployments.wrappedNativeAddress,
    deployments.usdcAddress,
    route.poolAddress,
  ];
  await Promise.all(
    codeAddresses.map((address) => requireContractCode(rpc, address, blockTag)),
  );

  await verifyTokenMetadata(
    rpc,
    deployments.wrappedNativeAddress,
    "WETH",
    route.tokenIn.decimals,
    blockTag,
  );
  await verifyTokenMetadata(
    rpc,
    deployments.usdcAddress,
    "USDC",
    route.tokenOut.decimals,
    blockTag,
  );
  await verifyDirectPool(rpc, route.poolAddress, blockTag);

  const amountIn = parseAtomicAmount(intent.amountInAtomic);
  const callData = encodeQuoteCall(
    deployments.wrappedNativeAddress,
    deployments.usdcAddress,
    amountIn,
  );
  const rawQuote = await rpc.request(
    "eth_call",
    [{ to: deployments.quoterAddress, data: callData }, blockTag],
    { timeoutMs: defaultRpcTimeoutMs },
  );
  const amountOut = decodeQuoteAmount(rawQuote);

  // Re-read the exact numbered block after every state-dependent observation.
  // A reorg during the request invalidates the provenance instead of returning
  // a Quote that combines two different block hashes.
  const finalBlock = await readBlock(rpc, blockTag, selectedBlock);
  if (finalBlock.hash.toLowerCase() !== sourceBlock.hash.toLowerCase()) {
    throw new Error("Pinned source block hash changed during the quote");
  }
  const observedAtDate = now();
  if (Number.isNaN(observedAtDate.getTime())) {
    throw new Error("Quote observation clock is invalid");
  }
  const observedAt = observedAtDate.toISOString();

  const provenance: QuoteProvenance = {
    version: 1,
    profileId: ARBITRUM_ONE_PROFILE_ID,
    sourceChainId: ARBITRUM_ONE_CHAIN_ID,
    sourceBlock: {
      number: sourceBlock.number,
      hash: sourceBlock.hash,
      timestamp: sourceBlock.timestamp,
      observedAt,
    },
    inputAsset,
    outputAsset,
    amountInAtomic: amountIn.toString(),
    amountOutAtomic: amountOut.toString(),
    route: {
      protocol: ARBITRUM_ONE_RUNTIME_PROFILE.protocolId,
      kind: "direct",
      poolAddress: route.poolAddress,
      tokenPath: [deployments.wrappedNativeAddress, deployments.usdcAddress],
    },
    quoteSource: {
      kind: "quoter",
      protocol: ARBITRUM_ONE_RUNTIME_PROFILE.protocolId,
      address: deployments.quoterAddress,
    },
  };

  return {
    estimatedAmountOut: convertAtomicAmountToHuman(
      amountOut.toString(),
      outputAsset.decimals,
    ),
    source: "quote",
    blockNumber: sourceBlock.number,
    fetchedAt: observedAt,
    runtimeVersion: ARBITRUM_ONE_PROFILE_ID,
    runtimeRevision: "native-rpc",
    provenance,
  };
}

async function readBlock(
  rpc: {
    request(
      method: "eth_getBlockByNumber",
      params?: readonly unknown[],
      options?: ChainOperationOptions,
    ): Promise<unknown>;
  },
  blockTag: string,
  expectedNumber: bigint,
): Promise<{ number: string; hash: string; timestamp: string }> {
  const value = await rpc.request("eth_getBlockByNumber", [blockTag, false], {
    timeoutMs: defaultRpcTimeoutMs,
  });
  if (!isRecord(value)) throw new Error("Pinned source block is unavailable");
  const block = value as RpcBlock;
  const number = parseRpcQuantity(block.number);
  const hash = block.hash;
  if (
    number !== expectedNumber ||
    typeof hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(hash)
  ) {
    throw new Error("Pinned source block identity is incomplete");
  }
  return {
    number: number.toString(),
    hash,
    timestamp: parseRpcQuantity(block.timestamp).toString(),
  };
}

async function requireContractCode(
  rpc: {
    request(
      method: "eth_getCode",
      params?: readonly unknown[],
      options?: ChainOperationOptions,
    ): Promise<unknown>;
  },
  address: string,
  blockTag: string,
): Promise<void> {
  const code = await rpc.request("eth_getCode", [address, blockTag], {
    timeoutMs: defaultRpcTimeoutMs,
  });
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) {
    throw new Error("Verified route contract code is missing or malformed");
  }
}

async function verifyTokenMetadata(
  rpc: {
    request(
      method: "eth_call",
      params?: readonly unknown[],
      options?: ChainOperationOptions,
    ): Promise<unknown>;
  },
  address: string,
  expectedSymbol: string,
  expectedDecimals: number,
  blockTag: string,
): Promise<void> {
  const [symbolRaw, decimalsRaw] = await Promise.all([
    rpc.request(
      "eth_call",
      [{ to: address, data: `0x${SYMBOL_SELECTOR}` }, blockTag],
      { timeoutMs: defaultRpcTimeoutMs },
    ),
    rpc.request(
      "eth_call",
      [{ to: address, data: `0x${DECIMALS_SELECTOR}` }, blockTag],
      { timeoutMs: defaultRpcTimeoutMs },
    ),
  ]);
  if (
    decodeAbiString(symbolRaw) !== expectedSymbol ||
    decodeUintWord(decimalsRaw) !== BigInt(expectedDecimals)
  ) {
    throw new Error(
      "Onchain token metadata does not match the trusted registry",
    );
  }
}

async function verifyDirectPool(
  rpc: {
    request(
      method: "eth_call",
      params?: readonly unknown[],
      options?: ChainOperationOptions,
    ): Promise<unknown>;
  },
  poolAddress: string,
  blockTag: string,
): Promise<void> {
  const [token0Raw, token1Raw, liquidityRaw] = await Promise.all([
    rpc.request(
      "eth_call",
      [{ to: poolAddress, data: `0x${TOKEN0_SELECTOR}` }, blockTag],
      { timeoutMs: defaultRpcTimeoutMs },
    ),
    rpc.request(
      "eth_call",
      [{ to: poolAddress, data: `0x${TOKEN1_SELECTOR}` }, blockTag],
      { timeoutMs: defaultRpcTimeoutMs },
    ),
    rpc.request(
      "eth_call",
      [{ to: poolAddress, data: `0x${LIQUIDITY_SELECTOR}` }, blockTag],
      { timeoutMs: defaultRpcTimeoutMs },
    ),
  ]);
  const { deployments } = ARBITRUM_ONE_RUNTIME_PROFILE;
  if (
    decodeAddressWord(token0Raw).toLowerCase() !==
      deployments.wrappedNativeAddress.toLowerCase() ||
    decodeAddressWord(token1Raw).toLowerCase() !==
      deployments.usdcAddress.toLowerCase() ||
    decodeUintWord(liquidityRaw) === 0n
  ) {
    throw new Error(
      "Camelot pool metadata does not match the verified direct route",
    );
  }
}

function encodeQuoteCall(
  tokenInAddress: string,
  tokenOutAddress: string,
  amountIn: bigint,
): string {
  if (
    !ADDRESS_PATTERN.test(tokenInAddress) ||
    !ADDRESS_PATTERN.test(tokenOutAddress)
  ) {
    throw new Error("Quote route contains an invalid token address");
  }
  return `0x${QUOTE_EXACT_INPUT_SINGLE_SELECTOR}${encodeAddressWord(tokenInAddress)}${encodeAddressWord(tokenOutAddress)}${encodeUintWord(amountIn)}${encodeUintWord(0n)}`;
}

function decodeQuoteAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{128}$/.test(value)) {
    throw new Error("Camelot Quoter ABI result must contain exactly two words");
  }
  const amountOut = BigInt(`0x${value.slice(2, 66)}`);
  // Validate both ABI words without assigning undocumented semantics to the
  // second word; the captured route evidence establishes a two-word response.
  void BigInt(`0x${value.slice(66)}`);
  if (amountOut === 0n) throw new Error("Camelot Quoter returned zero output");
  return amountOut;
}

/** Checks that an Arbitrum One Quote is bound to its exact request and profile. */
export function isValidArbitrumOneQuoteProvenance(input: {
  readonly quote: Quote;
  readonly intent: NormalizedSwapIntent;
  readonly tokenMetadata: TokenMetadataPair;
}): boolean {
  const { quote, intent, tokenMetadata } = input;
  const provenance = quote.provenance;
  if (
    provenance === undefined ||
    !supportsVerifiedRoute(intent) ||
    provenance.version !== 1 ||
    provenance.profileId !== ARBITRUM_ONE_PROFILE_ID ||
    provenance.sourceChainId !== ARBITRUM_ONE_CHAIN_ID ||
    quote.runtimeVersion !== ARBITRUM_ONE_PROFILE_ID ||
    quote.runtimeRevision !== "native-rpc" ||
    quote.blockNumber !== provenance.sourceBlock.number ||
    quote.fetchedAt !== provenance.sourceBlock.observedAt ||
    quote.source !== "quote" ||
    provenance.amountInAtomic !== intent.amountInAtomic ||
    !sameTrustedMetadata(provenance.inputAsset, tokenMetadata.tokenIn) ||
    !sameTrustedMetadata(provenance.outputAsset, tokenMetadata.tokenOut) ||
    provenance.route.protocol !== ARBITRUM_ONE_RUNTIME_PROFILE.protocolId ||
    provenance.route.kind !== "direct" ||
    provenance.route.poolAddress.toLowerCase() !==
      ARBITRUM_ONE_RUNTIME_PROFILE.route.poolAddress.toLowerCase() ||
    provenance.route.tokenPath[0].toLowerCase() !==
      ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress.toLowerCase() ||
    provenance.route.tokenPath[1].toLowerCase() !==
      ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress.toLowerCase() ||
    provenance.quoteSource.kind !== "quoter" ||
    provenance.quoteSource.protocol !==
      ARBITRUM_ONE_RUNTIME_PROFILE.protocolId ||
    provenance.quoteSource.address.toLowerCase() !==
      ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress.toLowerCase()
  ) {
    return false;
  }

  return (
    convertAtomicAmountToHuman(
      provenance.amountOutAtomic,
      tokenMetadata.tokenOut.decimals,
    ) === quote.estimatedAmountOut
  );
}

function sameTrustedMetadata(
  left: TrustedTokenMetadata,
  right: TrustedTokenMetadata,
): boolean {
  let sameAsset = false;
  if (left.asset.kind === "native") {
    sameAsset = right.asset.kind === "native";
  } else {
    sameAsset =
      right.asset.kind === "erc20" &&
      left.asset.address.toLowerCase() === right.asset.address.toLowerCase();
  }
  const sameVerificationBlock =
    left.decimalsSource === "chain_config"
      ? right.decimalsSource === "chain_config"
      : right.decimalsSource === "onchain_verified" &&
        left.verifiedAtBlock === right.verifiedAtBlock;
  return (
    sameAsset &&
    left.chainId === right.chainId &&
    left.symbol === right.symbol &&
    left.decimals === right.decimals &&
    left.decimalsSource === right.decimalsSource &&
    sameVerificationBlock
  );
}

function decodeUintWord(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("RPC result is not a single ABI uint256 word");
  }
  return BigInt(value);
}

function decodeAddressWord(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value) ||
    !/^0{24}$/i.test(value.slice(2, 26))
  ) {
    throw new Error("RPC result is not a single ABI address word");
  }
  return `0x${value.slice(-40)}`;
}

function decodeAbiString(value: unknown): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{64}){3,}$/.test(value)) {
    throw new Error("ERC-20 symbol result is not ABI-encoded");
  }
  const body = value.slice(2);
  const offset = BigInt(`0x${body.slice(0, 64)}`);
  if (offset !== 32n) throw new Error("ERC-20 symbol ABI offset is invalid");
  const length = BigInt(`0x${body.slice(64, 128)}`);
  if (length === 0n || length > 256n) {
    throw new Error("ERC-20 symbol length is invalid");
  }
  const byteLength = Number(length);
  const contentStart = 128;
  const contentEnd = contentStart + byteLength * 2;
  const paddedEnd = contentStart + Math.ceil(byteLength / 32) * 64;
  if (
    body.length !== paddedEnd ||
    !/^0*$/.test(body.slice(contentEnd, paddedEnd))
  ) {
    throw new Error("ERC-20 symbol ABI padding is invalid");
  }
  const bytes = Uint8Array.from(
    body.slice(contentStart, contentEnd).match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function encodeAddressWord(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeUintWord(value: bigint): string {
  if (value < 0n || value >= 1n << 256n) {
    throw new Error("Quote ABI integer is outside uint256 range");
  }
  return value.toString(16).padStart(64, "0");
}

function parseAtomicAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error("Quote input atomic amount is malformed");
  }
  const amount = BigInt(value);
  if (amount === 0n || amount >= 1n << 256n) {
    throw new Error("Quote input atomic amount is outside the valid range");
  }
  return amount;
}

function parseDecimalBlockNumber(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Pinned source block number is malformed");
  }
  return BigInt(value);
}

function parseRpcQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !RPC_QUANTITY_PATTERN.test(value)) {
    throw new Error("RPC returned a malformed quantity");
  }
  return BigInt(value);
}

function toRpcQuantity(value: bigint): string {
  if (value < 0n) throw new Error("RPC quantity cannot be negative");
  return `0x${value.toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
