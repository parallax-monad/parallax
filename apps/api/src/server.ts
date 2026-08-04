import { pathToFileURL } from "node:url";
import type { ServerType } from "@hono/node-server";
import type { StartBackendServerOptions } from "./bootstrap/backend.js";
import { startBackendServer } from "./bootstrap/backend.js";
import { parseTokenRegistryEnvironment } from "./runtime-config.js";

export type StartConfiguredBackendServerOptions = Omit<
  StartBackendServerOptions,
  "tokenRegistry"
>;

/** Starts the configured P2 backend with process environment injection. */
export function startConfiguredBackendServer(
  options: StartConfiguredBackendServerOptions = {},
): ServerType {
  const environment = options.environment ?? process.env;

  return startBackendServer({
    ...options,
    environment,
    tokenRegistry: parseTokenRegistryEnvironment(environment),
  });
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(process.argv[1]).href === import.meta.url
  );
}

if (isMainModule()) {
  startConfiguredBackendServer();
}
