import {
  type AmountConversionErrorCode,
  type CheckSwapRequest,
  convertHumanAmountToAtomic,
  type IntentNormalizationError,
  type IntentNormalizationErrorCode,
  type IntentNormalizationResult,
  intentNormalizationErrorSchema,
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
  type TrustedTokenRegistry,
} from "@parallax/contracts";

/**
 * Establishes the authoritative API-to-domain boundary by resolving trusted
 * token metadata and converting every business amount to atomic units.
 */
export function normalizeCheckSwapRequest(
  request: CheckSwapRequest,
  registry: TrustedTokenRegistry,
): IntentNormalizationResult {
  if (!registry.hasChain(request.chainId)) {
    return failure(
      "UNSUPPORTED_CHAIN",
      "chainId",
      `Chain ${request.chainId} is not supported`,
    );
  }

  const tokenIn = registry.resolve(request.chainId, request.tokenIn);
  if (!tokenIn) {
    return failure(
      "UNSUPPORTED_TOKEN",
      "tokenIn",
      "Input token is not in the trusted token registry",
    );
  }

  const tokenOut = registry.resolve(request.chainId, request.tokenOut);
  if (!tokenOut) {
    return failure(
      "UNSUPPORTED_TOKEN",
      "tokenOut",
      "Output token is not in the trusted token registry",
    );
  }

  const amountIn = convertHumanAmountToAtomic(
    request.amountIn,
    tokenIn.decimals,
  );
  if (!amountIn.success) {
    return conversionFailure("amountIn", amountIn.error);
  }

  let economicBoundary: NormalizedSwapIntent["economicBoundary"];
  if (request.economicBoundary.availability === "unavailable") {
    economicBoundary = request.economicBoundary;
  } else {
    // Minimum Received is denominated in tokenOut, not tokenIn.
    const minimumReceived = convertHumanAmountToAtomic(
      request.economicBoundary.minimumReceived,
      tokenOut.decimals,
    );
    if (!minimumReceived.success) {
      return conversionFailure(
        "economicBoundary.minimumReceived",
        minimumReceived.error,
      );
    }

    economicBoundary = {
      availability: "available",
      minimumReceivedAtomic: minimumReceived.amountAtomic,
      source: request.economicBoundary.source,
    };
  }

  return {
    success: true,
    intent: normalizedSwapIntentSchema.parse({
      chainId: request.chainId,
      protocol: request.protocol,
      sender: request.sender,
      recipient: request.recipient ?? request.sender,
      recipientSource:
        request.recipient === undefined ? "defaulted_from_sender" : "explicit",
      tokenIn: tokenIn.asset,
      tokenOut: tokenOut.asset,
      amountInAtomic: amountIn.amountAtomic,
      economicBoundary,
    }),
  };
}

function conversionFailure(
  field: "amountIn" | "economicBoundary.minimumReceived",
  error: { code: AmountConversionErrorCode; message: string },
): IntentNormalizationResult {
  return failure(error.code, field, error.message);
}

function failure(
  code: IntentNormalizationErrorCode,
  field: IntentNormalizationError["field"],
  message: string,
): IntentNormalizationResult {
  return {
    success: false,
    error: intentNormalizationErrorSchema.parse({ code, field, message }),
  };
}
