import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createArbitrumRpcClient } from "../../apps/api/src/backend/arbitrum-chain-adapter.js";
import {
  ForkSmokeError,
  getForkHarnessConfig,
  type RpcClient,
  runForkQuoteSmoke,
} from "./smoke.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const COMPOSE_FILE = join(SCRIPT_DIR, "compose.yaml");
const config = getForkHarnessConfig();
const CHECKOUT_ID_FILE = gitPath("parallax-arbitrum-one-fork.checkout-id");
const INSTANCE_FILE = gitPath("parallax-arbitrum-one-fork.instance");
const CAPTURE_FILE = gitPath("parallax-arbitrum-one-fork-capture.json");
const LOCK_FILE = gitPath("parallax-arbitrum-one-fork.lock");
const FORK_SOURCE_ENV = "ARBITRUM_ONE_FORK_UPSTREAM_RPC_URL";
const CHECKOUT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HarnessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
  }
}

interface DockerResult {
  readonly status: number | null;
  readonly stdout: string;
}

function gitPath(name: string): string {
  const output = spawnSync("git", ["rev-parse", "--git-path", name], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (output.status !== 0 || output.stdout.trim() === "") {
    throw new HarnessError(
      "GIT_METADATA_UNAVAILABLE",
      "Git metadata path is unavailable.",
    );
  }
  return resolve(REPO_ROOT, output.stdout.trim());
}

function acquireLock(): () => void {
  let descriptor: number;
  try {
    descriptor = openSync(LOCK_FILE, "wx", 0o600);
    writeFileSync(descriptor, `${process.pid}\n`, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new HarnessError(
        "HARNESS_BUSY",
        "Another fork task is active. Run fork smoke/reset/stop serially; remove the stale .git lock only after confirming no task is running.",
      );
    }
    throw new HarnessError(
      "HARNESS_LOCK_FAILED",
      "Could not acquire the shared fork lock.",
    );
  }
  return () => {
    try {
      closeSync(descriptor);
      unlinkSync(LOCK_FILE);
    } catch {
      // The lock is an ephemeral coordination file, never evidence.
    }
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function dockerEnvironment(includeUpstream: boolean): NodeJS.ProcessEnv {
  const keys = [
    "PATH",
    "HOME",
    "USER",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "DOCKER_API_VERSION",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (includeUpstream) {
    const endpoint = process.env[FORK_SOURCE_ENV];
    if (endpoint !== undefined) env[FORK_SOURCE_ENV] = endpoint;
  }
  return env;
}

function composeEnvironment(
  instanceId: string,
  includeUpstream: boolean,
): NodeJS.ProcessEnv {
  const env = dockerEnvironment(includeUpstream);
  const bindAddress = configuredBindAddress();
  env.FORK_INSTANCE_ID = instanceId;
  env.FORK_ANVIL_IMAGE = config.anvil.image;
  env.FORK_RPC_PROXY_IMAGE = config.rpcProxy.image;
  env.FORK_PROXY_SCRIPT_PATH = join(SCRIPT_DIR, "rpc-proxy.mjs");
  env.SOURCE_CHAIN_ID = String(config.source.chainId);
  env.SOURCE_BLOCK_NUMBER = config.source.blockNumber;
  env.SOURCE_BLOCK_HASH = config.source.blockHash;
  env.LOCAL_EXECUTION_CHAIN_ID = String(config.localExecutionChainId);
  env.FORK_BIND_ADDRESS = bindAddress;
  env.FORK_PROXY_HOST_PORT = configuredPort(
    "FORK_PROXY_HOST_PORT",
    config.rpcProxy.port,
  );
  env.FORK_LOCAL_HOST_PORT = configuredPort(
    "FORK_LOCAL_HOST_PORT",
    config.localRpcPort,
  );
  return env;
}

function configuredBindAddress(env: NodeJS.ProcessEnv = process.env): string {
  const address = env.FORK_BIND_ADDRESS?.trim() || "127.0.0.1";
  if (!isPrivateBindAddress(address)) {
    throw new HarnessError(
      "UNSAFE_BIND_ADDRESS",
      "FORK_BIND_ADDRESS must be a local or RFC1918 IPv4 interface address.",
    );
  }
  return address;
}

export function isPrivateBindAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  if (octets[0] === 127 || octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  return octets[0] === 169 && octets[1] === 254;
}

function configuredPort(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env[name]?.trim() || String(fallback);
  if (!/^\d+$/.test(raw)) {
    throw new HarnessError(
      "INVALID_PORT",
      `${name} must be an integer TCP port.`,
    );
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new HarnessError(
      "INVALID_PORT",
      `${name} must be between 1 and 65535.`,
    );
  }
  return String(port);
}

export function buildSmokeEndpoints(env: NodeJS.ProcessEnv = process.env): {
  sourceUrl: string;
  localUrl: string;
} {
  const bindAddress = configuredBindAddress(env);
  const proxyHostPort = configuredPort(
    "FORK_PROXY_HOST_PORT",
    config.rpcProxy.port,
    env,
  );
  const localHostPort = configuredPort(
    "FORK_LOCAL_HOST_PORT",
    config.localRpcPort,
    env,
  );
  const sourceUrl =
    env.ARBITRUM_ONE_FORK_SOURCE_RPC_URL ??
    dockerEndpoint(bindAddress, proxyHostPort);
  const localUrl =
    env.ARBITRUM_ONE_FORK_LOCAL_RPC_URL ??
    dockerEndpoint(bindAddress, localHostPort);
  validateLocalEndpoint(sourceUrl, "read-only source proxy");
  validateLocalEndpoint(localUrl, "local fork RPC");
  return { sourceUrl, localUrl };
}

function runDocker(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): DockerResult {
  const result = spawnSync("docker", [...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  if (result.error !== undefined) {
    throw new HarnessError(
      "DOCKER_UNAVAILABLE",
      "Docker CLI/daemon is unavailable in this environment.",
    );
  }
  return { status: result.status, stdout: result.stdout ?? "" };
}

function compose(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): DockerResult {
  return runDocker(
    buildComposeArgs(getCheckoutComposeProjectName(), args),
    env,
  );
}

function readCheckoutIdentity(identityPath: string): string | undefined {
  let identity: string;
  try {
    identity = readFileSync(identityPath, "utf8").trim();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw new HarnessError(
      "COMPOSE_PROJECT_ID_UNAVAILABLE",
      "Checkout Compose project identity is unavailable.",
    );
  }
  if (!CHECKOUT_ID_PATTERN.test(identity)) {
    throw new HarnessError(
      "COMPOSE_PROJECT_ID_UNAVAILABLE",
      "Stored checkout Compose project identity is invalid.",
    );
  }
  return identity.toLowerCase();
}

export function getCheckoutComposeProjectName(
  identityPath = CHECKOUT_ID_FILE,
  createIdentity: () => string = randomUUID,
): string {
  const existingIdentity = readCheckoutIdentity(identityPath);
  if (existingIdentity !== undefined) {
    return `parallax-arbitrum-one-fork-${existingIdentity}`;
  }

  const identity = createIdentity().toLowerCase();
  if (!CHECKOUT_ID_PATTERN.test(identity)) {
    throw new HarnessError(
      "COMPOSE_PROJECT_ID_UNAVAILABLE",
      "Could not create a valid checkout Compose project identity.",
    );
  }
  const temporaryPath = `${identityPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${identity}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      // Publish only a fully written identity; link creation fails atomically if another
      // process has already created this checkout's identity.
      linkSync(temporaryPath, identityPath);
      return `parallax-arbitrum-one-fork-${identity}`;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        const winningIdentity = readCheckoutIdentity(identityPath);
        if (winningIdentity !== undefined) {
          return `parallax-arbitrum-one-fork-${winningIdentity}`;
        }
      }
      throw new HarnessError(
        "COMPOSE_PROJECT_ID_UNAVAILABLE",
        "Could not persist the checkout Compose project identity in Git metadata.",
      );
    }
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(
      "COMPOSE_PROJECT_ID_UNAVAILABLE",
      "Could not create the checkout Compose project identity.",
    );
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary metadata file is never the persisted checkout identity.
    }
  }
}

export function buildComposeArgs(
  projectName: string,
  args: readonly string[],
): string[] {
  return [
    "compose",
    "--project-directory",
    REPO_ROOT,
    "--project-name",
    projectName,
    "--file",
    COMPOSE_FILE,
    ...args,
  ];
}

function requireComposeSuccess(result: DockerResult, action: string): string {
  if (result.status !== 0) {
    throw new HarnessError(
      "COMPOSE_OPERATION_FAILED",
      `Docker Compose ${action} failed. Raw output is suppressed to avoid endpoint leakage; check Docker Desktop, ports, and Compose availability.`,
    );
  }
  return result.stdout.trim();
}

function checkDockerAndCompose(env: NodeJS.ProcessEnv): void {
  const versionResult = runDocker(["compose", "version", "--short"], env);
  const version = requireComposeSuccess(versionResult, "version check");
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) {
    throw new HarnessError(
      "COMPOSE_VERSION_UNAVAILABLE",
      "Docker Compose version could not be verified.",
    );
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  if (
    major < 2 ||
    (major === 2 && (minor < 23 || (minor === 23 && patch < 1)))
  ) {
    throw new HarnessError(
      "COMPOSE_VERSION_UNSUPPORTED",
      "Docker Compose 2.23.1 or later is required for runtime-mounted endpoint secrets.",
    );
  }
  const daemon = runDocker(["info", "--format", "{{.ServerVersion}}"], env);
  requireComposeSuccess(daemon, "daemon check");
}

function readInstanceId(): string | undefined {
  if (!existsSync(INSTANCE_FILE)) return undefined;
  const instanceId = readFileSync(INSTANCE_FILE, "utf8").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      instanceId,
    )
  ) {
    throw new HarnessError(
      "FORK_INSTANCE_ID_UNAVAILABLE",
      "Stored fork instance identity is invalid.",
    );
  }
  return instanceId;
}

function requireUpstreamEndpoint(): void {
  const value = process.env[FORK_SOURCE_ENV]?.trim();
  if (!value) {
    throw new HarnessError(
      "UPSTREAM_ENDPOINT_REQUIRED",
      `${FORK_SOURCE_ENV} must be supplied at runtime; no endpoint value is written or printed.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HarnessError(
      "INVALID_RPC_ENDPOINT",
      "Upstream RPC endpoint is not a valid URL.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new HarnessError(
      "INVALID_RPC_ENDPOINT",
      "Upstream RPC endpoint must use HTTPS.",
    );
  }
}

async function assertHostPortsAvailable(env: NodeJS.ProcessEnv): Promise<void> {
  const host = env.FORK_BIND_ADDRESS ?? "127.0.0.1";
  const ports = [
    Number(env.FORK_PROXY_HOST_PORT),
    Number(env.FORK_LOCAL_HOST_PORT),
  ];
  if (ports[0] === ports[1]) {
    throw new HarnessError(
      "PORT_COLLISION",
      "The proxy and fork RPC ports must be different.",
    );
  }
  for (const port of ports) {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const server = createServer();
      server.once("error", () =>
        rejectPromise(
          new HarnessError(
            "PORT_IN_USE",
            `Required local fork port ${port} is unavailable on the configured private interface.`,
          ),
        ),
      );
      server.listen(port, host, () => {
        server.close((error) => {
          if (error)
            rejectPromise(
              new HarnessError(
                "PORT_CHECK_FAILED",
                "Could not verify local fork ports.",
              ),
            );
          else resolvePromise();
        });
      });
    });
  }
}

function instanceIdPath(): string {
  return INSTANCE_FILE;
}

function saveInstanceId(instanceId: string): void {
  writeFileSync(instanceIdPath(), `${instanceId}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function removeLocalMetadata(): void {
  for (const path of [INSTANCE_FILE, CAPTURE_FILE]) {
    try {
      unlinkSync(path);
    } catch {
      // Ignore absent ephemeral metadata files.
    }
  }
}

function dockerEndpoint(
  host: string,
  port: string | number,
  path = "",
): string {
  return `http://${host}:${port}${path}`;
}

export async function waitForProxyHealth(
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const host = env.FORK_BIND_ADDRESS ?? "127.0.0.1";
  const port = env.FORK_PROXY_HOST_PORT ?? String(config.rpcProxy.port);
  const endpoint = dockerEndpoint(host, port, "/healthz");
  const terminalCodes = new Set([
    "SOURCE_CHAIN_ID_MISMATCH",
    "SOURCE_BLOCK_UNAVAILABLE",
    "SOURCE_BLOCK_HASH_MISMATCH",
  ]);
  const deadline = Date.now() + 60_000;
  let lastCode = "UPSTREAM_UNAVAILABLE";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(2_000),
      });
      const payload = (await response.json()) as {
        code?: unknown;
        ok?: unknown;
      };
      if (response.ok && payload.ok === true) return;
      if (typeof payload.code === "string") {
        lastCode = payload.code;
        if (terminalCodes.has(lastCode)) {
          throw new HarnessError(lastCode, messageForHealthCode(lastCode));
        }
      }
    } catch (error) {
      if (error instanceof HarnessError) throw error;
    }
    await delay(1_000);
  }
  throw new HarnessError(lastCode, messageForHealthCode(lastCode));
}

