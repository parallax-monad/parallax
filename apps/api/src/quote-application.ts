import { randomUUID } from "node:crypto";
import {
  type QuoteResult,
  quoteRequestSchema,
  quoteResultSchema,
} from "@parallax/contracts";
import { normalizeQuoteRequest } from "./normalization.js";
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

    const normalized = normalizeQuoteRequest(
      parsedRequest.data,
      this.dependencies.runtime.tokenRegistry,
    );
    if (!normalized.success) {
      return errorResponse(400, {
        code: "NORMALIZATION_FAILED",
        message: "The quote request could not be normalized",
        issues: normalized.error,
      });
    }

    let candidate: unknown;
    try {
      candidate = await this.dependencies.quoteFlow.quote({
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
        code: isUnsupportedAgentFlowError(error)
          ? "UNSUPPORTED"
          : "QUOTE_ERROR",
        message: isUnsupportedAgentFlowError(error)
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
