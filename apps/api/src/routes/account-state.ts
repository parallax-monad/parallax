import { Hono } from "hono";
import type { AccountStateApplicationResponse } from "../account-state-model.js";
import type { AccountStateApplicationService } from "../account-state-application.js";
import { createJsonResponse, parseJsonRequestBody } from "../json-http.js";
import { registerApiFallbacks } from "./api-fallbacks.js";

type RouteResponse = AccountStateApplicationResponse | {
  status: 400 | 413;
  body: { error: { code: string; message: string } };
};

/** Read-only live account-state query and immutable snapshot retrieval routes. */
export function createAccountStateApp(
  service: AccountStateApplicationService,
): Hono {
  const app = new Hono();

  app.post("/api/account-state", async (context) => {
    const parsed = await parseJsonRequestBody(context.req.raw);
    if (!parsed.success) {
      return response({
        status: parsed.status,
        body: { error: { code: parsed.code, message: parsed.message } },
      });
    }

    return response(await service.query(parsed.body));
  });

  app.get("/api/account-state/:snapshotId", async (context) =>
    response(await service.getSnapshot(context.req.param("snapshotId"))),
  );

  registerApiFallbacks(app, {
    methodNotAllowed: [
      {
        path: "/api/account-state",
        method: "POST",
        message: "Only POST is supported for /api/account-state",
      },
      {
        path: "/api/account-state/:snapshotId",
        method: "GET",
        message: "Only GET is supported for /api/account-state/:snapshotId",
      },
    ],
    internalErrorMessage: "The account-state request could not be completed",
    cacheControl: "no-store",
  });

  return app;
}

function response(
  result: RouteResponse,
  additionalHeaders: Record<string, string> = {},
): Response {
  return createJsonResponse(result.body, result.status, {
    "cache-control": "no-store",
    ...additionalHeaders,
  });
}
