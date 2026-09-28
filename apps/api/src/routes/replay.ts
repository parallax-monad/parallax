import { serializeJson } from "@parallax/contracts";
import type {
  ReplayApiErrorBody,
  ReplayApplicationResponse,
} from "@parallax/orchestrator/application";
import { Hono } from "hono";
import { registerApiFallbacks } from "./api-fallbacks.js";

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

  registerApiFallbacks(app, {
    methodNotAllowed: [
      {
        path: "/api/replay/:id",
        method: "GET",
        message: "Only GET is supported for /api/replay/:id",
      },
    ],
    internalErrorMessage: "The recorded replay could not be returned",
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
      ...additionalHeaders,
    },
  });
}
