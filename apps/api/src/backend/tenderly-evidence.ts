import {
  convertAtomicAmountToHuman,
  type GenericEvidence,
  type GenericEvidenceMode,
  type GenericProviderStatus,
  type GenericSwapIntent,
  genericEvidenceSchema,
  type NormalizedSwapIntent,
} from "@parallax/contracts";
import type { ProviderEvaluationResult } from "./provider-adapter.js";
import type { ProvisionalJsonValue } from "./provider-result-boundary.js";
import type { TenderlyPreparedExecution } from "./tenderly-provider.js";

export type TenderlyGenericEvidenceInput = {
  readonly intent: NormalizedSwapIntent | GenericSwapIntent;
  readonly tokenInDecimals: number;
  readonly tokenOutDecimals: number;
  readonly preparedExecution: TenderlyPreparedExecution;
  readonly providerResult: ProviderEvaluationResult;
  readonly mode?: GenericEvidenceMode;
};

/**
 * Maps Tenderly's redacted, allow-listed result into the provider-neutral
 * Evidence contract. The mapper deliberately does not recreate asset changes
 * from availability flags; those scopes stay UNKNOWN until a reviewed
 * provider payload mapping exists.
 */
export function mapTenderlyProviderResult(
  input: TenderlyGenericEvidenceInput,
): GenericEvidence {
  const mode = input.mode ?? "LIVE";
  const candidate = new Map(
    input.providerResult.candidateFields.map((field) => [
      field.candidatePath,
      field,
    ]),
  );
  const blockNumber = input.preparedExecution.blockContext.blockNumber;
  const fetchedAt = input.providerResult.provider.observedAt;
  const executionField = candidate.get("tenderly.execution.status");
  const reverted =
    input.providerResult.status === "failed" &&
    executionField?.status === "observed" &&
    executionField.value === false;
  const genericStatus = genericProviderStatus(
    input.providerResult.status,
    reverted,
  );
  const integrationStatus =
    genericStatus === "FAILED"
      ? "INTEGRATION_ERROR"
      : input.providerResult.status === "timeout"
        ? "TIMEOUT"
        : "OK";
  const failure =
    genericStatus === "FAILED"
      ? {
          code:
            input.providerResult.status === "timeout"
              ? "TIMEOUT"
              : "INTEGRATION_ERROR",
          message: "Tenderly could not produce a verified provider result",
          integrationStatus,
          source: "unknown" as const,
          normalization: "DERIVED" as const,
          retryable: input.providerResult.status === "timeout",
        }
      : undefined;
  const intent = toGenericIntent(
    input.intent,
    input.tokenInDecimals,
    input.tokenOutDecimals,
  );
  const quote = quoteField(
    input.preparedExecution.quote,
    blockNumber,
    fetchedAt,
  );
  const actionValue = jsonValueOrNull(
    input.preparedExecution.unsignedTransaction.payload,
  );
  const observed = (path: string): boolean =>
    candidate.get(path)?.status === "observed";
  const assetChangesAvailable = observed("tenderly.assetChanges.available");
  const balanceChangesAvailable = observed("tenderly.balanceChanges.available");
  const checkedScope = [
    ...(observed("tenderly.execution.status") ? ["tenderly.execution"] : []),
    ...(observed("tenderly.gas.used") ? ["tenderly.gas"] : []),
    ...(observed("tenderly.block.number") && observed("tenderly.block.hash")
      ? ["tenderly.pinned-block"]
      : []),
    ...(assetChangesAvailable ? ["tenderly.asset-changes-available"] : []),
    ...(balanceChangesAvailable ? ["tenderly.balance-changes-available"] : []),
  ];
  const unknownScope = [
    ...(quote.value === null ? ["quote"] : []),
    ...(actionValue === null ? ["action"] : []),
    "receipt",
    "outcome",
    "assetChanges",
    "simulation",
  ];
  const notChecked = [
    "receipt",
    "outcome",
    "state-diff",
    "logs",
    "traces",
    ...(assetChangesAvailable ? [] : ["assetChanges"]),
    ...(balanceChangesAvailable ? [] : ["balanceChanges"]),
  ];
  const providerData = {
    tenderly: {
      status: input.providerResult.status,
      checked: checkedScope,
      notChecked,
      unknown: unknownScope,
      assetChangesAvailable,
      balanceChangesAvailable,
    },
  };
  return genericEvidenceSchema.parse({
    intent,
    provider: {
      providerId: input.providerResult.provider.providerId,
      status: genericStatus,
      integrationStatus,
      ...(failure === undefined ? {} : { failure }),
      errors: jsonField(
        failure === undefined ? [] : [failure],
        "external",
        blockNumber,
        fetchedAt,
      ),
    },
    execution: {
      status: reverted
        ? "REVERTED"
        : input.providerResult.status === "success"
          ? "SUCCESS"
          : "UNKNOWN",
    },
    quote,
    action: arrayField(
      actionValue === null ? null : [actionValue],
      "external",
      blockNumber,
      fetchedAt,
    ),
    receipt: jsonField(null, "external", blockNumber, fetchedAt),
    outcome: jsonField(null, "external", blockNumber, fetchedAt),
    assetChanges: arrayField(null, "external", blockNumber, fetchedAt),
    assetChangeAssessment: "UNKNOWN",
    warnings: arrayField([], "external", blockNumber, fetchedAt),
    simulation: {
      value: {
        expectedTransactions: 1,
        observedResults: 0,
        unmatchedResultIndexes: [],
        halted: input.providerResult.status !== "success" && !reverted,
        complete: false,
        missingTransactionIndexes: [0],
        ...(input.providerResult.status === "success" || reverted
          ? {}
          : {
              haltReason: `Tenderly result was ${input.providerResult.status}`,
            }),
      },
      source: "derived",
      reproducibility: mode === "MOCK" ? "NOT_REPRODUCIBLE" : "REPRODUCIBLE",
      blockNumber,
      fetchedAt,
      limitation:
        "Tenderly asset and balance payloads remain behind the reviewed provider mapping boundary",
    },
    blockNumber: stringField(blockNumber, "external", blockNumber, fetchedAt),
    capabilities: input.providerResult.capabilities ?? [],
    provenance: {
      observedChainId: input.intent.chainId,
      fetchedAt,
      mode,
      source: "external",
      simulationBlock: blockNumber,
    },
    checkedScope,
    unknownScope,
    providerData,
  });
}

