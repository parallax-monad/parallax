import type { ReplayApplicationResponse } from "@parallax/orchestrator/application";
import { describe, expect, it } from "vitest";
import { createReplayApp, type ReplayService } from "./replay.js";

function dispatch(pathname: string, service: ReplayService, method = "GET") {
  return createReplayApp(service).fetch(
    new Request(`https://api.example.test${pathname}`, { method }),
  );
}

describe("GET /api/replay/:id transport", () => {
  it("passes the route ID to the application service", async () => {
    let received: string | undefined;
    const service: ReplayService = {
      async replay(id) {
        received = id;
        return {
          status: 404,
          body: {
            error: { code: "REPLAY_NOT_FOUND", message: "missing" },
          },
        };
      },
    };

    const response = await dispatch("/api/replay/mon-to-usdc", service);

    expect(received).toBe("mon-to-usdc");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("only accepts GET on the exact Replay path", async () => {
    const service: ReplayService = {
      async replay() {
        throw new Error("must not run");
      },
    };

    const wrongMethod = await dispatch(
      "/api/replay/mon-to-usdc",
      service,
      "POST",
    );
    const wrongPath = await dispatch("/api/replays/mon-to-usdc", service);

    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
    expect(wrongPath.status).toBe(404);
  });

  it("isolates unexpected application failures", async () => {
    const service: ReplayService = {
      async replay(): Promise<ReplayApplicationResponse> {
        throw new Error("internal detail");
      },
    };

    const response = await dispatch("/api/replay/mon-to-usdc", service);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The recorded replay could not be returned",
      },
    });
  });
});
