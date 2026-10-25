import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  linkSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, isIP } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createArbitrumRpcClient } from "../../apps/api/src/backend/arbitrum-chain-adapter.js";
import { prepareArbitrumOneTransaction } from "../../apps/api/src/backend/arbitrum-one-transaction.js";
import {
  createReadOnlyForkRpcClient,
  ForkSmokeError,
  getForkHarnessConfig,
  type RpcClient,
  readArbitrumOnePinnedQuote,
  runForkQuoteSmoke,
} from "./smoke.js";
import { runForkTransactionSimulation } from "./transaction-smoke.js";

export class HarnessError extends Error {
  readonly code: string;
  readonly rpcProbeFailure: LocalRpcProbeFailure | undefined;
  readonly composeFailureClass: ComposeStartFailureClass | undefined;

  constructor(
    code: string,
    message: string,
    rpcProbeFailure?: LocalRpcProbeFailure,
    composeFailureClass?: ComposeStartFailureClass,
  ) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
    this.rpcProbeFailure = rpcProbeFailure;
    this.composeFailureClass = composeFailureClass;
  }
}

const GIT_REPOSITORY_OVERRIDE_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
] as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const COMPOSE_FILE = join(SCRIPT_DIR, "compose.yaml");
const config = getForkHarnessConfig();
const CHECKOUT_ID_FILE = gitPath("parallax-arbitrum-one-fork.checkout-id");
const INSTANCE_FILE = gitPath("parallax-arbitrum-one-fork.instance");
const CAPTURE_FILE = gitPath("parallax-arbitrum-one-fork-capture.json");
const TRANSACTION_CAPTURE_FILE = gitPath(
  "parallax-arbitrum-one-fork-transaction-capture.json",
);
const LOCK_FILE = gitPath("parallax-arbitrum-one-fork.lock");
const FORK_SOURCE_ENV = "ARBITRUM_ONE_FORK_UPSTREAM_RPC_URL";
const DOCKER_COMMAND_TIMEOUT_MS = 120_000;
const DOCKER_OUTPUT_MAX_BUFFER_BYTES = 1024 * 1024;
const START_FAILURE_DIAGNOSTIC_BUDGET_MS = 15_000;
const COMPOSE_FAILURE_CLASSIFY_MAX_CHARS = 8_192;
const CHECKOUT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DockerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly composeFailureClass?: ComposeStartFailureClass;
}

type LocalRpcProbePhase =
  | "eth_chainId"
  | "eth_blockNumber"
  | "eth_getBlockByNumber"
  | "web3_clientVersion"
  | "response_validation"
  | "unknown";

type LocalRpcErrorClass =
  | "CONNECTION_REFUSED"
  | "CONNECTION_ERROR"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "TRANSPORT_ERROR"
  | "UNKNOWN";

export interface LocalRpcProbeFailure {
  readonly phase: LocalRpcProbePhase;
  readonly errorClass: LocalRpcErrorClass;
}

type ForkComposeServiceName = "rpc-proxy" | "anvil" | "anvil-host-forwarder";

type ComposeServiceState =
  | "created"
  | "restarting"
  | "running"
  | "removing"
  | "paused"
  | "exited"
  | "dead"
  | "unknown";

type ComposeServiceHealth =
  | "healthy"
  | "unhealthy"
  | "starting"
  | "not_configured"
  | "unknown";

interface PublishedPortMapping {
  readonly targetPort: number;
  readonly publishedPort: number | null;
  readonly protocol: "tcp" | "udp";
}

export interface StartFailureService {
  readonly service: ForkComposeServiceName;
  readonly state: ComposeServiceState;
  readonly health: ComposeServiceHealth;
  readonly publishedPorts: readonly PublishedPortMapping[];
  readonly healthcheckExitCodes: readonly number[] | null;
  readonly forwarderInspection?: ForwarderContainerInspection | null;
}

type HostAddressClass =
  | "loopback"
  | "private"
  | "unspecified"
  | "other"
  | "unknown";

interface SanitizedHostPortBinding {
  readonly publishedPort: number | null;
  readonly hostAddressClass: HostAddressClass;
  readonly hostAddressMatchesExpected: boolean | null;
}

interface ForwarderComposeLabels {
  readonly project: string | null;
  readonly service: string | null;
  readonly configHash: string | null;
}

interface ForwarderNetwork {
  readonly name: string;
  readonly internal: boolean | null;
}

export interface ForwarderContainerInspection {
  readonly hostConfigPortBindings: readonly SanitizedHostPortBinding[] | null;
  readonly networkSettingsPorts: readonly SanitizedHostPortBinding[] | null;
  readonly composeLabels: ForwarderComposeLabels;
  readonly networks: readonly ForwarderNetwork[] | null;
}

interface ExpectedForwarderBinding {
  readonly targetPort: 8546;
  readonly publishedPort: number | null;
  readonly hostAddressClass: HostAddressClass;
}

type StartFailureCode = "ANVIL_UNAVAILABLE" | "COMPOSE_OPERATION_FAILED";

export type ComposeStartFailureClass =
  | "HOST_PORT_BIND_FAILED"
  | "IMAGE_PULL_FAILED"
  | "BIND_MOUNT_FAILED"
  | "NETWORK_SETUP_FAILED"
  | "DEPENDENCY_HEALTHCHECK_FAILED"
  | "CONTAINER_RUNTIME_START_FAILED"
  | "RESOURCE_EXHAUSTED"
  | "DOCKER_DAEMON_UNAVAILABLE"
  | "COMPOSE_CONFIGURATION_INVALID"
  | "UNCLASSIFIED_COMPOSE_FAILURE";

