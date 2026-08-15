import { serializeJson } from "@parallax/contracts";
import { Hono } from "hono";
import type {
  RunQueryApiErrorBody,
  RunQueryApplicationResponse,
} from "../run-query.js";

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

  app.all("/api/runs/:runId", () =>
    jsonResponse(
      {
        status: 405,
        body: {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Only GET is supported for /api/runs/:runId",
          },
        },
      },
      { allow: "GET" },
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
          message: "The requested run could not be returned",
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
  return new Response(serializeJson(response.body), {
    status: response.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...additionalHeaders,
    },
  });
}
