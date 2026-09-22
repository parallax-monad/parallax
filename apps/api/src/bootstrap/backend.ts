import { type ServerType, serve as serveNode } from "@hono/node-server";
import { quoteResultSchema, serializeJson } from "@parallax/contracts";
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
import type { BackendCompositionRuntime } from "../backend/composition.js";
import {
  BackendPipeline,
  createBackendCheckFlow,
  createBackendQuoteFlow,
} from "../backend/pipeline.js";
import { createCheckApp, createQuoteApp } from "../http.js";
import {
  type AgentFlowPort,
  type QuoteAgentFlowPort,
  UnsupportedAgentFlowError,
} from "../ports.js";
import { QuoteApplicationService } from "../quote-application.js";
import { createHealthApp, type ReadinessCheck } from "../routes/health.js";
import { createReplayApp } from "../routes/replay.js";
import { createRunQueryApp } from "../routes/runs.js";
import { RunQueryApplicationService } from "../run-query.js";
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
  composition?: BackendCompositionRuntime;
  corsOrigin?: string;
  agentFlow?: AgentFlowPort;
  liveRunner?: KuruLiveRunner;
  quoteFlow?: QuoteAgentFlowPort;
  quoteRunner?: KuruLiveQuoteRunner;
  store?: RunStore;
  /** Optional dependency probe exposed through `/readyz`. */
  readinessCheck?: ReadinessCheck;
  /** Explicit disposer for a Store owned by this application. */
  disposeStore?: () => Promise<void>;
  replayRepository?: ReplayFixtureRepository;
};

export type BackendApp = Hono & {
  close(): Promise<void>;
};

export type BackendServer = ServerType & {
  /** Closes the HTTP listener and awaits application-owned resources. */
  shutdown(): Promise<void>;
};

