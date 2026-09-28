import {
  type P0BasicSimulation,
  p0BasicSimulationSchema,
} from "../../packages/contracts/src/p0-run-result.js";

export type GoldenPathAssertionInput = {
  readonly httpStatus: number;
  readonly runStatus: "completed" | "failed" | "started" | undefined;
  readonly persistedRunRoundTrip: boolean;
  /** Public `basicSimulation.call` must independently prove eth_call ran. */
  readonly basicSimulationCallVerified: boolean;
  /** The prepared transaction identity must match this canonical request. */
  readonly basicSimulationMatchesRequest: boolean;
  /** The execution facts returned first must survive the public Run read. */
  readonly basicSimulationRoundTrip: boolean;
  readonly baselineStatus: "AVAILABLE" | "MISSING" | undefined;
  readonly baselineIdentityMatches: boolean;
  readonly providerEvidenceReachedP0Risk: boolean;
  /** Provider execution must be a live, successful, scope-complete handoff. */
  readonly providerExecutionVerified: boolean;
  /** The selected quote is an expectation baseline, not an implicit constraint. */
  readonly selectedQuoteRemainsExpectationOnly: boolean;
  readonly publicSurfaceSafe: boolean;
  readonly evidenceState:
    | "VERIFIED"
    | "INCOMPLETE"
    | "UNAVAILABLE"
    | "STALE"
    | "UNVERIFIED"
    | undefined;
  readonly quoteFidelityStatus: "VERIFIED" | "UNKNOWN" | undefined;
  readonly quoteFidelityReason:
    | "MISSING_BASELINE"
    | "INCOMPATIBLE"
    | "INVALID_AMOUNT"
    | "EVIDENCE_NOT_VERIFIED"
    | undefined;
  readonly verdict: "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN" | undefined;
  readonly causeStatus: "NOT_VERIFIED" | undefined;
  readonly unknownScope: readonly string[];
  readonly remediationConfigured: boolean;
  readonly remediationStatus:
    | "NOT_RUN"
    | "UNVERIFIED"
    | "NO_VALID_CANDIDATE"
    | "UNKNOWN"
    | "VERIFIED"
    | undefined;
  readonly remediationHasChildRun: boolean;
};

export type BasicSimulationSummary = P0BasicSimulation;
export type BasicSimulationRequestBinding = Pick<
  NonNullable<P0BasicSimulation["transactionBinding"]>,
  | "chainId"
  | "protocol"
  | "sender"
  | "recipient"
  | "tokenIn"
  | "tokenOut"
  | "amountInAtomic"
>;

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Copies only provider-neutral P0 execution facts into durable live evidence.
 * Raw return bytes, calldata and unexpected payload fields are never copied.
 */
export function summarizeBasicSimulation(
  value: unknown,
): BasicSimulationSummary | undefined {
  if (value === undefined) return undefined;
  const simulation = asObject(value, "Public basicSimulation");
  const call = asObject(simulation.call, "basicSimulation.call");
  const gasEstimate = asObject(
    simulation.gasEstimate,
    "basicSimulation.gasEstimate",
  );
  const binding =
    simulation.transactionBinding === undefined
      ? undefined
      : asObject(
          simulation.transactionBinding,
          "basicSimulation.transactionBinding",
        );
  const bindingKeys = [
    "chainId",
    "protocol",
    "sender",
    "recipient",
    "tokenIn",
    "tokenOut",
    "amountInAtomic",
    "amountOutMinimumAtomic",
    "router",
    "from",
    "to",
    "value",
    "dataFingerprint",
  ] as const;
  const transactionBinding =
    binding === undefined
      ? undefined
      : Object.fromEntries(
          bindingKeys.flatMap((key) =>
            typeof binding[key] === "string" || typeof binding[key] === "number"
              ? [[key, binding[key]]]
              : [],
          ),
        );

  return p0BasicSimulationSchema.parse({
    call: {
      status: call.status,
      ...(typeof call.returnDataFingerprint === "string"
        ? { returnDataFingerprint: call.returnDataFingerprint }
        : {}),
    },
    gasEstimate: {
      status: gasEstimate.status,
      ...(typeof gasEstimate.gasUnits === "string"
        ? { gasUnits: gasEstimate.gasUnits }
        : {}),
    },
    blockNumber: simulation.blockNumber,
    ...(typeof simulation.blockHash === "string"
      ? { blockHash: simulation.blockHash }
      : {}),
    observedAt: simulation.observedAt,
    validityAtExecution: simulation.validityAtExecution,
    preparedTransactionFingerprint: simulation.preparedTransactionFingerprint,
    ...(transactionBinding === undefined ? {} : { transactionBinding }),
    ...(typeof simulation.failureStage === "string"
      ? { failureStage: simulation.failureStage }
      : {}),
    ...(typeof simulation.reason === "string"
      ? { reason: simulation.reason }
      : {}),
    uncheckedCapabilities: Array.isArray(simulation.uncheckedCapabilities)
      ? simulation.uncheckedCapabilities.filter(
          (capability): capability is string => typeof capability === "string",
        )
      : [],
  });
}

