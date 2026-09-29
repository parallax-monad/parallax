import type { NormalizedSwapIntent } from "@parallax/contracts";
import type {
  QualifiedAllowanceSpender,
  QualifiedAllowanceSpenderResolver,
} from "./arbitrum-account-state-reader.js";
import { CAMELOT_V3_ROUTER_ADDRESS } from "./camelot-v3-binding.js";
import {
  CAMELOT_SEPOLIA_USDC,
  CAMELOT_SEPOLIA_WETH,
} from "./camelot-v3-protocol-adapter.js";

const CAMELOT_V3_PROTOCOL_ID = "camelot-v3";
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

/**
 * Evidence identifier for the qualified Camelot V3 allowance spender.
 *
 * The #103 real USDC -> WETH qualification observed
 * `evaluation.callTrace.actualSpender` equal to `prepared.binding.router` and
 * recorded the exact prepared unsigned transaction against that router:
 * `fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-29T10-09-52-993Z/capture.json`.
 */
export const CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF =
  "be-103:usdc-weth-camelot-2026-09-29T10-09-52-993Z#evaluation.callTrace.actualSpender";

/**
 * Resolves the qualified allowance spender for the Camelot V3 reverse path.
 *
 * The spender is deliberately the same `CAMELOT_V3_ROUTER_ADDRESS` constant the
 * prepared-transaction binding validates against (`inspectCamelotV3Transaction`
 * rejects any transaction whose `to` differs). Allowance state and the prepared
 * transaction therefore cannot disagree about the approved spender: there is a
 * single address constant behind both.
 *
 * The qualification is deliberately narrow. The #103 evidence observed exactly
 * one pair on one chain, so only that pair inherits the reference. Any other
 * protocol, chain, pair, or native input returns `undefined`, which the
 * account-state reader reports as an explicit `SPENDER_NOT_QUALIFIED`
 * unavailability rather than an assumed approval.
 */
export function createCamelotV3QualifiedAllowanceSpenderResolver(): QualifiedAllowanceSpenderResolver {
  return ({ intent }: { readonly intent: NormalizedSwapIntent }) =>
    resolveCamelotV3QualifiedSpender(intent);
}

function resolveCamelotV3QualifiedSpender(
  intent: NormalizedSwapIntent,
): QualifiedAllowanceSpender | undefined {
  if (intent.protocol !== CAMELOT_V3_PROTOCOL_ID) return undefined;
  if (intent.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) return undefined;
  // Both legs must be the qualified ERC-20 pair; a native leg is reported as
  // NOT_APPLICABLE by the reader without this resolver.
  if (intent.tokenIn.kind !== "erc20" || intent.tokenOut.kind !== "erc20") {
    return undefined;
  }
  if (
    intent.tokenIn.address.toLowerCase() !== CAMELOT_SEPOLIA_USDC.toLowerCase()
  ) {
    return undefined;
  }
  if (
    intent.tokenOut.address.toLowerCase() !== CAMELOT_SEPOLIA_WETH.toLowerCase()
  ) {
    return undefined;
  }
  return {
    address: CAMELOT_V3_ROUTER_ADDRESS,
    qualificationRef: CAMELOT_V3_ALLOWANCE_SPENDER_QUALIFICATION_REF,
  };
}
