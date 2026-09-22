import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
} from "@parallax/contracts";
import {
  CamelotV3ProtocolAdapter,
  type CamelotV3ProtocolAdapterOptions,
} from "./camelot-v3-protocol-adapter.js";

export type CamelotV3TargetScenario = {
  readonly scenarioId: string;
  readonly classification: "CONTROLLED_FIXTURE";
  readonly real: false;
  readonly chainId: typeof ARBITRUM_SEPOLIA_CHAIN_ID;
  readonly protocolId: typeof CAMELOT_V3_PROTOCOL_ID;
  readonly pair: "unconfigured";
  readonly pool: "unconfigured";
  readonly evidence: "not-recorded";
  readonly execution: "replaceable-seam";
  readonly note: string;
};

/**
 * Machine-readable target records for BE-041. These are controlled planning
 * fixtures, not a claim that a real Camelot pair, pool, quote, or Evidence
 * response has been accepted.
 */
export const controlledCamelotV3TargetScenarios: readonly CamelotV3TargetScenario[] =
  Object.freeze([
    Object.freeze({
      scenarioId: "camelot-v3-arbitrum-sepolia-target",
      classification: "CONTROLLED_FIXTURE",
      real: false,
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocolId: CAMELOT_V3_PROTOCOL_ID,
      pair: "unconfigured",
      pool: "unconfigured",
      evidence: "not-recorded",
      execution: "replaceable-seam",
      note: "Controlled feasibility entry point only; real pair, pool, quote, and final Evidence schema remain separately unresolved.",
    }),
  ]);

export type CamelotV3FeasibilityEntryPoint = {
  readonly chainId: typeof ARBITRUM_SEPOLIA_CHAIN_ID;
  readonly protocolId: typeof CAMELOT_V3_PROTOCOL_ID;
  readonly scenarios: typeof controlledCamelotV3TargetScenarios;
  readonly protocolAdapter: CamelotV3ProtocolAdapter;
};

export function createCamelotV3FeasibilityEntryPoint(
  options: CamelotV3ProtocolAdapterOptions = {},
): CamelotV3FeasibilityEntryPoint {
  return {
    chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
    protocolId: CAMELOT_V3_PROTOCOL_ID,
    scenarios: controlledCamelotV3TargetScenarios,
    protocolAdapter: new CamelotV3ProtocolAdapter(options),
  };
}