/** Require observed call output plus its block and prepared-transaction identity. */
export function isBasicSimulationCallVerified(value: unknown): boolean {
  const summary = summarizeBasicSimulation(value);
  if (summary === undefined) return false;
  const call = asObject(summary.call, "Summarized basicSimulation.call");
  return (
    call.status === "SUCCEEDED" &&
    typeof call.returnDataFingerprint === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(call.returnDataFingerprint) &&
    typeof summary.blockNumber === "string" &&
    /^\d+$/.test(summary.blockNumber) &&
    typeof summary.blockHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(summary.blockHash) &&
    typeof summary.preparedTransactionFingerprint === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(summary.preparedTransactionFingerprint)
  );
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** Confirm the recorded prepared transaction is for the accepted request. */
export function basicSimulationBindingMatchesRequest(
  value: unknown,
  expected: BasicSimulationRequestBinding,
): boolean {
  const summary = summarizeBasicSimulation(value);
  const binding = summary?.transactionBinding;
  if (binding === undefined) return false;

  let nativeValueMatches: boolean;
  try {
    const expectedNativeValue =
      expected.tokenIn.toLowerCase() === "native"
        ? expected.amountInAtomic
        : "0";
    nativeValueMatches = BigInt(binding.value) === BigInt(expectedNativeValue);
  } catch {
    nativeValueMatches = false;
  }

  return (
    binding.chainId === expected.chainId &&
    binding.protocol === expected.protocol &&
    sameAddress(binding.sender, expected.sender) &&
    sameAddress(binding.recipient, expected.recipient) &&
    binding.tokenIn.toLowerCase() === expected.tokenIn.toLowerCase() &&
    binding.tokenOut.toLowerCase() === expected.tokenOut.toLowerCase() &&
    binding.amountInAtomic === expected.amountInAtomic &&
    sameAddress(binding.from, expected.sender) &&
    sameAddress(binding.to, binding.router) &&
    nativeValueMatches
  );
}

export type GoldenPathAssertionResult = {
  readonly integrationExercise: "COMPLETE" | "INCOMPLETE";
  readonly gateStatus:
    | "EXERCISE_COMPLETE_REVIEW_REQUIRED"
    | "NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP";
  readonly expectedFailClosedUnknown: boolean;
  readonly remediation: {
    readonly configured: boolean;
    readonly status: GoldenPathAssertionInput["remediationStatus"];
    readonly childLifecycle:
      | "NOT_RUN"
      | "NOT_VERIFIED"
      | "VERIFIED"
      | "INVALID";
  };
};

/**
 * Separates the assembled-path exercise from the P0 decision outcome.
 *
 * A concrete Native RPC surface is intentionally partial. It can complete the
 * HTTP/pipeline path while Risk remains UNKNOWN because required Evidence is
 * missing or unsupported. That outcome is recorded as fail-closed; it is not
 * treated as an integration failure and it is not promoted to a P0 PASS.
 */
export function evaluateBackendGoldenPathAssertions(
  input: GoldenPathAssertionInput,
): GoldenPathAssertionResult {
  const integrationComplete =
    input.httpStatus === 200 &&
    input.runStatus === "completed" &&
    input.persistedRunRoundTrip &&
    input.basicSimulationCallVerified &&
    input.basicSimulationMatchesRequest &&
    input.basicSimulationRoundTrip &&
    input.baselineStatus === "AVAILABLE" &&
    input.baselineIdentityMatches &&
    input.providerEvidenceReachedP0Risk &&
    input.providerExecutionVerified &&
    input.selectedQuoteRemainsExpectationOnly &&
    input.publicSurfaceSafe;

  const expectedFailClosedUnknown =
    input.evidenceState !== undefined &&
    input.evidenceState !== "VERIFIED" &&
    input.unknownScope.length > 0 &&
    input.quoteFidelityStatus === "UNKNOWN" &&
    input.quoteFidelityReason === "EVIDENCE_NOT_VERIFIED" &&
    input.verdict === "UNKNOWN" &&
    input.causeStatus === "NOT_VERIFIED";

  const remediationChildLifecycle =
    input.remediationStatus === "VERIFIED"
      ? input.remediationHasChildRun
        ? "VERIFIED"
        : "INVALID"
      : input.remediationStatus === "NOT_RUN"
        ? "NOT_RUN"
        : "NOT_VERIFIED";

  return {
    integrationExercise: integrationComplete ? "COMPLETE" : "INCOMPLETE",
    gateStatus: integrationComplete
      ? "EXERCISE_COMPLETE_REVIEW_REQUIRED"
      : "NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP",
    expectedFailClosedUnknown,
    remediation: {
      configured: input.remediationConfigured,
      status: input.remediationStatus,
      childLifecycle: remediationChildLifecycle,
    },
  };
}