/** Composes the live Check and explicit recorded Replay HTTP applications. */
export function createBackendApp(
  dependencies: BackendAppDependencies,
): BackendApp {
  const ownedStore =
    dependencies.store === undefined && dependencies.composition === undefined
      ? new InMemoryRunStore()
      : undefined;
  if (
    dependencies.store !== undefined &&
    dependencies.composition !== undefined &&
    dependencies.store !== dependencies.composition.runStore
  ) {
    throw new Error("Backend Store must be the composition RunStore");
  }
  const store =
    dependencies.store ?? dependencies.composition?.runStore ?? ownedStore;
  if (store === undefined) {
    throw new Error("Backend Store was not configured");
  }
  const disposeStore =
    dependencies.disposeStore ??
    (ownedStore === undefined ? undefined : () => ownedStore.close());
  const agentFlow =
    dependencies.agentFlow ??
    (dependencies.composition === undefined
      ? createConfiguredAgentFlow(dependencies.runtime, dependencies.liveRunner)
      : createCompositionBackedCheckFlow(dependencies.composition));
  const quoteFlow =
    dependencies.quoteFlow ??
    (dependencies.composition === undefined
      ? createConfiguredQuoteAgentFlow(
          dependencies.runtime,
          dependencies.quoteRunner,
        )
      : createCompositionBackedQuoteFlow(dependencies.composition));
  let closePromise: Promise<void> | undefined;
  const checkService = new CheckApplicationService({
    runtime: dependencies.runtime,
    store,
    composition: dependencies.composition,
    agentFlow,
  });
  const replayService = new ReplayApplicationService({
    repository:
      dependencies.replayRepository ?? new FileReplayFixtureRepository(),
  });
  const runQueryService = new RunQueryApplicationService({ store });
  const quoteService = new QuoteApplicationService({
    runtime: dependencies.runtime,
    composition: dependencies.composition,
    quoteFlow,
  });

  const app = new Hono();
  app.route("/", createHealthApp(dependencies.readinessCheck));
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
  app.route("/", createRunQueryApp(runQueryService));
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

function createCompositionBackedCheckFlow(
  composition: BackendCompositionRuntime,
): AgentFlowPort {
  const pipeline = new BackendPipeline({ runtime: composition });
  return createBackendCheckFlow({
    pipeline,
    project: (execution) => execution.decisionOutput,
    capability: "simulate",
  });
}

function createCompositionBackedQuoteFlow(
  composition: BackendCompositionRuntime,
): QuoteAgentFlowPort {
  return createBackendQuoteFlow({
    runtime: composition,
    project: ({ blockContext, quote }) =>
      projectCompositionQuote({
        blockContext,
        quote,
      }),
  });
}

function projectCompositionQuote(input: {
  blockContext: { readonly blockNumber: string };
  quote: unknown;
}): unknown {
  const parsedQuoteResult = quoteResultSchema.safeParse(input.quote);
  if (parsedQuoteResult.success) {
    if (parsedQuoteResult.data.status === "unavailable") {
      return parsedQuoteResult.data;
    }

    return {
      status: "available",
      quote: {
        ...parsedQuoteResult.data.quote,
        blockNumber: input.blockContext.blockNumber,
      },
    };
  }

  if (!isRecord(input.quote)) {
    return { status: "unavailable", reason: "QUOTE_UNAVAILABLE" };
  }

  const estimatedAmountOut =
    input.quote.estimatedAmountOut ?? input.quote.amountOut;
  if (typeof estimatedAmountOut !== "string") {
    return { status: "unavailable", reason: "QUOTE_UNAVAILABLE" };
  }

  const minimumAmountOut = input.quote.minimumAmountOut;
  if (minimumAmountOut !== undefined && typeof minimumAmountOut !== "string") {
    return { status: "unavailable", reason: "QUOTE_UNAVAILABLE" };
  }

  const runtimeVersion = input.quote.runtimeVersion;
  const runtimeRevision = input.quote.runtimeRevision;
  if (
    typeof runtimeVersion !== "string" ||
    runtimeVersion.trim() === "" ||
    typeof runtimeRevision !== "string" ||
    runtimeRevision.trim() === ""
  ) {
    return { status: "unavailable", reason: "QUOTE_UNAVAILABLE" };
  }

  return {
    status: "available",
    quote: {
      estimatedAmountOut,
      ...(minimumAmountOut === undefined ? {} : { minimumAmountOut }),
      source: "quote",
      blockNumber: input.blockContext.blockNumber,
      runtimeVersion,
      runtimeRevision,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type BootstrapBackendAppOptions = {
  environment?: unknown;
  tokenRegistry: unknown;
  composition?: BackendCompositionRuntime;
  corsOrigin?: string;
  agentFlow?: AgentFlowPort;
  liveRunner?: KuruLiveRunner;
  quoteFlow?: QuoteAgentFlowPort;
  quoteRunner?: KuruLiveQuoteRunner;
  store?: RunStore;
  /** Optional dependency probe exposed through `/readyz`. */
  readinessCheck?: ReadinessCheck;
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
    options.store === undefined && options.composition === undefined
      ? createConfiguredRunStore(environment)
      : undefined;
  const store =
    options.store ?? options.composition?.runStore ?? configuredStore;
  if (store === undefined) {
    throw new Error("Backend Store was not configured");
  }
  const disposeStore =
    options.disposeStore ??
    (configuredStore === undefined ? undefined : () => configuredStore.close());
  const readinessCheck =
    options.readinessCheck ??
    (configuredStore === undefined
      ? undefined
      : () => configuredStore.checkReady());

  return createBackendApp({
    runtime,
    composition: options.composition,
    corsOrigin: options.corsOrigin ?? serverEnvironment.CORS_ORIGIN,
    agentFlow: options.agentFlow,
    liveRunner: options.liveRunner,
    quoteFlow: options.quoteFlow,
    quoteRunner: options.quoteRunner,
    store,
    readinessCheck,
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
): BackendServer {
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

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        void app.close().then(() => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        }, reject);
      };

      try {
        server.close((error?: Error) => finish(error));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return shutdownPromise;
  };

  if (typeof server.once === "function") {
    server.once("close", () => {
      void app.close();
    });
  }

  return Object.assign(server, { shutdown });
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