const COMPOSE_START_FAILURE_PATTERNS: readonly {
  readonly classification: ComposeStartFailureClass;
  readonly pattern: RegExp;
}[] = [
  {
    classification: "HOST_PORT_BIND_FAILED",
    pattern:
      /failed to bind host port|ports? are not available|address already in use|port is already allocated|cannot assign requested address/i,
  },
  {
    classification: "IMAGE_PULL_FAILED",
    pattern:
      /pull access denied|manifest unknown|no matching manifest|failed to pull|failed to resolve (?:source metadata|reference)|could not resolve reference|repository does not exist/i,
  },
  {
    classification: "BIND_MOUNT_FAILED",
    pattern:
      /mounts denied|bind source path does not exist|invalid mount config for type ["']bind|not shared from the host|failed to mount/i,
  },
  {
    classification: "DEPENDENCY_HEALTHCHECK_FAILED",
    pattern:
      /dependency failed to start|depends on service .* which is unhealthy|dependency .* is unhealthy/i,
  },
  {
    classification: "NETWORK_SETUP_FAILED",
    pattern:
      /failed to create (?:network|endpoint)|network .* not found|could not find an available, non-overlapping ipv4 address pool|driver failed programming external connectivity/i,
  },
  {
    classification: "CONTAINER_RUNTIME_START_FAILED",
    pattern:
      /failed to create shim task|failed to create task for container|oci runtime create failed|failed to start container|error creating container/i,
  },
  {
    classification: "RESOURCE_EXHAUSTED",
    pattern:
      /no space left on device|out of memory|cannot allocate memory|resource temporarily unavailable|too many open files/i,
  },
  {
    classification: "DOCKER_DAEMON_UNAVAILABLE",
    pattern:
      /cannot connect to the docker daemon|error during connect|is the docker daemon running|daemon is not running/i,
  },
  {
    classification: "COMPOSE_CONFIGURATION_INVALID",
    pattern:
      /yaml: line \d+|invalid compose file|additional properties (?:are )?not allowed|unsupported config option|unknown flag:|no configuration file provided|failed to parse/i,
  },
];

export function classifyComposeStartFailure(
  stdout: string,
  stderr: string,
): ComposeStartFailureClass {
  const boundedOutput = [stdout, stderr]
    .map((output) => {
      if (output.length <= COMPOSE_FAILURE_CLASSIFY_MAX_CHARS) return output;
      const halfLength = Math.floor(COMPOSE_FAILURE_CLASSIFY_MAX_CHARS / 2);
      return `${output.slice(0, halfLength)}\n${output.slice(-halfLength)}`;
    })
    .join("\n")
    .toLowerCase();
  return (
    COMPOSE_START_FAILURE_PATTERNS.find(({ pattern }) =>
      pattern.test(boundedOutput),
    )?.classification ?? "UNCLASSIFIED_COMPOSE_FAILURE"
  );
}

export interface StartFailureDiagnostics {
  readonly code: StartFailureCode;
  readonly failureClassification:
    | "LOCAL_RPC_UNAVAILABLE"
    | "COMPOSE_START_FAILED";
  readonly findings: readonly string[];
  readonly composeFailureClass?: ComposeStartFailureClass;
  readonly rpcProbe?: LocalRpcProbeFailure;
  readonly composeStatus: "available" | "unavailable";
  readonly services: readonly StartFailureService[];
  readonly forwarder: {
    readonly expected: ExpectedForwarderBinding;
    readonly actual: ForwarderContainerInspection | null;
  };
}

function gitEnvironment(
  repositoryRoot: string,
  gitDirectory?: string,
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of GIT_REPOSITORY_OVERRIDE_ENV) delete env[key];
  if (gitDirectory !== undefined) {
    env.GIT_DIR = gitDirectory;
    env.GIT_WORK_TREE = repositoryRoot;
  }
  return env;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function sameGitDirectoryIdentity(
  firstPath: string,
  secondPath: string,
  resolvePath: (path: string) => string = realpathSync,
): boolean {
  let firstRealPath: string;
  let secondRealPath: string;
  try {
    firstRealPath = resolvePath(firstPath);
    secondRealPath = resolvePath(secondPath);
  } catch {
    return false;
  }
  if (firstRealPath === secondRealPath) return true;

  try {
    const firstStats = statSync(firstPath, { bigint: true });
    const secondStats = statSync(secondPath, { bigint: true });
    return (
      firstStats.isDirectory() &&
      secondStats.isDirectory() &&
      firstStats.ino !== 0n &&
      firstStats.dev === secondStats.dev &&
      firstStats.ino === secondStats.ino
    );
  } catch {
    return false;
  }
}

function readMetadataText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
}

function nearestCommonGitDirectory(repositoryRoot: string): string | undefined {
  let ancestor = resolve(repositoryRoot);
  while (true) {
    const candidate = join(ancestor, ".git");
    if (isDirectory(candidate)) {
      try {
        return realpathSync(candidate);
      } catch {
        return undefined;
      }
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) return undefined;
    ancestor = parent;
  }
}

