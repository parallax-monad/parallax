import {
  type CheckSwapRequest,
  checkSwapRequestSchema,
  type QuoteRequest,
  type QuoteResult,
  quoteRequestSchema,
  quoteResultSchema,
  type RunResult,
  runIdSchema,
  runResultSchema,
} from "@parallax/contracts";
import { apiErrorCode, ParallaxApiError } from "./errors.js";
import {
  type CheckRunEnvelope,
  checkRunEnvelopeSchema,
} from "./run-envelope.js";

/** Injectable fetch, so Node, browsers, and tests can share one client. */
export type ParallaxFetch = typeof fetch;

export interface ParallaxClientOptions {
  /**
   * API origin. An empty string is valid for a same-origin browser client.
   * A trailing slash is ignored.
   */
  baseUrl: string;
  /** Defaults to the platform `fetch`; never a Provider or RPC transport. */
  fetch?: ParallaxFetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

/**
 * `POST /api/account-state` accepts the public exact-input quote fields plus an
 * optional recipient. It has no Economic Boundary, Expectation Baseline, or
 * `parentRunId`, and the Backend owns the canonical request schema.
 */
export type AccountStateRequest = Pick<
  QuoteRequest,
  "chainId" | "protocol" | "sender" | "tokenIn" | "tokenOut" | "amountIn"
> & { recipient?: string };

/**
 * A Re-check is a Check whose `parentRunId` is set. The SDK deliberately does
 * not model the "exactly one changed Intent field" rule: that is Backend
 * business logic, and the Backend decides `INVALID_RERUN` reasons.
 */
export type RecheckRequest = Omit<CheckSwapRequest, "parentRunId">;

/**
 * Thin typed HTTP client for the public Parallax API.
 *
 * The Backend remains the source of truth. This client performs transport and
 * canonical Contract validation only: it holds no Risk rules, no Provider
 * access, no QuickNode/Explorer calls, no signing, no broadcasting, and no
 * custody.
 */
export class ParallaxClient {
  private readonly baseUrl: string;
  private readonly transport: ParallaxFetch;
  private readonly headers: Record<string, string>;

  public constructor(options: ParallaxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.transport = options.fetch ?? fetch;
    this.headers = { ...options.headers };
  }

  /**
   * Pre-check, exact-input Quote. A `status: "unavailable"` result is a real
   * product state returned by the Backend, not a transport error.
   */
  public async quote(request: QuoteRequest): Promise<QuoteResult> {
    const parsedRequest = quoteRequestSchema.parse(request);
    return quoteResultSchema.parse(
      await this.postJson("/api/quote", parsedRequest),
    );
  }

  /** Starts a Check Run. Transport and Contract validation only. */
  public async check(request: CheckSwapRequest): Promise<RunResult> {
    const parsedRequest = checkSwapRequestSchema.parse(request);
    return runResultSchema.parse(
      await this.postJson("/api/check", parsedRequest),
    );
  }

  /**
   * Reads one persisted Check Run envelope. A `started` Run has no `result` yet.
   */
  public async getRun(runId: string): Promise<CheckRunEnvelope> {
    const parsedRunId = runIdSchema.parse(runId);
    return checkRunEnvelopeSchema.parse(
      await this.requestJson(`/api/runs/${encodeURIComponent(parsedRunId)}`, {
        method: "GET",
      }),
    );
  }

  /**
   * Re-checks an existing baseline Run.
   *
   * This uses the same `POST /api/check` endpoint and only sets `parentRunId`.
   * The caller must change exactly one Backend-supported Intent field; the
   * Backend rejects anything else with its own `INVALID_RERUN` reason.
   */
  public async recheck(
    parentRunId: string,
    request: RecheckRequest,
  ): Promise<RunResult> {
    return this.check({
      ...request,
      parentRunId: runIdSchema.parse(parentRunId),
    });
  }

  /**
   * Reads Backend account state for one exact-input intent.
   *
   * The canonical account-state schema currently lives in the API
   * (`apps/api/src/account-state-model.ts`) and is intentionally not promoted to
   * `@parallax/contracts`, so the response is opaque here: pass the snapshot
   * type your own consumer owns, or validate it yourself. The SDK will not
   * restate or narrow Backend account-state semantics.
   */
  public async getAccountState<TSnapshot = unknown>(
    request: AccountStateRequest,
  ): Promise<TSnapshot> {
    return (await this.postJson("/api/account-state", request)) as TSnapshot;
  }

  private postJson(path: string, payload: unknown): Promise<unknown> {
    return this.requestJson(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.transport(`${this.baseUrl}${path}`, {
      ...init,
      headers: { accept: "application/json", ...this.headers, ...init.headers },
    });
    const parsed = await readJsonBody(response);
    if (!response.ok) {
      throw new ParallaxApiError(
        `Parallax API ${path} responded with HTTP ${response.status}`,
        {
          status: response.status,
          body: parsed.ok ? parsed.value : undefined,
          code: parsed.ok ? apiErrorCode(parsed.value) : undefined,
        },
      );
    }
    if (!parsed.ok) {
      throw new ParallaxApiError(
        `Parallax API ${path} returned a body that is not valid JSON`,
        { status: response.status, body: undefined },
      );
    }
    return parsed.value;
  }
}

type JsonBody = { ok: true; value: unknown } | { ok: false };

async function readJsonBody(response: Response): Promise<JsonBody> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false };
  }
  if (text.trim() === "") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
