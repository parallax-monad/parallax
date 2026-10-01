/**
 * An HTTP/API response failure. This is transport information only; the SDK
 * does not interpret Backend codes as Risk, Cause, or Product decisions.
 */
export class ParallaxApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;
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

/** Read the Backend's machine-readable error code without assigning semantics. */
export function apiErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