function portableWorktreeGitDirectory(
  repositoryRoot: string,
): string | undefined {
  const worktreeGitFile = join(repositoryRoot, ".git");
  let isGitFile = false;
  try {
    isGitFile = statSync(worktreeGitFile).isFile();
  } catch {
    return undefined;
  }
  if (!isGitFile) return undefined;

  const gitFileContents = readMetadataText(worktreeGitFile);
  const gitFileMatch = /^gitdir:\s*(.+)$/i.exec(gitFileContents ?? "");
  if (gitFileMatch === null) return undefined;
  const declaredGitDirectory = gitFileMatch[1]?.trim();
  if (declaredGitDirectory === undefined || !isAbsolute(declaredGitDirectory)) {
    return undefined;
  }

  const declaredSegments = declaredGitDirectory
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "");
  const gitDirectoryMarker = declaredSegments.lastIndexOf(".git");
  if (
    gitDirectoryMarker < 0 ||
    declaredSegments.length !== gitDirectoryMarker + 3 ||
    declaredSegments[gitDirectoryMarker + 1] !== "worktrees"
  ) {
    return undefined;
  }
  const worktreeId = declaredSegments[gitDirectoryMarker + 2];
  if (
    worktreeId === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(worktreeId)
  ) {
    return undefined;
  }
  const declaredCommonGitDirectory = resolve(declaredGitDirectory, "..", "..");
  if (
    resolve(declaredCommonGitDirectory, "worktrees", worktreeId) !==
    resolve(declaredGitDirectory)
  ) {
    return undefined;
  }

  const commonGitDirectory = nearestCommonGitDirectory(repositoryRoot);
  if (commonGitDirectory === undefined) return undefined;
  const candidate = join(commonGitDirectory, "worktrees", worktreeId);
  if (!isDirectory(candidate)) return undefined;

  let canonicalCandidate: string;
  try {
    canonicalCandidate = realpathSync(candidate);
  } catch {
    return undefined;
  }
  if (
    relative(commonGitDirectory, canonicalCandidate) !==
    join("worktrees", worktreeId)
  ) {
    return undefined;
  }
  if (existsSync(declaredGitDirectory)) {
    if (!sameGitDirectoryIdentity(declaredGitDirectory, canonicalCandidate)) {
      return undefined;
    }
  }

  const commonDirectoryText = readMetadataText(
    join(canonicalCandidate, "commondir"),
  );
  if (commonDirectoryText === undefined) return undefined;
  const reportedCommonDirectory = isAbsolute(commonDirectoryText)
    ? resolve(commonDirectoryText)
    : resolve(canonicalCandidate, commonDirectoryText);
  try {
    if (realpathSync(reportedCommonDirectory) !== commonGitDirectory) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const repositoryRelativePath = relative(
    dirname(commonGitDirectory),
    resolve(repositoryRoot),
  );
  if (
    repositoryRelativePath === "" ||
    repositoryRelativePath === ".." ||
    repositoryRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(repositoryRelativePath)
  ) {
    return undefined;
  }
  const gitDirectoryBacklink = readMetadataText(
    join(canonicalCandidate, "gitdir"),
  );
  if (
    gitDirectoryBacklink === undefined ||
    !isAbsolute(gitDirectoryBacklink) ||
    resolve(gitDirectoryBacklink) !==
      resolve(
        dirname(declaredCommonGitDirectory),
        repositoryRelativePath,
        ".git",
      )
  ) {
    return undefined;
  }

  return canonicalCandidate;
}

function checkoutGitDirectory(repositoryRoot: string): string | undefined {
  const dotGitPath = join(resolve(repositoryRoot), ".git");
  try {
    if (statSync(dotGitPath).isDirectory()) return realpathSync(dotGitPath);
  } catch {
    return undefined;
  }
  return portableWorktreeGitDirectory(repositoryRoot);
}

function runGitMetadataLookup(
  name: string,
  repositoryRoot: string,
  gitDirectory?: string,
) {
  return spawnSync(
    "git",
    [
      "rev-parse",
      "--path-format=absolute",
      "--absolute-git-dir",
      "--show-toplevel",
      "--git-path",
      name,
    ],
    {
      cwd: repositoryRoot,
      env: gitEnvironment(repositoryRoot, gitDirectory),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
}

function validatedGitMetadataPath(
  output: ReturnType<typeof runGitMetadataLookup>,
  name: string,
  repositoryRoot: string,
  expectedGitDirectory: string,
): string | undefined {
  if (output.error !== undefined || output.status !== 0) return undefined;
  const lines = output.stdout.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 3) return undefined;
  const [gitDirectoryText, worktreeRootText, metadataPathText] = lines;
  if (
    gitDirectoryText === undefined ||
    worktreeRootText === undefined ||
    metadataPathText === undefined ||
    !isAbsolute(gitDirectoryText) ||
    !isAbsolute(worktreeRootText) ||
    !isAbsolute(metadataPathText)
  ) {
    return undefined;
  }

  const gitDirectory = resolve(gitDirectoryText);
  const worktreeRoot = resolve(worktreeRootText);
  const metadataPath = resolve(metadataPathText);
  if (
    worktreeRoot !== resolve(repositoryRoot) ||
    gitDirectory !== resolve(expectedGitDirectory) ||
    relative(gitDirectory, metadataPath) !== name
  ) {
    return undefined;
  }
  return metadataPath;
}

function throwGitMetadataFailure(output: {
  readonly error?: Error | null;
  readonly status: number | null;
}): never {
  if (output.error !== undefined && output.error !== null) {
    const errorCode = "code" in output.error ? output.error.code : undefined;
    if (errorCode === "ENOENT") {
      throw new HarnessError(
        "GIT_NOT_FOUND",
        "Git could not be started while resolving this checkout's metadata. Install Git and ensure it is available in PATH.",
      );
    }
    throw new HarnessError(
      "GIT_EXECUTION_FAILED",
      "Git could not inspect this checkout's metadata. Verify that Git can run from the selected worktree.",
    );
  }

  const status =
    output.status === null
      ? ""
      : ` (git rev-parse exited with status ${output.status})`;
  throw new HarnessError(
    "GIT_METADATA_UNAVAILABLE",
    `Could not resolve metadata for this worktree${status}. Verify that its .git pointer and matching worktree metadata are accessible from this host.`,
  );
}

export function resolveGitMetadataPath(
  name: string,
  repositoryRoot = REPO_ROOT,
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new HarnessError(
      "GIT_METADATA_UNAVAILABLE",
      "The requested Git metadata filename is invalid.",
    );
  }

  const initialLookup = runGitMetadataLookup(name, repositoryRoot);
  const expectedGitDirectory = checkoutGitDirectory(repositoryRoot);
  if (expectedGitDirectory === undefined) {
    if (initialLookup.error !== undefined || initialLookup.status !== 0) {
      throwGitMetadataFailure(initialLookup);
    }
    throw new HarnessError(
      "GIT_METADATA_UNAVAILABLE",
      "Could not resolve metadata for this worktree: its .git pointer and worktree backlink do not identify the current checkout.",
    );
  }
  const initialPath = validatedGitMetadataPath(
    initialLookup,
    name,
    repositoryRoot,
    expectedGitDirectory,
  );
  if (initialPath !== undefined) return initialPath;

  const recoveredLookup = runGitMetadataLookup(
    name,
    repositoryRoot,
    expectedGitDirectory,
  );
  const recoveredPath = validatedGitMetadataPath(
    recoveredLookup,
    name,
    repositoryRoot,
    expectedGitDirectory,
  );
  if (recoveredPath !== undefined) return recoveredPath;
  throwGitMetadataFailure(recoveredLookup);
}

