import { Hono } from "hono";
import type {
  CheckApiErrorBody,
  CheckApplicationResponse,
} from "./application.js";
import type { QuoteApplicationResponse } from "./quote-application.js";
import { createJsonResponse, parseJsonRequestBody } from "./json-http.js";

export interface CheckService {
  check(request: unknown): Promise<CheckApplicationResponse>;
}

type TransportErrorResponse = {
  status: 400 | 404 | 405 | 413 | 500;
  body:
    | CheckApiErrorBody
    | {
        error: {
          code:
            | "INVALID_JSON"
            | "NOT_FOUND"
            | "METHOD_NOT_ALLOWED"
            | "PAYLOAD_TOO_LARGE"
            | "INTERNAL_ERROR";
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

  app.all(options.path, () =>
    jsonResponse(
      {
        status: 405,
        body: {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: `Only POST is supported for ${options.path}`,
          },
        },
      },
      { allow: "POST" },
    ),
  );

  app.notFound(() =>
    jsonResponse({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "Route not found" } },
    }),
  );

  app.onError(() =>
    jsonResponse({
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: `The ${options.operation} could not be completed`,
        },
      },
    }),
  );

  return app;
}

function jsonResponse(
  response: TransportResponse,
  additionalHeaders: Record<string, string> = {},
): Response {
  return createJsonResponse(response.body, response.status, additionalHeaders);
}
