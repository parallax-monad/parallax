import { serializeJson } from "@parallax/contracts";

const MAX_BODY_BYTES = 1024 * 1024;

export type JsonRequestBodyResult =
  | { readonly success: true; readonly body: unknown }
  | {
      readonly success: false;
      readonly status: 400 | 413;
      readonly code: "INVALID_JSON" | "PAYLOAD_TOO_LARGE";
      readonly message: string;
    };

/** Parses a bounded JSON request body using the shared Backend transport limit. */
export async function parseJsonRequestBody(
  request: Request,
): Promise<JsonRequestBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_BODY_BYTES
  ) {
    return payloadTooLarge();
  }

  let rawBody: string;
  try {
    rawBody = await readBody(request);
  } catch (error) {
    return error instanceof PayloadTooLargeError
      ? payloadTooLarge()
      : invalidJson();
  }

  try {
    return { success: true, body: JSON.parse(rawBody) as unknown };
  } catch {
    return invalidJson();
  }
}

export function createJsonResponse(
  body: unknown,
  status: number,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(serializeJson(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...additionalHeaders,
    },
  });
}

function invalidJson(): JsonRequestBodyResult {
  return {
    success: false,
    status: 400,
    code: "INVALID_JSON",
    message: "Request body must be valid JSON",
  };
}

function payloadTooLarge(): JsonRequestBodyResult {
  return {
    success: false,
    status: 413,
    code: "PAYLOAD_TOO_LARGE",
    message: "Request body must not exceed 1 MiB",
  };
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
