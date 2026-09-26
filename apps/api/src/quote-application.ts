import { randomUUID } from "node:crypto";
import {
  type QuoteResult,
  quoteRequestSchema,
  quoteResultSchema,
} from "@parallax/contracts";
import {
  type BackendApplicationRoute,
  findBackendApplicationRoute,
} from "./backend/application-routing.js";
import type { BackendCompositionRuntime } from "./backend/composition.js";
import { isBackendControlError } from "./backend/control-boundary.js";
import {
  coerceIntentNormalizationResult,
  normalizeQuoteRequest,
} from "./normalization.js";
import {
  isUnsupportedAgentFlowError,
  type QuoteAgentFlowPort,
} from "./ports.js";
import type { BackendRuntime } from "./runtime-config.js";
import { tokenDecimals } from "./token-decimals.js";

export type QuoteApiErrorCode =
  | "INVALID_REQUEST"
  | "NORMALIZATION_FAILED"
  | "UNSUPPORTED"
  | "QUOTE_ERROR";

export type QuoteApiError = {
  code: QuoteApiErrorCode;
  message: string;
  issues?: unknown;
};

export type QuoteApplicationResponse =
  | { status: 200; body: QuoteResult }
  | { status: 400 | 502; body: { error: QuoteApiError } };

export type QuoteApplicationServiceDependencies = {
  runtime: BackendRuntime;
  quoteFlow: QuoteAgentFlowPort;
  composition?: BackendCompositionRuntime;
  routes?: readonly BackendApplicationRoute[];
  createRunId?: () => string;
};

/** Backend-owned application boundary for POST /api/quote. */
export class QuoteApplicationService {
  private readonly createRunId: () => string;

  public constructor(
    private readonly dependencies: QuoteApplicationServiceDependencies,
  ) {
    this.createRunId = dependencies.createRunId ?? randomUUID;
  }

  public async quote(request: unknown): Promise<QuoteApplicationResponse> {
    const parsedRequest = quoteRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      return errorResponse(400, {
        code: "INVALID_REQUEST",
        message: "The quote request does not match the public API contract",
        issues: parsedRequest.error.issues,
      });
    }

    const route = findBackendApplicationRoute(
      this.dependencies.routes,
      parsedRequest.data.chainId,
    );
    const composition = route?.composition ?? this.dependencies.composition;
    const quoteFlow = route?.quoteFlow ?? this.dependencies.quoteFlow;

    let normalized: ReturnType<typeof normalizeQuoteRequest>;
    try {
      const candidate =
        composition === undefined
          ? normalizeQuoteRequest(
              parsedRequest.data,
              this.dependencies.runtime.tokenRegistry,
            )
          : await composition.normalize(parsedRequest.data);
      const normalizationResult = coerceIntentNormalizationResult(candidate);
      if (normalizationResult === undefined) {
        return errorResponse(400, {
          code: "NORMALIZATION_FAILED",
          message: "The quote request could not be normalized",
          issues: { code: "INVALID_NORMALIZATION_RESULT" },
        });
      }
      normalized = normalizationResult;
    } catch {
      return errorResponse(400, {
        code: "NORMALIZATION_FAILED",
        message: "The quote request could not be normalized",
        issues: { code: "NORMALIZATION_BOUNDARY_ERROR" },
      });
    }
    if (!normalized.success) {
      return errorResponse(400, {
        code: "NORMALIZATION_FAILED",
        message: "The quote request could not be normalized",
        issues: normalized.error,
      });
    }

    let candidate: unknown;
    try {
      candidate = await quoteFlow.quote({
        runId: this.createRunId(),
        intent: normalized.intent,
        tokenInDecimals: tokenDecimals(
          this.dependencies.runtime,
          normalized.intent.tokenIn,
          normalized.intent.chainId,
        ),
        tokenOutDecimals: tokenDecimals(
          this.dependencies.runtime,
          normalized.intent.tokenOut,
          normalized.intent.chainId,
        ),
        moss: this.dependencies.runtime.config.moss,
      });
    } catch (error) {
      return errorResponse(502, {
        code: isUnsupportedQuoteError(error) ? "UNSUPPORTED" : "QUOTE_ERROR",
        message: isUnsupportedQuoteError(error)
          ? "Live Quote is not available in this runtime"
          : "The quote could not be completed",
      });
    }

    const result = quoteResultSchema.safeParse(candidate);
    if (!result.success) {
      return errorResponse(502, {
        code: "QUOTE_ERROR",
        message: "The quote flow returned an invalid response",
      });
    }

    return { status: 200, body: result.data };
  }
}

function errorResponse(
  status: 400 | 502,
  error: QuoteApiError,
): QuoteApplicationResponse {
  return { status, body: { error } };
}

function isUnsupportedQuoteError(error: unknown): boolean {
  return (
    isUnsupportedAgentFlowError(error) ||
    (isBackendControlError(error) && error.status === "unsupported")
  );
}
