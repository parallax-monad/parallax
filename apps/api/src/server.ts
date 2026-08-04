import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  startConfiguredBackendServer({ onListening: logBackendListening });
}
