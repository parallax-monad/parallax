import { serializeJson } from "@parallax/contracts";
import { Hono } from "hono";
import type {
  CheckApiErrorBody,
  CheckApplicationResponse,
} from "./application.js";
import type { QuoteApplicationResponse } from "./quote-application.js";

const MAX_BODY_BYTES = 1024 * 1024;

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
    const request = context.req.raw;
    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      Number.isFinite(Number(contentLength)) &&
      Number(contentLength) > MAX_BODY_BYTES
    ) {
      return payloadTooLargeResponse();
    }

    let rawBody: string;
    try {
      rawBody = await readBody(request);
    } catch (error) {
      return error instanceof PayloadTooLargeError
        ? payloadTooLargeResponse()
        : invalidJsonResponse();
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return invalidJsonResponse();
    }

    return jsonResponse(await options.handle(body));
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

class PayloadTooLargeError extends Error {}

async function readBody(request: Request): Promise<string> {
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

function invalidJsonResponse(): Response {
  return jsonResponse({
    status: 400,
    body: {
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON",
      },
    },
  });
}

function payloadTooLargeResponse(): Response {
  return jsonResponse({
    status: 413,
    body: {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body must not exceed 1 MiB",
      },
    },
  });
}

function jsonResponse(
  response: TransportResponse,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(serializeJson(response.body), {
    status: response.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...additionalHeaders,
    },
  });
}