function genericProviderStatus(
  status: ProviderEvaluationResult["status"],
  reverted: boolean,
): GenericProviderStatus {
  if (reverted) return "SUCCESS";
  switch (status) {
    case "success":
      return "SUCCESS";
    case "unknown":
    case "invalid":
      return "UNKNOWN";
    case "unsupported":
      return "UNSUPPORTED";
    case "stale":
      return "STALE";
    case "timeout":
    case "failed":
      return "FAILED";
  }
}

function toGenericIntent(
  intent: NormalizedSwapIntent | GenericSwapIntent,
  tokenInDecimals: number,
  tokenOutDecimals: number,
): GenericSwapIntent {
  if (!("economicBoundary" in intent)) return { ...intent };
  const boundary = intent.economicBoundary;
  return {
    chainId: intent.chainId,
    protocol: intent.protocol,
    sender: intent.sender,
    tokenIn:
      intent.tokenIn.kind === "native" ? "native" : intent.tokenIn.address,
    tokenOut:
      intent.tokenOut.kind === "native" ? "native" : intent.tokenOut.address,
    amountIn: convertAtomicAmountToHuman(
      intent.amountInAtomic,
      tokenInDecimals,
    ),
    ...(boundary.availability === "available"
      ? {
          minimumReceived: convertAtomicAmountToHuman(
            boundary.minimumReceivedAtomic,
            tokenOutDecimals,
          ),
          minimumReceivedSource: boundary.source,
        }
      : { minimumReceivedSource: "unavailable" }),
  };
}

function quoteField(quote: unknown, blockNumber: string, fetchedAt: string) {
  if (!isRecord(quote))
    return jsonField(null, "external", blockNumber, fetchedAt);
  const estimatedAmountOut = quote.estimatedAmountOut;
  const minimumAmountOut = quote.minimumAmountOut;
  if (
    typeof estimatedAmountOut !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(estimatedAmountOut) ||
    (minimumAmountOut !== undefined &&
      (typeof minimumAmountOut !== "string" ||
        !/^\d+(?:\.\d+)?$/.test(minimumAmountOut)))
  ) {
    return jsonField(null, "external", blockNumber, fetchedAt);
  }
  return {
    value: {
      estimatedAmountOut,
      ...(minimumAmountOut === undefined ? {} : { minimumAmountOut }),
    },
    source: "quote" as const,
    reproducibility: "REPRODUCIBLE" as const,
    blockNumber,
    fetchedAt,
  };
}

function jsonField(
  value: ProvisionalJsonValue | null,
  source: "external",
  blockNumber: string,
  fetchedAt: string,
) {
  return {
    value,
    source,
    reproducibility: "REPRODUCIBLE" as const,
    blockNumber,
    fetchedAt,
  };
}

function arrayField(
  value: readonly ProvisionalJsonValue[] | null,
  source: "external",
  blockNumber: string,
  fetchedAt: string,
) {
  return jsonField(
    value === null ? null : [...value],
    source,
    blockNumber,
    fetchedAt,
  );
}

function stringField(
  value: string,
  source: "external",
  blockNumber: string,
  fetchedAt: string,
) {
  return jsonField(value, source, blockNumber, fetchedAt);
}

function jsonValueOrNull(value: unknown): ProvisionalJsonValue | null {
  return toJsonValue(value) ?? null;
}

function toJsonValue(value: unknown): ProvisionalJsonValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const values = value.map(toJsonValue);
    return values.some((entry) => entry === undefined)
      ? undefined
      : (values as ProvisionalJsonValue[]);
  }
  if (!isRecord(value)) return undefined;
  const result: Record<string, ProvisionalJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = toJsonValue(entry);
    if (normalized === undefined) return undefined;
    result[key] = normalized;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