function gitPath(name: string): string {
  return resolveGitMetadataPath(name);
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

function sanitizedHostAddressClass(value: unknown): HostAddressClass {
  if (typeof value !== "string") return "unknown";
  const address = value.trim();
  if (address === "" || address === "0.0.0.0" || address === "::") {
    return "unspecified";
  }
  const ipVersion = isIP(address);
  if (ipVersion === 0) return "unknown";
  if (ipVersion === 6) return address === "::1" ? "loopback" : "other";
  if (address.startsWith("127.")) return "loopback";
  return isPrivateBindAddress(address) ? "private" : "other";
}

function expectedForwarderBinding(
  env: NodeJS.ProcessEnv = process.env,
): ExpectedForwarderBinding {
  let publishedPort: number | null = null;
  try {
    publishedPort =
      positivePort(
        configuredPort("FORK_LOCAL_HOST_PORT", config.localRpcPort, env),
      ) ?? null;
  } catch {
    // Keep diagnostics usable without exposing an invalid raw environment value.
  }
  const hostAddress = env.FORK_BIND_ADDRESS?.trim() || "127.0.0.1";
  return {
    targetPort: 8546,
    publishedPort,
    hostAddressClass: sanitizedHostAddressClass(hostAddress),
  };
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

export function runDocker(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = DOCKER_COMMAND_TIMEOUT_MS,
  execute: typeof spawnSync = spawnSync,
): DockerResult {
  const result = execute("docker", [...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: DOCKER_OUTPUT_MAX_BUFFER_BYTES,
  });
  const capturesComposeStartOutput =
    args[0] === "compose" && args.at(-2) === "up" && args.at(-1) === "-d";
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error !== undefined) {
    const composeFailureClass = capturesComposeStartOutput
      ? classifyComposeStartFailure(stdout, stderr)
      : undefined;
    throw new HarnessError(
      "DOCKER_UNAVAILABLE",
      "Docker CLI/daemon is unavailable in this environment.",
      undefined,
      composeFailureClass,
    );
  }
  const composeFailureClass =
    capturesComposeStartOutput && result.status !== 0
      ? classifyComposeStartFailure(stdout, stderr)
      : undefined;
  return {
    status: result.status,
    // Compose's raw startup output is classified in-memory and never leaves this
    // function; downstream diagnostics receive only the allowlisted enum.
    stdout: capturesComposeStartOutput ? "" : stdout,
    ...(composeFailureClass === undefined ? {} : { composeFailureClass }),
  };
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

export function requireComposeSuccess(
  result: DockerResult,
  action: string,
): string {
  if (result.status !== 0) {
    const composeFailureClass =
      action === "start"
        ? (result.composeFailureClass ??
          classifyComposeStartFailure(result.stdout, ""))
        : undefined;
    throw new HarnessError(
      "COMPOSE_OPERATION_FAILED",
      `Docker Compose ${action} failed. Raw output is suppressed to avoid endpoint leakage; check Docker Desktop, ports, and Compose availability.`,
      undefined,
      composeFailureClass,
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
  let lastFailure: LocalRpcProbeFailure = {
    phase: "eth_chainId",
    errorClass: "UNKNOWN",
  };
  while (Date.now() < deadline) {
    let phase: LocalRpcProbePhase = "eth_chainId";
    try {
      const chainId = await requestJsonRpc(endpoint, "eth_chainId", []);
      phase = "eth_blockNumber";
      const blockNumber = await requestJsonRpc(endpoint, "eth_blockNumber", []);
      const blockTag = `0x${BigInt(config.source.blockNumber).toString(16)}`;
      phase = "eth_getBlockByNumber";
      const block = await requestJsonRpc(endpoint, "eth_getBlockByNumber", [
        blockTag,
        false,
      ]);
      phase = "web3_clientVersion";
      const version = await requestJsonRpc(endpoint, "web3_clientVersion", []);
      phase = "response_validation";
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
      lastFailure = {
        phase,
        errorClass: classifyLocalRpcError(error),
      };
    }
    await delay(1_000);
  }
  throw new HarnessError(
    "ANVIL_UNAVAILABLE",
    "Pinned Anvil did not become ready; raw container output is suppressed.",
    lastFailure,
  );
}

export function classifyLocalRpcError(error: unknown): LocalRpcErrorClass {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null; depth += 1) {
    if (current instanceof Error) {
      if (current.name === "TimeoutError" || current.name === "AbortError") {
        return "TIMEOUT";
      }
      if (current.message === "LOCAL_RPC_INVALID_RESPONSE") {
        return "INVALID_RESPONSE";
      }
      if (current.message === "LOCAL_RPC_UNAVAILABLE") return "HTTP_ERROR";
      if (current instanceof SyntaxError) return "INVALID_RESPONSE";
    }
    if (!isRecord(current)) break;
    const code = typeof current.code === "string" ? current.code : "";
    if (code === "ECONNREFUSED") return "CONNECTION_REFUSED";
    if (
      code === "ETIMEDOUT" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "ABORT_ERR"
    ) {
      return "TIMEOUT";
    }
    if (
      code === "ECONNRESET" ||
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH"
    ) {
      return "CONNECTION_ERROR";
    }
    current = current.cause;
  }
  return error instanceof Error ? "TRANSPORT_ERROR" : "UNKNOWN";
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

const FORK_COMPOSE_SERVICE_NAMES = new Set<ForkComposeServiceName>([
  "rpc-proxy",
  "anvil",
  "anvil-host-forwarder",
]);

function parseComposePsRows(
  stdout: string,
): readonly Record<string, unknown>[] | undefined {
  const trimmed = stdout.trim();
  if (trimmed === "") return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.filter(isRecord);
    if (isRecord(parsed)) return [parsed];
    return undefined;
  } catch {
    const rows: Record<string, unknown>[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) return undefined;
        rows.push(parsed);
      } catch {
        return undefined;
      }
    }
    return rows;
  }
}

function composeContainerId(row: Record<string, unknown>): string | undefined {
  const id = row.ID ?? row.Id ?? row.id;
  return typeof id === "string" && /^[a-f0-9]{12,64}$/i.test(id)
    ? id
    : undefined;
}

function composeServiceName(
  row: Record<string, unknown>,
): ForkComposeServiceName | undefined {
  const service = row.Service ?? row.service;
  return typeof service === "string" &&
    FORK_COMPOSE_SERVICE_NAMES.has(service as ForkComposeServiceName)
    ? (service as ForkComposeServiceName)
    : undefined;
}

function positivePort(value: unknown): number | undefined {
  const port =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? port
    : undefined;
}

function composeServiceState(value: unknown): ComposeServiceState {
  const state = typeof value === "string" ? value.toLowerCase() : "";
  switch (state) {
    case "created":
    case "restarting":
    case "running":
    case "removing":
    case "paused":
    case "exited":
    case "dead":
      return state;
    default:
      return "unknown";
  }
}

function composeServiceHealth(value: unknown): ComposeServiceHealth {
  const health = typeof value === "string" ? value.toLowerCase() : "";
  switch (health) {
    case "healthy":
    case "unhealthy":
    case "starting":
      return health;
    case "":
      return "not_configured";
    default:
      return "unknown";
  }
}

function publishedPortMappings(
  value: unknown,
): readonly PublishedPortMapping[] {
  if (!Array.isArray(value)) return [];
  const mappings: PublishedPortMapping[] = [];
  for (const publisher of value) {
    if (!isRecord(publisher)) continue;
    const targetPort = positivePort(
      publisher.TargetPort ?? publisher.targetPort,
    );
    const protocol = publisher.Protocol ?? publisher.protocol;
    if (
      targetPort === undefined ||
      (protocol !== "tcp" && protocol !== "udp")
    ) {
      continue;
    }
    mappings.push({
      targetPort,
      publishedPort:
        positivePort(publisher.PublishedPort ?? publisher.publishedPort) ??
        null,
      protocol,
    });
  }
  return mappings;
}

function sanitizedHostPortBindings(
  value: unknown,
  expectedHostAddress: string,
): readonly SanitizedHostPortBinding[] | null {
  if (value === null) return [];
  if (!Array.isArray(value)) return null;
  return value.map((binding) => {
    if (!isRecord(binding)) {
      return {
        publishedPort: null,
        hostAddressClass: "unknown",
        hostAddressMatchesExpected: null,
      };
    }
    const hostIp = binding.HostIp;
    return {
      publishedPort: positivePort(binding.HostPort) ?? null,
      hostAddressClass: sanitizedHostAddressClass(hostIp),
      hostAddressMatchesExpected:
        typeof hostIp === "string"
          ? hostIp.trim() === expectedHostAddress
          : null,
    };
  });
}

function sanitizedComposeProjectLabel(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z0-9][a-z0-9_-]*$/.test(value)
    ? value
    : null;
}

