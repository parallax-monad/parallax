import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BackendServer,
  type StartBackendServerOptions,
  startBackendServer,
} from "./bootstrap/backend.js";
import {
  parseRunStoreEnvironment,
  parseTokenRegistryEnvironment,
} from "./runtime-config.js";
import { migratePostgres } from "./storage/migrations.js";

export type StartConfiguredBackendServerOptions = Omit<
  StartBackendServerOptions,
  "tokenRegistry"
>;

/** Starts the configured P0 backend with process environment injection. */
export function startConfiguredBackendServer(
  options: StartConfiguredBackendServerOptions = {},
): BackendServer {
  const environment = options.environment ?? process.env;

  return startBackendServer({
    ...options,
    environment,
    tokenRegistry: parseTokenRegistryEnvironment(environment),
  });
}

export type StartConfiguredBackendProcessOptions =
  StartConfiguredBackendServerOptions & {
    /** Injectable migration runner for deterministic launcher tests. */
    migrationRunner?: (databaseUrl: string) => Promise<unknown>;
    /** Optional signal source used by the production process and tests. */
    signalSource?: ShutdownSignalSource;
  };

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export type ShutdownSignalSource = {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
};

/** Runs production migrations before opening the HTTP listener. */
export async function startConfiguredBackendProcess(
  options: StartConfiguredBackendProcessOptions = {},
): Promise<BackendServer> {
  const environment = options.environment ?? process.env;
  const runStoreConfig = parseRunStoreEnvironment(environment);
  const migrationRunner = options.migrationRunner ?? migratePostgres;

  if (
    runStoreConfig.RUN_STORE_BACKEND === "postgres" &&
    runStoreConfig.DATABASE_URL !== undefined
  ) {
    await migrationRunner(runStoreConfig.DATABASE_URL);
  }

  const {
    migrationRunner: _migrationRunner,
    signalSource,
    ...serverOptions
  } = options;
  const server = startConfiguredBackendServer({
    ...serverOptions,
    environment,
  });
  if (signalSource !== undefined) {
    installGracefulShutdown(server, signalSource);
  }
  return server;
}

/** Installs idempotent SIGTERM/SIGINT shutdown handling for the process. */
export function installGracefulShutdown(
  server: BackendServer,
  signalSource: ShutdownSignalSource,
  onError: (error: unknown) => void = (error) => {
    console.error("Failed to gracefully shut down Parallax API", error);
    process.exitCode = 1;
  },
): () => void {
  let removed = false;
  const handleSignal = (): void => {
    void server.shutdown().catch(onError).finally(remove);
  };
  const remove = (): void => {
    if (removed) return;
    removed = true;
    signalSource.off("SIGTERM", handleSignal);
    signalSource.off("SIGINT", handleSignal);
  };

  signalSource.on("SIGTERM", handleSignal);
  signalSource.on("SIGINT", handleSignal);
  return remove;
}

export function logBackendListening(address: AddressInfo): void {
  const host = address.address.includes(":")
    ? `[${address.address}]`
    : address.address;
  console.log(`Parallax API listening on http://${host}:${address.port}`);
}

export function isMainModule(
  entrypointPath = process.argv[1],
  moduleUrl = import.meta.url,
  platform = process.platform,
): boolean {
  if (entrypointPath === undefined) return false;

  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const entrypoint = pathApi.resolve(entrypointPath);
  const modulePath = pathApi.resolve(fileURLToPath(moduleUrl));

  return platform === "win32"
    ? entrypoint.toLowerCase() === modulePath.toLowerCase()
    : entrypoint === modulePath;
}

if (isMainModule()) {
  void startConfiguredBackendProcess({
    onListening: logBackendListening,
    signalSource: process,
  }).catch((error: unknown) => {
    console.error("Failed to start Parallax API", error);
    process.exitCode = 1;
  });
}
