import { serializeJson } from "@parallax/contracts";
import type { Hono } from "hono";

export type ApiMethodFallback = {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly message: string;
};

export type ApiFallbackOptions = {
  readonly methodNotAllowed: readonly ApiMethodFallback[];
  readonly internalErrorMessage: string;
  readonly cacheControl?: "no-store";
};

/** Registers shared 405, 404, and sanitized 500 transport responses. */
export function registerApiFallbacks(
  app: Hono,
  options: ApiFallbackOptions,
): void {
  for (const fallback of options.methodNotAllowed) {
    app.all(fallback.path, () =>
      errorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        fallback.message,
        fallback.method,
        options.cacheControl,
      ),
    );
  }

  app.notFound(() =>
    errorResponse(
      404,
      "NOT_FOUND",
      "Route not found",
      undefined,
      options.cacheControl,
    ),
  );

  app.onError(() =>
    errorResponse(
      500,
      "INTERNAL_ERROR",
      options.internalErrorMessage,
      undefined,
      options.cacheControl,
    ),
  );
}

function errorResponse(
  status: 404 | 405 | 500,
  code: "METHOD_NOT_ALLOWED" | "NOT_FOUND" | "INTERNAL_ERROR",
  message: string,
  allowedMethod?: string,
  cacheControl?: "no-store",
): Response {
  return new Response(serializeJson({ error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(cacheControl === undefined ? {} : { "cache-control": cacheControl }),
      ...(allowedMethod === undefined ? {} : { allow: allowedMethod }),
    },
  });
}
