import { serializeJson } from "@parallax/contracts";
import { Hono } from "hono";

const healthResponse = new Response(serializeJson({ status: "ok" }), {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
});
const readyResponse = new Response(serializeJson({ status: "ok" }), {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
});
const notReadyResponse = new Response(serializeJson({ status: "not_ready" }), {
  status: 503,
  headers: { "content-type": "application/json; charset=utf-8" },
});

export type ReadinessCheck = () => Promise<void>;

const noOpReadinessCheck: ReadinessCheck = () => Promise.resolve();

/** Liveness and dependency-readiness endpoints for the backend runtime. */
export function createHealthApp(
  readinessCheck: ReadinessCheck = noOpReadinessCheck,
): Hono {
  const app = new Hono();

  app.get("/health", () => healthResponse.clone());
  app.get("/readyz", async () => {
    try {
      await readinessCheck();
      return readyResponse.clone();
    } catch {
      // Keep dependency details out of the public readiness response.
      return notReadyResponse.clone();
    }
  });

  return app;
}