function sanitizedComposeServiceLabel(value: unknown): string | null {
  return value === "anvil-host-forwarder" ? value : null;
}

function sanitizedComposeConfigHash(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function sanitizeForwarderInspectOutput(
  stdout: string,
  expectedHostAddress = "127.0.0.1",
  readNetworkInternal: (networkName: string) => boolean | null = () => null,
): ForwarderContainerInspection | undefined {
  const lines = stdout.split(/\r?\n/);
  if (lines.length < 5) return undefined;
  const selected: unknown[] = [];
  for (const line of lines.slice(0, 5)) {
    try {
      selected.push(JSON.parse(line) as unknown);
    } catch {
      return undefined;
    }
  }

  const rawNetworkNames = lines
    .slice(5)
    .join(" ")
    .split(/\s+/)
    .filter((name) => name !== "");
  const validNetworkNames = rawNetworkNames.every((name) =>
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name),
  );
  let networks: readonly ForwarderNetwork[] | null = null;
  if (validNetworkNames) {
    networks = [...new Set(rawNetworkNames)].map((name) => {
      let internal: boolean | null;
      try {
        internal = readNetworkInternal(name);
      } catch {
        internal = null;
      }
      return {
        name,
        internal: typeof internal === "boolean" ? internal : null,
      };
    });
  }

  return {
    hostConfigPortBindings: sanitizedHostPortBindings(
      selected[0],
      expectedHostAddress,
    ),
    networkSettingsPorts: sanitizedHostPortBindings(
      selected[1],
      expectedHostAddress,
    ),
    composeLabels: {
      project: sanitizedComposeProjectLabel(selected[2]),
      service: sanitizedComposeServiceLabel(selected[3]),
      configHash: sanitizedComposeConfigHash(selected[4]),
    },
    networks,
  };
}

function sanitizedHealthcheckExitCodes(
  value: readonly number[] | null,
): readonly number[] | null {
  if (value === null) return null;
  return value.filter(
    (code) => Number.isSafeInteger(code) && code >= 0 && code <= 255,
  );
}

