import { Hono } from "hono";
import type { CheckApplicationResponse } from "./application.js";
import { createJsonResponse, parseJsonRequestBody } from "./json-http.js";
import type { QuoteApplicationResponse } from "./quote-application.js";
import { registerApiFallbacks } from "./routes/api-fallbacks.js";

export interface CheckService {
  check(request: unknown): Promise<CheckApplicationResponse>;
}

type TransportErrorResponse = {
  status: 400 | 413;
  body: {
    error: {
      code: "INVALID_JSON" | "PAYLOAD_TOO_LARGE";
      message: string;
    };
  };
};

type TransportResponse =
  | CheckApplicationResponse
  | QuoteApplicationResponse
  | TransportErrorResponse;

/** Hono transport for the Backend-owned POST /api/check boundary. */
export function createCheckApp(service: CheckService): Hono {
  return createJsonPostApp({
    path: "/api/check",
    operation: "check",
    handle: (request) => service.check(request),
  });
}

export interface QuoteService {
  quote(request: unknown): Promise<QuoteApplicationResponse>;
}

/** Hono transport for the Backend-owned POST /api/quote boundary. */
export function createQuoteApp(service: QuoteService): Hono {
  return createJsonPostApp({
    path: "/api/quote",
    operation: "quote",
    handle: (request) => service.quote(request),
  });
}

type JsonPostAppOptions = {
  path: "/api/check" | "/api/quote";
  operation: "check" | "quote";
  handle(
    request: unknown,
  ): Promise<CheckApplicationResponse | QuoteApplicationResponse>;
};

function createJsonPostApp(options: JsonPostAppOptions): Hono {
  const app = new Hono();

  app.post(options.path, async (context) => {
    const parsed = await parseJsonRequestBody(context.req.raw);
    if (!parsed.success) {
      return jsonResponse({
        status: parsed.status,
        body: {
          error: { code: parsed.code, message: parsed.message },
        },
      });
    }

    return jsonResponse(await options.handle(parsed.body));
  });

  registerApiFallbacks(app, {
    methodNotAllowed: [
      {
        path: options.path,
        method: "POST",
        message: `Only POST is supported for ${options.path}`,
      },
    ],
    internalErrorMessage: `The ${options.operation} could not be completed`,
  });

  return app;
}

function jsonResponse(
  response: TransportResponse,
  additionalHeaders: Record<string, string> = {},
): Response {
  return createJsonResponse(response.body, response.status, additionalHeaders);
}
