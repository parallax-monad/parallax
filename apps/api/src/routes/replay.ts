import { serializeJson } from "@parallax/contracts";
import type {
  ReplayApiErrorBody,
  ReplayApplicationResponse,
} from "@parallax/orchestrator/application";
import { Hono } from "hono";

export interface ReplayService {
  replay(id: string): Promise<ReplayApplicationResponse>;
}

type TransportResponse =
  | ReplayApplicationResponse
  | {
      status: 404 | 405 | 500;
      body:
        | ReplayApiErrorBody
        | {
            error: {
              code: "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INTERNAL_ERROR";
              message: string;
            };
          };
    };

/** Hono transport for GET /api/replay/:id. */
export function createReplayApp(service: ReplayService): Hono {
  const app = new Hono();

  app.get("/api/replay/:id", async (context) =>
    jsonResponse(await service.replay(context.req.param("id"))),
  );

  app.all("/api/replay/:id", () =>
    jsonResponse(
      {
        status: 405,
        body: {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Only GET is supported for /api/replay/:id",
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
          message: "The recorded replay could not be returned",
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
      ...additionalHeaders,
    },
  });
}