export function sanitizeComposePsOutput(
  stdout: string,
  readHealthcheckExitCodes: (
    containerId: string,
  ) => readonly number[] | null = () => null,
  readForwarderInspection?: (
    containerId: string,
  ) => ForwarderContainerInspection | undefined,
): readonly StartFailureService[] | undefined {
  const rows = parseComposePsRows(stdout);
  if (rows === undefined) return undefined;
  const services: StartFailureService[] = [];
  for (const row of rows) {
    const service = composeServiceName(row);
    if (service === undefined) continue;
    const id = composeContainerId(row);
    let healthcheckExitCodes: readonly number[] | null = null;
    if (id !== undefined) {
      try {
        healthcheckExitCodes = sanitizedHealthcheckExitCodes(
          readHealthcheckExitCodes(id),
        );
      } catch {
        healthcheckExitCodes = null;
      }
    }
    let forwarderInspection: ForwarderContainerInspection | null | undefined;
    if (
      service === "anvil-host-forwarder" &&
      readForwarderInspection !== undefined
    ) {
      if (id === undefined) {
        forwarderInspection = null;
      } else {
        try {
          forwarderInspection = readForwarderInspection(id) ?? null;
        } catch {
          forwarderInspection = null;
        }
      }
    }
    const sanitizedService: StartFailureService = {
      service,
      state: composeServiceState(row.State ?? row.state),
      health: composeServiceHealth(row.Health ?? row.health),
      publishedPorts: publishedPortMappings(row.Publishers ?? row.publishers),
      healthcheckExitCodes,
      ...(forwarderInspection === undefined ? {} : { forwarderInspection }),
    };
    services.push(sanitizedService);
  }
  return services;
}

type ExpectedBindingStatus = "matches" | "absent" | "mismatch" | "unavailable";

function expectedBindingStatus(
  bindings: readonly SanitizedHostPortBinding[] | null,
  expected: ExpectedForwarderBinding,
): ExpectedBindingStatus {
  if (bindings === null || expected.publishedPort === null)
    return "unavailable";
  if (bindings.length === 0) return "absent";
  if (
    bindings.some(
      (binding) =>
        binding.publishedPort === expected.publishedPort &&
        binding.hostAddressClass === expected.hostAddressClass &&
        binding.hostAddressMatchesExpected === true,
    )
  ) {
    return "matches";
  }
  if (
    bindings.some(
      (binding) =>
        binding.publishedPort === null ||
        binding.hostAddressClass === "unknown" ||
        binding.hostAddressMatchesExpected === null,
    )
  ) {
    return "unavailable";
  }
  return "mismatch";
}

export function buildStartFailureDiagnostics(
  rpcProbe: LocalRpcProbeFailure | undefined,
  services: readonly StartFailureService[] | undefined,
  expected: ExpectedForwarderBinding = expectedForwarderBinding(),
  code: StartFailureCode = "ANVIL_UNAVAILABLE",
  composeFailureClass?: ComposeStartFailureClass,
): StartFailureDiagnostics {
  const findings =
    code === "COMPOSE_OPERATION_FAILED"
      ? ["COMPOSE_START_FAILED"]
      : ["HOST_FORWARDER_RPC_PROBE_FAILED"];
  if (services === undefined) {
    findings.push("COMPOSE_STATUS_UNAVAILABLE");
  } else {
    const forwarder = services.filter(
      (service) => service.service === "anvil-host-forwarder",
    );
    const hasPublishedLocalRpcPort = forwarder.some((service) =>
      service.publishedPorts.some(
        (port) =>
          port.targetPort === 8546 &&
          port.protocol === "tcp" &&
          port.publishedPort !== null,
      ),
    );
    if (!hasPublishedLocalRpcPort) findings.push("HOST_PORT_UNPUBLISHED");

    for (const expectedService of FORK_COMPOSE_SERVICE_NAMES) {
      const matching = services.filter(
        (service) => service.service === expectedService,
      );
      if (matching.length === 0) {
        findings.push("SERVICE_MISSING");
        continue;
      }
      if (
        matching.some(
          (service) => service.state === "exited" || service.state === "dead",
        )
      ) {
        findings.push("SERVICE_STOPPED");
      } else if (matching.some((service) => service.state !== "running")) {
        findings.push("SERVICE_NOT_RUNNING");
      }
      if (matching.some((service) => service.health === "unhealthy")) {
        findings.push("SERVICE_UNHEALTHY");
      }
      if (matching.some((service) => service.health === "starting")) {
        findings.push("SERVICE_HEALTHCHECK_PENDING");
      }
    }
  }
  const forwarderService = services?.find(
    (service) => service.service === "anvil-host-forwarder",
  );
  const inspection = forwarderService?.forwarderInspection;
  if (inspection === null) {
    findings.push("FORWARDER_INSPECT_UNAVAILABLE");
  } else if (inspection !== undefined) {
    const hostConfigStatus = expectedBindingStatus(
      inspection.hostConfigPortBindings,
      expected,
    );
    const networkSettingsStatus = expectedBindingStatus(
      inspection.networkSettingsPorts,
      expected,
    );
    if (hostConfigStatus === "absent") {
      findings.push("FORWARDER_HOSTCONFIG_BINDING_ABSENT");
    } else if (hostConfigStatus === "mismatch") {
      findings.push("FORWARDER_HOSTCONFIG_BINDING_MISMATCH");
    } else if (hostConfigStatus === "unavailable") {
      findings.push("FORWARDER_HOSTCONFIG_BINDING_UNAVAILABLE");
    }
    if (networkSettingsStatus === "absent") {
      findings.push("FORWARDER_NETWORKSETTINGS_BINDING_ABSENT");
    } else if (networkSettingsStatus === "mismatch") {
      findings.push("FORWARDER_NETWORKSETTINGS_BINDING_MISMATCH");
    } else if (networkSettingsStatus === "unavailable") {
      findings.push("FORWARDER_NETWORKSETTINGS_BINDING_UNAVAILABLE");
    }
    if (hostConfigStatus === "matches" && networkSettingsStatus === "absent") {
      findings.push("FORWARDER_BINDING_NOT_APPLIED_TO_NETWORKSETTINGS");
    } else if (
      hostConfigStatus === "matches" &&
      networkSettingsStatus === "matches" &&
      rpcProbe?.errorClass === "CONNECTION_REFUSED"
    ) {
      findings.push("HOST_PORT_BINDING_PRESENT_CONNECTION_REFUSED");
    }
  }
  return {
    code,
    failureClassification:
      code === "COMPOSE_OPERATION_FAILED"
        ? "COMPOSE_START_FAILED"
        : "LOCAL_RPC_UNAVAILABLE",
    findings: [...new Set(findings)],
    ...(code === "COMPOSE_OPERATION_FAILED"
      ? {
          composeFailureClass:
            composeFailureClass ?? "UNCLASSIFIED_COMPOSE_FAILURE",
        }
      : {}),
    ...(rpcProbe === undefined ? {} : { rpcProbe }),
    composeStatus: services === undefined ? "unavailable" : "available",
    services: services ?? [],
    forwarder: {
      expected,
      actual: inspection ?? null,
    },
  };
}

