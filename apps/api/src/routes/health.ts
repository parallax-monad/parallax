import { serializeJson } from "@parallax/contracts";
import { Hono } from "hono";

const healthResponse = new Response(serializeJson({ status: "ok" }), {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
});

/** Lightweight liveness endpoint for external uptime probes. */
export function createHealthApp(): Hono {
  const app = new Hono();

  app.get("/health", () => healthResponse.clone());

  return app;
}
