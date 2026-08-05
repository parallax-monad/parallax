import { type ServerType, serve as serveNode } from "@hono/node-server";
import { serializeJson } from "@parallax/contracts";
import type { KuruLiveRunner } from "@parallax/orchestrator/agent-flow";
import { KuruLiveAgentFlow } from "@parallax/orchestrator/agent-flow";
import type { ReplayFixtureRepository } from "@parallax/orchestrator/application";
import { ReplayApplicationService } from "@parallax/orchestrator/application";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { CheckApplicationService } from "../application.js";
import { createCheckApp } from "../http.js";
import { type AgentFlowPort, UnsupportedAgentFlowError } from "../ports.js";
import { createReplayApp } from "../routes/replay.js";
import {
  type BackendRuntime,
  bootstrapBackendRuntime,
} from "../runtime-config.js";
import { FileReplayFixtureRepository } from "../storage/replay-fixture-repository.js";
import { InMemoryRunStore, type RunStore } from "../store.js";

const serverEnvironmentSchema = z.object({
  CORS_ORIGIN: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().url().optional(),
  ),
  HOST: z.string().trim().min(1).optional(),
  PORT: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce.number().int().min(0).max(65_535).optional(),
  ),
});

const defaultCorsOrigin = "http://localhost:5173";

const listenerConfigSchema = z.object({
  HOST: z.preprocess(
    (value) => value ?? "",
    z.string().trim().min(1, "HOST is required"),
  ),
  PORT: z
    .preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z
        .number()
        .int()
        .min(0, "PORT must be between 0 and 65535")
        .max(65_535, "PORT must be between 0 and 65535")
        .optional(),
    )
    .refine((port) => port !== undefined, "PORT is required"),
});

/**
 * Explicit fallback when no pinned Moss runtime path is configured. Replay
 * remains a separate endpoint and is never used as a fabricated live result.
 */
export class UnavailableAgentFlow implements AgentFlowPort {
  public async check(): Promise<never> {
    throw new UnsupportedAgentFlowError();
  }
}

export type BackendAppDependencies = {
  runtime: BackendRuntime;
  corsOrigin?: string;
  agentFlow?: AgentFlowPort;
  liveRunner?: KuruLiveRunner;
  store?: RunStore;
  replayRepository?: ReplayFixtureRepository;
};

/** Composes the live Check and explicit recorded Replay HTTP applications. */
export function createBackendApp(dependencies: BackendAppDependencies): Hono {
  const checkService = new CheckApplicationService({
    runtime: dependencies.runtime,
    store: dependencies.store ?? new InMemoryRunStore(),
    agentFlow:
      dependencies.agentFlow ??
      createConfiguredAgentFlow(dependencies.runtime, dependencies.liveRunner),
  });
  const replayService = new ReplayApplicationService({
    repository:
      dependencies.replayRepository ?? new FileReplayFixtureRepository(),
  });

  const app = new Hono();
  app.use(
    "/api/*",
    cors({
      origin: dependencies.corsOrigin ?? defaultCorsOrigin,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );
  app.route("/", createCheckApp(checkService));
  app.route("/", createReplayApp(replayService));
  app.notFound(() => jsonError(404, "NOT_FOUND", "Route not found"));
  app.onError(() =>
    jsonError(
      500,
      "INTERNAL_ERROR",
      "The backend request could not be completed",
    ),
  );

  return app;
}

function createConfiguredAgentFlow(
  runtime: BackendRuntime,
  liveRunner?: KuruLiveRunner,
): AgentFlowPort {
  if (runtime.config.moss.runtimePath === undefined) {
    return new UnavailableAgentFlow();
  }

  return new KuruLiveAgentFlow(liveRunner);
}

export type BootstrapBackendAppOptions = {
  environment?: unknown;
  tokenRegistry: unknown;
  corsOrigin?: string;
  agentFlow?: AgentFlowPort;
  liveRunner?: KuruLiveRunner;
  store?: RunStore;
  replayRepository?: ReplayFixtureRepository;
};

/** Validates production configuration before composing the backend app. */
export function bootstrapBackendApp(options: BootstrapBackendAppOptions): Hono {
  const environment = options.environment ?? process.env;
  const serverEnvironment = serverEnvironmentSchema.parse(environment);
  const runtime = bootstrapBackendRuntime({
    environment,
    tokenRegistry: options.tokenRegistry,
  });

  return createBackendApp({
    runtime,
    corsOrigin: options.corsOrigin ?? serverEnvironment.CORS_ORIGIN,
    agentFlow: options.agentFlow,
    liveRunner: options.liveRunner,
    store: options.store,
    replayRepository: options.replayRepository,
  });
}

export type StartBackendServerOptions = BootstrapBackendAppOptions & {
  hostname?: string;
  port?: number;
  onListening?: Parameters<typeof serveNode>[1];
  serverFactory?: typeof serveNode;
};

/** Bootstraps the validated runtime and starts the Node HTTP server. */
export function startBackendServer(
  options: StartBackendServerOptions,
): ServerType {
  const environment = options.environment ?? process.env;
  const serverEnvironment = serverEnvironmentSchema.parse(environment);
  const listener = listenerConfigSchema.parse({
    HOST: options.hostname ?? serverEnvironment.HOST,
    PORT: options.port ?? serverEnvironment.PORT,
  });
  const app = bootstrapBackendApp({ ...options, environment });

  return (options.serverFactory ?? serveNode)(
    {
      fetch: app.fetch,
      hostname: listener.HOST,
      port: listener.PORT,
    },
    options.onListening,
  );
}

function jsonError(
  status: 404 | 500,
  code: "NOT_FOUND" | "INTERNAL_ERROR",
  message: string,
): Response {
  return new Response(serializeJson({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