const FORWARDER_INSPECT_TEMPLATE = [
  '{{json (index .HostConfig.PortBindings "8546/tcp")}}',
  '{{json (index .NetworkSettings.Ports "8546/tcp")}}',
  '{{json (index .Config.Labels "com.docker.compose.project")}}',
  '{{json (index .Config.Labels "com.docker.compose.service")}}',
  '{{json (index .Config.Labels "com.docker.compose.config-hash")}}',
  "{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}",
].join("\n");

const HEALTHCHECK_EXIT_CODE_TEMPLATE =
  "{{if .State.Health}}{{range .State.Health.Log}}{{.ExitCode}} {{end}}{{else}}NO_HEALTHCHECK{{end}}";

type DiagnosticDockerRunner = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) => DockerResult;

interface DiagnosticDockerBudget {
  readonly deadline: number;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => number;
  readonly runDocker: DiagnosticDockerRunner;
}

function runDockerWithinDiagnosticBudget(
  args: readonly string[],
  budget: DiagnosticDockerBudget,
): DockerResult | undefined {
  const remainingMs = Math.min(
    DOCKER_COMMAND_TIMEOUT_MS,
    Math.floor(budget.deadline - budget.now()),
  );
  if (remainingMs <= 0) return undefined;
  return budget.runDocker(args, budget.env, remainingMs);
}

function healthcheckExitCodes(
  containerId: string,
  budget: DiagnosticDockerBudget,
): readonly number[] | null {
  const result = runDockerWithinDiagnosticBudget(
    ["inspect", "--format", HEALTHCHECK_EXIT_CODE_TEMPLATE, containerId],
    budget,
  );
  if (result === undefined || result.status !== 0) return null;
  const output = result.stdout.trim();
  if (output === "NO_HEALTHCHECK" || output === "") return [];
  const values = output.split(/\s+/);
  if (!values.every((value) => /^\d+$/.test(value))) return null;
  return values.map(Number).filter((value) => value >= 0 && value <= 255);
}

function networkInternal(
  networkName: string,
  budget: DiagnosticDockerBudget,
): boolean | null {
  const result = runDockerWithinDiagnosticBudget(
    ["network", "inspect", "--format", "{{.Internal}}", networkName],
    budget,
  );
  if (result === undefined || result.status !== 0) return null;
  const output = result.stdout.trim().toLowerCase();
  if (output === "true") return true;
  if (output === "false") return false;
  return null;
}

function forwarderInspection(
  containerId: string,
  budget: DiagnosticDockerBudget,
): ForwarderContainerInspection | undefined {
  const result = runDockerWithinDiagnosticBudget(
    ["inspect", "--format", FORWARDER_INSPECT_TEMPLATE, containerId],
    budget,
  );
  if (result === undefined || result.status !== 0) return undefined;
  const expectedHostAddress =
    budget.env.FORK_BIND_ADDRESS?.trim() || "127.0.0.1";
  return sanitizeForwarderInspectOutput(
    result.stdout,
    expectedHostAddress,
    (networkName) => networkInternal(networkName, budget),
  );
}

export function collectStartFailureDiagnostics(
  env: NodeJS.ProcessEnv,
  error: HarnessError,
  dependencies: {
    readonly now?: () => number;
    readonly runDocker?: DiagnosticDockerRunner;
  } = {},
): StartFailureDiagnostics {
  const now = dependencies.now ?? (() => performance.now());
  const budget: DiagnosticDockerBudget = {
    deadline: now() + START_FAILURE_DIAGNOSTIC_BUDGET_MS,
    env,
    now,
    runDocker: dependencies.runDocker ?? runDocker,
  };
  let services: readonly StartFailureService[] | undefined;
  try {
    const status = runDockerWithinDiagnosticBudget(
      buildComposeArgs(getCheckoutComposeProjectName(), [
        "ps",
        "--all",
        "--format",
        "json",
      ]),
      budget,
    );
    if (status?.status === 0) {
      services = sanitizeComposePsOutput(
        status.stdout,
        (containerId) => healthcheckExitCodes(containerId, budget),
        (containerId) => forwarderInspection(containerId, budget),
      );
    }
  } catch {
    services = undefined;
  }
  const isComposeStartFailure =
    error.code === "COMPOSE_OPERATION_FAILED" ||
    (error.code === "DOCKER_UNAVAILABLE" &&
      error.composeFailureClass !== undefined);
  const code: StartFailureCode = isComposeStartFailure
    ? "COMPOSE_OPERATION_FAILED"
    : "ANVIL_UNAVAILABLE";
  return buildStartFailureDiagnostics(
    code === "ANVIL_UNAVAILABLE"
      ? (error.rpcProbeFailure ?? { phase: "unknown", errorClass: "UNKNOWN" })
      : undefined,
    services,
    expectedForwarderBinding(env),
    code,
    error.composeFailureClass,
  );
}

export interface FailedStartActions {
  readonly collectDiagnostics: () => StartFailureDiagnostics;
  readonly reportDiagnostics: (diagnostics: StartFailureDiagnostics) => void;
  readonly teardown: () => void;
  readonly clearMetadata: () => void;
}

