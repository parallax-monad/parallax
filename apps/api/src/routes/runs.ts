import { serializeJson } from "@parallax/contracts";
import { Hono } from "hono";
import type {
  RunQueryApiErrorBody,
  RunQueryApplicationResponse,
} from "../run-query.js";
import { registerApiFallbacks } from "./api-fallbacks.js";

export interface RunQueryService {
  getRun(runId: string): Promise<RunQueryApplicationResponse>;
}

type TransportResponse =
  | RunQueryApplicationResponse
  | {
      status: 404 | 405 | 500;
      body:
        | RunQueryApiErrorBody
        | {
            error: {
              code: "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INTERNAL_ERROR";
              message: string;
            };
          };
    };

/** Hono transport for GET /api/runs/:runId. */
export function createRunQueryApp(service: RunQueryService): Hono {
  const app = new Hono();

  app.get("/api/runs/:runId", async (context) =>
    jsonResponse(await service.getRun(context.req.param("runId"))),
  );

  registerApiFallbacks(app, {
    methodNotAllowed: [
      {
        path: "/api/runs/:runId",
        method: "GET",
        message: "Only GET is supported for /api/runs/:runId",
      },
    ],
    internalErrorMessage: "The requested run could not be returned",
    cacheControl: "no-store",
  });

  return app;
}

function jsonResponse(
  response: TransportResponse,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(serializeJson(response.body), {
    status: response.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...additionalHeaders,
    },
  });
}