function messageForHealthCode(code: string): string {
  switch (code) {
    case "SOURCE_CHAIN_ID_MISMATCH":
      return "Upstream endpoint is not Arbitrum One (42161).";
    case "SOURCE_BLOCK_UNAVAILABLE":
      return "Upstream endpoint cannot serve the pinned historical block.";
    case "SOURCE_BLOCK_HASH_MISMATCH":
      return "Upstream block hash does not match the pinned source evidence.";
    default:
      return "Read-only upstream RPC is unavailable; endpoint details are suppressed.";
  }
}

export async function waitForAnvil(env: NodeJS.ProcessEnv): Promise<void> {
  const host = env.FORK_BIND_ADDRESS ?? "127.0.0.1";
  const port = env.FORK_LOCAL_HOST_PORT ?? String(config.localRpcPort);
  const endpoint = dockerEndpoint(host, port);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const chainId = await requestJsonRpc(endpoint, "eth_chainId", []);
      const blockNumber = await requestJsonRpc(endpoint, "eth_blockNumber", []);
      const blockTag = `0x${BigInt(config.source.blockNumber).toString(16)}`;
      const block = await requestJsonRpc(endpoint, "eth_getBlockByNumber", [
        blockTag,
        false,
      ]);
      const version = await requestJsonRpc(endpoint, "web3_clientVersion", []);
      if (
        BigInt(String(chainId)) !== BigInt(config.localExecutionChainId) ||
        BigInt(String(blockNumber)) !== BigInt(config.source.blockNumber) ||
        !isRecord(block) ||
        String(block.hash).toLowerCase() !==
          config.source.blockHash.toLowerCase() ||
        typeof version !== "string" ||
        !version.toLowerCase().includes("anvil") ||
        !version.includes(config.anvil.version)
      ) {
        throw new HarnessError(
          "ANVIL_IDENTITY_MISMATCH",
          "Local Anvil chain, source block, or binary version does not match the pinned harness configuration.",
        );
      }
      return;
    } catch (error) {
      if (error instanceof HarnessError) throw error;
    }
    await delay(1_000);
  }
  throw new HarnessError(
    "ANVIL_UNAVAILABLE",
    "Pinned Anvil did not become ready; raw container output is suppressed.",
  );
}