export function cleanUpFailedStart(
  error: unknown,
  actions: FailedStartActions,
): never {
  const composeStartFailure =
    error instanceof HarnessError &&
    (error.code === "COMPOSE_OPERATION_FAILED" ||
      (error.code === "DOCKER_UNAVAILABLE" &&
        error.composeFailureClass !== undefined));
  if (
    error instanceof HarnessError &&
    (error.code === "ANVIL_UNAVAILABLE" || composeStartFailure)
  ) {
    const code: StartFailureCode =
      error.code === "ANVIL_UNAVAILABLE"
        ? "ANVIL_UNAVAILABLE"
        : "COMPOSE_OPERATION_FAILED";
    let diagnostics: StartFailureDiagnostics;
    try {
      diagnostics = actions.collectDiagnostics();
    } catch {
      diagnostics = buildStartFailureDiagnostics(
        code === "ANVIL_UNAVAILABLE"
          ? (error.rpcProbeFailure ?? {
              phase: "unknown",
              errorClass: "UNKNOWN",
            })
          : undefined,
        undefined,
        undefined,
        code,
        error.composeFailureClass,
      );
    }
    try {
      actions.reportDiagnostics(diagnostics);
    } catch {
      // Diagnostics must never prevent fork cleanup or replace the startup error.
    }
  }
  actions.teardown();
  actions.clearMetadata();
  if (error instanceof HarnessError) throw error;
  throw new HarnessError(
    "FORK_START_FAILED",
    "Local fork startup failed; service output is suppressed to protect the upstream endpoint.",
  );
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
    return cleanUpFailedStart(error, {
      collectDiagnostics: () =>
        error instanceof HarnessError
          ? collectStartFailureDiagnostics(env, error)
          : buildStartFailureDiagnostics(
              { phase: "unknown", errorClass: "UNKNOWN" },
              undefined,
              expectedForwarderBinding(env),
            ),
      reportDiagnostics: (diagnostics) =>
        console.error(
          `START_FAILURE_DIAGNOSTICS ${JSON.stringify(diagnostics)}`,
        ),
      teardown: () => compose(["down", "--volumes", "--remove-orphans"], env),
      clearMetadata: removeLocalMetadata,
    });
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
    evidence = await writeCaptureAfterSmoke(CAPTURE_FILE, () =>
      runForkQuoteSmoke({
        sourceRpc,
        localRpc,
        forkInstanceId: instanceId,
      }),
    );
  } catch (error) {
    if (error instanceof ForkSmokeError && error.code === "RESET_FAILED") {
      await recoverAfterResetFailure(instanceId);
    }
    throw error;
  }

  console.log(JSON.stringify({ status: "passed", capture: evidence }, null, 2));
}

async function simulateCommand(): Promise<void> {
  const instanceId = readInstanceId();
  if (instanceId === undefined) {
    throw new HarnessError(
      "FORK_INSTANCE_ID_UNAVAILABLE",
      "Start the pinned fork on the Mac host before running the local transaction simulation.",
    );
  }
  const { sourceUrl, localUrl } = buildSmokeEndpoints();
  const sourceRpc = createArbitrumRpcClient(sourceUrl) as RpcClient;
  const localRpc = createArbitrumRpcClient(localUrl) as RpcClient;
  const senderAddress = `0x${randomBytes(20).toString("hex")}`;
  const quoteObservedAt = new Date().toISOString();
  const quote = await readArbitrumOnePinnedQuote({
    rpc: createReadOnlyForkRpcClient(sourceRpc, "upstream"),
    senderAddress,
    observedAt: quoteObservedAt,
  });
  const preparedTransaction = prepareArbitrumOneTransaction({
    intent: quote.intent,
    quote: quote.quote,
  });

  let evidence: Awaited<ReturnType<typeof runForkTransactionSimulation>>;
  try {
    evidence = await writeCaptureAfterSimulation(TRANSACTION_CAPTURE_FILE, () =>
      runForkTransactionSimulation({
        sourceRpc,
        localRpc,
        forkInstanceId: instanceId,
        intent: quote.intent,
        quote: quote.quote,
        preparedTransaction,
      }),
    );
  } catch (error) {
    if (error instanceof ForkSmokeError && error.code === "RESET_FAILED") {
      await recoverAfterResetFailure(instanceId);
    }
    throw error;
  }

  console.log(
    JSON.stringify({ status: "captured", capture: evidence }, null, 2),
  );
}

export async function writeCaptureAfterSmoke(
  capturePath: string,
  runSmoke: () => Promise<Awaited<ReturnType<typeof runForkQuoteSmoke>>>,
): Promise<Awaited<ReturnType<typeof runForkQuoteSmoke>>> {
  const evidence = await runSmoke();
  writeFileSync(capturePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return evidence;
}

export async function writeCaptureAfterSimulation<T>(
  capturePath: string,
  runSimulation: () => Promise<T>,
): Promise<T> {
  const evidence = await runSimulation();
  writeFileSync(capturePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return evidence;
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
  const queryIndex = url.href.indexOf("?");
  const hashIndex = url.href.indexOf("#");
  if (
    url.pathname !== "/" ||
    (queryIndex !== -1 && (hashIndex === -1 || queryIndex < hashIndex))
  ) {
    throw new HarnessError(
      "UNSUPPORTED_LOCAL_ENDPOINT_TARGET",
      `${label} must use the root path without a query string.`,
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
    !["start", "smoke", "simulate", "reset", "stop", "destroy"].includes(action)
  ) {
    throw new HarnessError(
      "INVALID_COMMAND",
      "Usage: manager.ts start|smoke|simulate|reset|stop|destroy",
    );
  }
  const releaseLock = acquireLock();
  try {
    if (action === "start") await startCommand();
    else if (action === "smoke") await smokeCommand();
    else if (action === "simulate") await simulateCommand();
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
