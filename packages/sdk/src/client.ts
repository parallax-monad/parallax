import {
  type AccountStateSnapshot,
  accountStateSnapshotIdSchema,
  accountStateSnapshotSchema,
  addressSchema,
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

export type ParallaxFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ParallaxClientOptions {
  /** Origin of the public Parallax API, for example http://127.0.0.1:8787. */
  baseUrl: string;
  /** Optional fetch injection for runtimes, tests, and transport customization. */
  fetch?: ParallaxFetch;
  /** Headers sent with each request, such as an API key if the deployment needs one. */
  headers?: HeadersInit;
}

/**
 * The account-state request shares its asset/amount boundary with Quote. The
 * optional recipient is validated with the canonical Contract address schema.
 */
export type AccountStateRequest = QuoteRequest & {
  recipient?: QuoteRequest["sender"];
};

/** Re-runs use the same Check endpoint; all eligibility rules stay Backend-owned. */
export type RecheckRequest = Omit<CheckSwapRequest, "parentRunId">;

/**
 * Thin typed transport for the public Parallax API.
 *
 * It reuses canonical Contracts for Quote and Check payloads and contains no
 * Provider/RPC integration or Risk, Cause, or Re-run business rules.
 */
export class ParallaxClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: ParallaxFetch;
  private readonly defaultHeaders: Headers;

  public constructor(options: ParallaxClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.defaultHeaders = new Headers(options.headers);

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new TypeError("A fetch implementation is required");
    }
    this.fetchImpl = fetchImpl;
  }

  /** POST /api/quote. */
  public async quote(request: QuoteRequest): Promise<QuoteResult> {
    const payload = quoteRequestSchema.parse(request);
    return quoteResultSchema.parse(await this.postJson("/api/quote", payload));
  }

  /** POST /api/check. The Backend remains the source of truth for the result. */
  public async check(request: CheckSwapRequest): Promise<RunResult> {
    const payload = checkSwapRequestSchema.parse(request);
    return runResultSchema.parse(await this.postJson("/api/check", payload));
  }

  /** GET /api/runs/:runId. */
  public async getRun(runId: string): Promise<CheckRunEnvelope> {
    const parsedRunId = runIdSchema.parse(runId);
    const body = await this.requestJson(
      `/api/runs/${encodeURIComponent(parsedRunId)}`,
      { method: "GET" },
    );
    return checkRunEnvelopeSchema.parse(body);
  }

  /**
   * Re-run via POST /api/check with parentRunId. The Backend decides whether the
   * parent and Intent change are eligible; the SDK does not duplicate those rules.
   */
  public async recheck(
    parentRunId: string,
    request: RecheckRequest,
  ): Promise<RunResult> {
    const payload = checkSwapRequestSchema.parse({
      ...request,
      parentRunId: runIdSchema.parse(parentRunId),
    });
    return runResultSchema.parse(await this.postJson("/api/check", payload));
  }

  /** POST /api/account-state. The response is checked against the shared Contract. */
  public async getAccountState(
    request: AccountStateRequest,
  ): Promise<AccountStateSnapshot> {
    const { recipient, ...quoteRequest } = request;
    const payload = quoteRequestSchema.parse(quoteRequest);
    const body =
      recipient === undefined
        ? payload
        : { ...payload, recipient: addressSchema.parse(recipient) };
    const response = await this.postJson("/api/account-state", body);
    return accountStateSnapshotSchema.parse(response);
  }

  /** GET /api/account-state/:snapshotId. */
  public async getAccountStateSnapshot(
    snapshotId: string,
  ): Promise<AccountStateSnapshot> {
    const parsedSnapshotId = accountStateSnapshotIdSchema.parse(snapshotId);
    const body = await this.requestJson(
      `/api/account-state/${encodeURIComponent(parsedSnapshotId)}`,
      { method: "GET" },
    );
    return accountStateSnapshotSchema.parse(body);
  }

  private async postJson(path: string, payload: unknown): Promise<unknown> {
    return this.requestJson(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(this.defaultHeaders);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
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

function normalizeBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("baseUrl must use HTTP or HTTPS");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("baseUrl must not contain embedded credentials");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new TypeError("baseUrl must not contain a query or fragment");
  }

  return parsed.toString().replace(/\/+$/, "");
}
