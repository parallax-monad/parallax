import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
  type NormalizedSwapIntent,
} from "@parallax/contracts";
import type {
  QualifiedAllowanceSpender,
  QualifiedAllowanceSpenderResolver,
} from "./arbitrum-account-state-reader.js";
import { CAMELOT_V3_ROUTER_ADDRESS } from "./camelot-v3-binding.js";
import {
  CAMELOT_SEPOLIA_USDC,
  CAMELOT_SEPOLIA_WETH,
} from "./camelot-v3-protocol-adapter.js";

/** Immutable #103 observation of the actual spender used by the qualified call. */
export const CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF =
  "be-103:usdc-weth-camelot-2026-09-29T10-09-52-993Z#evaluation.callTrace.actualSpender";

/**
 * Exposes only the spender established by #103's real USDC -> WETH transaction.
 * Every other chain, protocol, or token pair remains explicitly unqualified.
 */
export function createCamelotV3QualifiedAllowanceSpenderResolver(): QualifiedAllowanceSpenderResolver {
  return ({ intent }) => resolveQualifiedSpender(intent);
}

function resolveQualifiedSpender(
  intent: NormalizedSwapIntent,
): QualifiedAllowanceSpender | undefined {
  if (
    intent.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID ||
    intent.protocol !== CAMELOT_V3_PROTOCOL_ID ||
    intent.tokenIn.kind !== "erc20" ||
    intent.tokenOut.kind !== "erc20" ||
    intent.tokenIn.address.toLowerCase() !==
      CAMELOT_SEPOLIA_USDC.toLowerCase() ||
    intent.tokenOut.address.toLowerCase() !== CAMELOT_SEPOLIA_WETH.toLowerCase()
  ) {
    return undefined;
  }

  return {
    address: CAMELOT_V3_ROUTER_ADDRESS,
    qualificationRef: CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF,
  };
}