async function requestJsonRpc(
  endpoint: string,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error("LOCAL_RPC_UNAVAILABLE");
  const payload = (await response.json()) as {
    result?: unknown;
    error?: unknown;
  };
  if (payload.error !== undefined || !Object.hasOwn(payload, "result")) {
    throw new Error("LOCAL_RPC_INVALID_RESPONSE");
  }
  return payload.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

export interface ForkRecreationActions {
  readonly prepare: () => void | Promise<void>;
  readonly teardown: () => void | Promise<void>;
  readonly clearMetadata: () => void;
  readonly createInstanceId: () => string;
  readonly start: (instanceId: string) => Promise<void>;
}

export async function recreateFork(
  actions: ForkRecreationActions,
): Promise<string> {
  await actions.prepare();
  await actions.teardown();
  actions.clearMetadata();
  const instanceId = actions.createInstanceId();
  await actions.start(instanceId);
  return instanceId;
}

export async function tryRecoverFork(
  actions: ForkRecreationActions,
): Promise<boolean> {
  try {
    await recreateFork(actions);
    return true;
  } catch {
    return false;
  }
}

function runningServiceId(
  instanceId: string,
  includeUpstream: boolean,
): string {
  const env = composeEnvironment(instanceId, includeUpstream);
  const result = compose(["ps", "--status", "running", "--quiet"], env);
  return requireComposeSuccess(result, "running-service lookup");
}

async function startFresh(instanceId: string): Promise<void> {
  requireUpstreamEndpoint();
  const env = composeEnvironment(instanceId, true);
  checkDockerAndCompose(env);
  await assertHostPortsAvailable(env);

  const running = runningServiceId(instanceId, true);
  if (running !== "") {
    throw new HarnessError(
      "FORK_ALREADY_RUNNING",
      "A fork instance is already running; use smoke, reset, or stop instead of starting a second task.",
    );
  }

  const cleanupEnv = composeEnvironment(instanceId, true);
  requireComposeSuccess(
    compose(["down", "--volumes", "--remove-orphans"], cleanupEnv),
    "stale instance cleanup",
  );
  saveInstanceId(instanceId);
  try {
    requireComposeSuccess(compose(["up", "-d"], env), "start");
    await waitForProxyHealth(env);
    await waitForAnvil(env);
  } catch (error) {
    compose(["down", "--volumes", "--remove-orphans"], env);
    removeLocalMetadata();
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(
      "FORK_START_FAILED",
      "Local fork startup failed; service output is suppressed to protect the upstream endpoint.",
    );
  }
}

async function startCommand(): Promise<void> {
  const existing = readInstanceId();
  const instanceId = existing ?? randomUUID();
  if (existing !== undefined && runningServiceId(existing, true) !== "") {
    throw new HarnessError(
      "FORK_ALREADY_RUNNING",
      "A fork instance is already running; use smoke, reset, or stop instead of starting a second task.",
    );
  }
  await startFresh(instanceId);
  console.log(
    JSON.stringify({
      status: "ready",
      forkInstanceId: instanceId,
      sourceChainId: config.source.chainId,
      sourceBlockNumber: config.source.blockNumber,
      sourceBlockHash: config.source.blockHash,
      localExecutionChainId: config.localExecutionChainId,
      anvilVersion: config.anvil.version,
    }),
  );
}

async function resetCommand(): Promise<void> {
  const instanceId = readInstanceId() ?? randomUUID();
  const env = composeEnvironment(instanceId, true);
  const nextInstanceId = await recreateFork({
    prepare: () => {
      requireUpstreamEndpoint();
      checkDockerAndCompose(env);
    },
    teardown: () => {
      requireComposeSuccess(
        compose(["down", "--volumes", "--remove-orphans"], env),
        "reset teardown",
      );
    },
    clearMetadata: removeLocalMetadata,
    createInstanceId: randomUUID,
    start: startFresh,
  });
  console.log(
    JSON.stringify({
      status: "reset",
      forkInstanceId: nextInstanceId,
      sourceBlockNumber: config.source.blockNumber,
      localExecutionChainId: config.localExecutionChainId,
    }),
  );
}

function stopCommand(destroy: boolean): void {
  const instanceId = readInstanceId() ?? randomUUID();
  const env = composeEnvironment(instanceId, false);
  checkDockerAndCompose(env);
  requireComposeSuccess(
    compose(["down", "--volumes", "--remove-orphans"], env),
    destroy ? "destroy" : "stop",
  );
  removeLocalMetadata();
  console.log(JSON.stringify({ status: destroy ? "destroyed" : "stopped" }));
}

async function smokeCommand(): Promise<void> {
  const instanceId = readInstanceId();
  if (instanceId === undefined) {
    throw new HarnessError(
      "FORK_INSTANCE_ID_UNAVAILABLE",
      "Start the pinned fork on the Mac host before running the read-only smoke.",
    );
  }
  const { sourceUrl, localUrl } = buildSmokeEndpoints();
  const sourceRpc = createArbitrumRpcClient(sourceUrl) as RpcClient;
  const localRpc = createArbitrumRpcClient(localUrl) as RpcClient;

  let evidence: Awaited<ReturnType<typeof runForkQuoteSmoke>>;
  try {
    evidence = await runForkQuoteSmoke({
      sourceRpc,
      localRpc,
      forkInstanceId: instanceId,
    });
  } catch (error) {
    if (error instanceof ForkSmokeError && error.code === "RESET_FAILED") {
      await recoverAfterResetFailure(instanceId);
    }
    throw error;
  }

  writeFileSync(CAPTURE_FILE, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(JSON.stringify({ status: "passed", capture: evidence }, null, 2));
}

function validateLocalEndpoint(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HarnessError(
      "INVALID_LOCAL_ENDPOINT",
      `${label} URL is invalid.`,
    );
  }
  if (
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    !isAllowedLocalHost(url.hostname)
  ) {
    throw new HarnessError(
      "NONLOCAL_RPC_ENDPOINT",
      `${label} must use a credential-free HTTP endpoint on loopback, host.docker.internal, or a private IPv4 address.`,
    );
  }
}

export function isAllowedLocalHost(host: string): boolean {
  if (host === "localhost" || host === "host.docker.internal") return true;
  if (isIP(host) === 4) return isPrivateBindAddress(host);
  if (host === "::1" || host === "[::1]") return true;
  return false;
}

async function recoverAfterResetFailure(instanceId: string): Promise<void> {
  let env: NodeJS.ProcessEnv | undefined;
  const recovered = await tryRecoverFork({
    prepare: () => {
      requireUpstreamEndpoint();
      env = composeEnvironment(instanceId, true);
      checkDockerAndCompose(env);
    },
    teardown: () => {
      if (env === undefined) {
        throw new HarnessError(
          "RECOVERY_NOT_PREPARED",
          "Fork recovery could not be prepared.",
        );
      }
      requireComposeSuccess(
        compose(["down", "--volumes", "--remove-orphans"], env),
        "reset recovery teardown",
      );
    },
    clearMetadata: removeLocalMetadata,
    createInstanceId: randomUUID,
    start: startFresh,
  });
  if (recovered) {
    console.error(
      "Snapshot reset failed; the fork was destroyed and recreated. Rerun smoke; no evidence was written for the failed run.",
    );
    return;
  }
  console.error(
    "Snapshot reset failed. Run the host `reset` command to destroy and recreate the fork; no evidence was written for the failed run.",
  );
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (
    !action ||
    !["start", "smoke", "reset", "stop", "destroy"].includes(action)
  ) {
    throw new HarnessError(
      "INVALID_COMMAND",
      "Usage: manager.ts start|smoke|reset|stop|destroy",
    );
  }
  const releaseLock = acquireLock();
  try {
    if (action === "start") await startCommand();
    else if (action === "smoke") await smokeCommand();
    else if (action === "reset") await resetCommand();
    else stopCommand(action === "destroy");
  } finally {
    releaseLock();
  }
}

export async function runForkManager(): Promise<void> {
  await main().catch((error: unknown) => {
    if (error instanceof HarnessError || error instanceof ForkSmokeError) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      console.error(
        "FORK_HARNESS_FAILED: unexpected failure; details suppressed.",
      );
    }
    process.exitCode = 1;
  });
}
