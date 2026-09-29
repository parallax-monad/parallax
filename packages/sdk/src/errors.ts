/**
 * A transport-level failure from the Parallax HTTP API.
 *
 * The SDK never interprets the payload as a Risk, Cause, or Product verdict. It
 * only exposes what the Backend actually returned so the caller can apply its own
 * product semantics. `code` is the Backend's machine-readable `error.code` when
 * the body carries one; it is a transport/application label, not a verdict.
 */
export class ParallaxApiError extends Error {
  /** HTTP status of the failed response, or of an unusable 2xx response. */
  public readonly status: number;
  /** Parsed JSON body when it was valid JSON, otherwise `undefined`. */
  public readonly body: unknown;
  /** Backend `error.code` when present, otherwise `undefined`. */
  public readonly code: string | undefined;

  public constructor(
    message: string,
    options: { status: number; body: unknown; code?: string | undefined },
  ) {
    super(message);
    this.name = "ParallaxApiError";
    this.status = options.status;
    this.body = options.body;
    this.code = options.code;
  }
}

/** Reads the Backend `error.code` without asserting any semantics on it. */
export function apiErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
