import { type ServerType, serve as serveNode } from "@hono/node-server";
import { serializeJson } from "@parallax/contracts";
import { validateMossRuntimePathSync } from "@parallax/moss-bridge";
import type {
  KuruLiveQuoteRunner,
  KuruLiveRunner,
} from "@parallax/orchestrator/agent-flow";
import {
  KuruLiveAgentFlow,
  KuruLiveQuoteAgentFlow,
} from "@parallax/orchestrator/agent-flow";
import type { ReplayFixtureRepository } from "@parallax/orchestrator/application";
import { ReplayApplicationService } from "@parallax/orchestrator/application";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { CheckApplicationService } from "../application.js";
import { createCheckApp, createQuoteApp } from "../http.js";
import {
  type AgentFlowPort,
  type QuoteAgentFlowPort,
  UnsupportedAgentFlowError,
} from "../ports.js";
import { QuoteApplicationService } from "../quote-application.js";
import { createHealthApp } from "../routes/health.js";
import { createReplayApp } from "../routes/replay.js";
import { createConfiguredRunStore } from "../run-store-factory.js";
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

export class UnavailableQuoteAgentFlow implements QuoteAgentFlowPort {
  public async quote(): Promise<never> {
    throw new UnsupportedAgentFlowError();
  }
}

export type BackendAppDependencies = {
  runtime: BackendRuntime;
  corsOrigin?: string;
  agentFlow?: AgentFlowPort;
  liveRunner?: KuruLiveRunner;
  quoteFlow?: QuoteAgentFlowPort;
  quoteRunner?: KuruLiveQuoteRunner;
  store?: RunStore;
  /** Explicit disposer for a Store owned by this application. */
  disposeStore?: () => Promise<void>;
  replayRepository?: ReplayFixtureRepository;
};

export type BackendApp = Hono & {
  close(): Promise<void>;
};

/** Composes the live Check and explicit recorded Replay HTTP applications. */
export function createBackendApp(
  dependencies: BackendAppDependencies,
): BackendApp {
  const ownedStore =
    dependencies.store === undefined ? new InMemoryRunStore() : undefined;
  const store = dependencies.store ?? ownedStore;
  if (store === undefined) {
    throw new Error("Backend Store was not configured");
  }
  const disposeStore =
    dependencies.disposeStore ??
    (ownedStore === undefined ? undefined : () => ownedStore.close());
  let closePromise: Promise<void> | undefined;
  const checkService = new CheckApplicationService({
    runtime: dependencies.runtime,
    store,
    agentFlow:
      dependencies.agentFlow ??
      createConfiguredAgentFlow(dependencies.runtime, dependencies.liveRunner),
  });
  const replayService = new ReplayApplicationService({
    repository:
      dependencies.replayRepository ?? new FileReplayFixtureRepository(),
  });
  const quoteService = new QuoteApplicationService({
    runtime: dependencies.runtime,
    quoteFlow:
      dependencies.quoteFlow ??
      createConfiguredQuoteAgentFlow(
        dependencies.runtime,
        dependencies.quoteRunner,
      ),
  });

  const app = new Hono();
  app.route("/", createHealthApp());
  app.use(
    "/api/*",
    cors({
      origin: dependencies.corsOrigin ?? defaultCorsOrigin,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );
  app.route("/", createCheckApp(checkService));
  app.route("/", createQuoteApp(quoteService));
  app.route("/", createReplayApp(replayService));
  app.notFound(() => jsonError(404, "NOT_FOUND", "Route not found"));
  app.onError(() =>
    jsonError(
      500,
      "INTERNAL_ERROR",
      "The backend request could not be completed",
    ),
  );

  return Object.assign(app, {
    close: () => {
      closePromise ??= disposeStore?.() ?? Promise.resolve();
      return closePromise;
    },
  });
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

function createConfiguredQuoteAgentFlow(
  runtime: BackendRuntime,
  quoteRunner?: KuruLiveQuoteRunner,
): QuoteAgentFlowPort {
  if (runtime.config.moss.runtimePath === undefined) {
    return new UnavailableQuoteAgentFlow();
  }

  return new KuruLiveQuoteAgentFlow(quoteRunner);
}

export type BootstrapBackendAppOptions = {
  environment?: unknown;
  tokenRegistry: unknown;
  corsOrigin?: string;
  agentFlow?: AgentFlowPort;
  liveRunner?: KuruLiveRunner;
  quoteFlow?: QuoteAgentFlowPort;
  quoteRunner?: KuruLiveQuoteRunner;
  store?: RunStore;
  /** Explicit disposer for a Store owned by this application. */
  disposeStore?: () => Promise<void>;
  replayRepository?: ReplayFixtureRepository;
};

/** Validates production configuration before composing the backend app. */
export function bootstrapBackendApp(
  options: BootstrapBackendAppOptions,
): BackendApp {
  const environment = options.environment ?? process.env;
  const serverEnvironment = serverEnvironmentSchema.parse(environment);
  const runtime = bootstrapBackendRuntime({
    environment,
    tokenRegistry: options.tokenRegistry,
  });
  if (runtime.config.moss.runtimePath !== undefined) {
    validateMossRuntimePathSync(runtime.config.moss.runtimePath, {
      runtimeVersion: runtime.config.moss.runtimeVersion,
      runtimeRevision: runtime.config.moss.runtimeRevision,
    });
  }

  const configuredStore =
    options.store === undefined
      ? createConfiguredRunStore(environment)
      : undefined;
  const store = options.store ?? configuredStore;
  if (store === undefined) {
    throw new Error("Backend Store was not configured");
  }
  const disposeStore =
    options.disposeStore ??
    (configuredStore === undefined ? undefined : () => configuredStore.close());

  return createBackendApp({
    runtime,
    corsOrigin: options.corsOrigin ?? serverEnvironment.CORS_ORIGIN,
    agentFlow: options.agentFlow,
    liveRunner: options.liveRunner,
    quoteFlow: options.quoteFlow,
    quoteRunner: options.quoteRunner,
    store,
    disposeStore,
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
  const server = (options.serverFactory ?? serveNode)(
    {
      fetch: app.fetch,
      hostname: listener.HOST,
      port: listener.PORT,
    },
    options.onListening,
  );

  if (typeof server.once === "function") {
    server.once("close", () => {
      void app.close();
    });
  }

  return server;
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
