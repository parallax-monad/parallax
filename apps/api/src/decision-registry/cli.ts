import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DecisionAnchorBundleV1 } from "./decision-record.js";
import {
  assertDecisionAnchorMatchesPersistedRun,
  prepareDecisionAnchor,
  verifyDecisionAnchorBundle,
} from "./decision-record.js";
import type { RegistryRuntimeBytecode } from "./rpc.js";
import {
  readRegistryObservation,
  readRpcChainId,
  verifyDecisionAnchorOnchain,
  verifyRegistryDeployment,
} from "./rpc.js";

const defaultChainId = 421614;
const registryAddressPattern = /^0x[a-fA-F0-9]{40}$/u;
const zeroAddress = `0x${"0".repeat(40)}`;
const zeroBytes32 = `0x${"0".repeat(64)}`;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const foundryProject = path.join(repositoryRoot, "contracts/decision-registry");

type Options = Map<string, string>;

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "help") {
    printUsage();
    return;
  }
  const options = parseOptions(arguments_);

  switch (command) {
    case "prepare":
      await prepare(options);
      return;
    case "deploy":
      await deploy(options);
      return;
    case "verify-deployment":
      await verifyDeployment(options);
      return;
    case "anchor":
      await anchor(options);
      return;
    case "verify":
      await verify(options);
      return;
    default:
      throw new Error("Unknown decision-registry command; use --help");
  }
}

async function prepare(options: Options): Promise<void> {
  const apiBaseUrl = requiredOption(options, "api-base-url");
  const runId = requiredOption(options, "run-id");
  const registryAddress = configuredRegistryAddress(options);
  const chainId = configuredChainId(options);
  const outputPath = path.resolve(requiredOption(options, "out"));
  const run = await fetchPersistedRun(apiBaseUrl, runId);
  const bundle = prepareDecisionAnchor(run, { chainId, registryAddress });
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(`Prepared versioned decision bundle: ${outputPath}`);
  console.log(`Run key: ${bundle.runKey}`);
  console.log(`Record hash: ${bundle.recordHash}`);
  console.log(
    "The bundle contains off-chain Run data; keep it private and do not commit it.",
  );
}

async function deploy(options: Options): Promise<void> {
  const account = requiredOption(options, "account");
  const attestor = configuredAttestor();
  const rpcUrl = requireRpcUrl();
  const chainId = await readRpcChainId(rpcUrl);
  if (chainId !== defaultChainId) {
    throw new Error("Refusing deployment: RPC is not Arbitrum Sepolia");
  }
  runFoundry("forge", [
    "create",
    "src/ParallaxDecisionRegistry.sol:ParallaxDecisionRegistry",
    "--constructor-args",
    attestor,
    "--rpc-url",
    "arbitrum_sepolia",
    "--account",
    account,
    "--broadcast",
  ]);
  console.log(
    "Deployment submitted. Save the contract address as PARALLAX_DECISION_REGISTRY_ADDRESS; verify it before preparing any record.",
  );
}

async function verifyDeployment(options: Options): Promise<void> {
  const rpcUrl = requireRpcUrl();
  const runtimeBytecode = await loadRegistryRuntimeBytecode();
  const attestor = configuredAttestor();
  const registryAddress = configuredRegistryAddress(options);
  const result = await verifyRegistryDeployment(
    rpcUrl,
    registryAddress,
    defaultChainId,
    runtimeBytecode,
    attestor,
  );
  console.log(`Deployment verification: ${result.status}`);
  console.log(`Registry: ${result.registryAddress} on chain ${result.chainId}`);
  console.log(`Attestor: ${result.attestor}`);
}

async function anchor(options: Options): Promise<void> {
  const bundle = await readBundle(requiredOption(options, "bundle"));
  const verified = verifyDecisionAnchorBundle(bundle);
  const persistedRun = await fetchPersistedRun(
    requiredOption(options, "api-base-url"),
    bundle.runId,
  );
  assertDecisionAnchorMatchesPersistedRun(bundle, persistedRun);
  const rpcUrl = requireRpcUrl();
  const runtimeBytecode = await loadRegistryRuntimeBytecode();
  const attestor = configuredAttestor();
  const registryAddress = configuredRegistryAddress(options);
  if (
    registryAddress !== bundle.registryAddress.toLowerCase() ||
    bundle.chainId !== defaultChainId
  ) {
    throw new Error(
      "Bundle must target the configured Arbitrum Sepolia Registry",
    );
  }

  const observed = await readRegistryObservation(
    rpcUrl,
    registryAddress,
    verified.runKey,
    bundle.chainId,
    runtimeBytecode,
    attestor,
  );
  if (!observed.deployed) {
    throw new Error(
      "No Registry contract is deployed at the configured address",
    );
  }
  if (observed.commitment === verified.commitment) {
    console.log(
      "This Run is already anchored with the exact same commitment; no transaction sent.",
    );
    return;
  }
  if (observed.commitment !== zeroBytes32) {
    throw new Error(
      "This Run key already has a different immutable commitment",
    );
  }

  const account = requiredOption(options, "account");
  assertAttestorSignerMatches(resolveFoundryAccountAddress(account), attestor);
  runFoundry("cast", [
    "send",
    registryAddress,
    "anchorDecision(bytes32,bytes32)",
    verified.runKey,
    verified.commitment,
    "--rpc-url",
    "arbitrum_sepolia",
    "--account",
    account,
  ]);

  const result = await verifyDecisionAnchorOnchain(
    bundle,
    rpcUrl,
    runtimeBytecode,
    attestor,
  );
  console.log(`Independent verification: ${result.status}`);
  console.log(`Registry: ${result.registryAddress} on chain ${result.chainId}`);
  console.log(`Commitment: ${result.commitment}`);
}

export function assertAttestorSignerMatches(
  signerAddress: string,
  expectedAttestor: string,
): void {
  if (
    !registryAddressPattern.test(signerAddress) ||
    !registryAddressPattern.test(expectedAttestor) ||
    signerAddress.toLowerCase() === zeroAddress ||
    expectedAttestor.toLowerCase() === zeroAddress
  ) {
    throw new Error(
      "Signer and configured attestor must be valid non-zero addresses",
    );
  }
  if (signerAddress.toLowerCase() !== expectedAttestor.toLowerCase()) {
    throw new Error(
      "Selected Foundry account does not match the configured Registry attestor; no transaction sent",
    );
  }
}

function resolveFoundryAccountAddress(account: string): string {
  const result = spawnSync(
    "cast",
    ["wallet", "address", "--account", account],
    {
      cwd: foundryProject,
      env: process.env,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      "Could not resolve the selected Foundry account; no transaction sent",
    );
  }
  const addresses = result.stdout.match(/0x[a-fA-F0-9]{40}/gu) ?? [];
  if (addresses.length !== 1) {
    throw new Error(
      "Foundry returned an invalid signer address; no transaction sent",
    );
  }
  return addresses[0].toLowerCase();
}

async function verify(options: Options): Promise<void> {
  const bundle = await readBundle(requiredOption(options, "bundle"));
  const rpcUrl = requireRpcUrl();
  const runtimeBytecode = await loadRegistryRuntimeBytecode();
  const attestor = configuredAttestor();
  const registryAddress = configuredRegistryAddress(options);
  if (
    bundle.chainId !== defaultChainId ||
    registryAddress !== bundle.registryAddress.toLowerCase()
  ) {
    throw new Error(
      "Bundle must target the configured Arbitrum Sepolia Registry",
    );
  }
  const result = await verifyDecisionAnchorOnchain(
    bundle,
    rpcUrl,
    runtimeBytecode,
    attestor,
  );
  console.log(`Independent verification: ${result.status}`);
  console.log(`Run ID (off-chain only): ${bundle.runId}`);
  console.log(`Registry: ${result.registryAddress} on chain ${result.chainId}`);
  console.log(`Run key: ${result.runKey}`);
  console.log(`Record hash: ${result.recordHash}`);
  console.log(`Commitment: ${result.commitment}`);
}

async function readBundle(filePath: string): Promise<DecisionAnchorBundleV1> {
  let content: string;
  try {
    content = await readFile(path.resolve(filePath), "utf8");
  } catch {
    throw new Error("Could not read the decision bundle file");
  }
  try {
    const bundle = JSON.parse(content) as unknown;
    verifyDecisionAnchorBundle(bundle);
    return bundle as DecisionAnchorBundleV1;
  } catch {
    throw new Error("Decision bundle is not valid JSON");
  }
}

function requireRpcUrl(): string {
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      "Set ARBITRUM_SEPOLIA_RPC_URL in the process environment or approved secret manager",
    );
  }
  return rpcUrl;
}

async function fetchPersistedRun(
  apiBaseUrl: string,
  runId: string,
): Promise<unknown> {
  const apiUrl = new URL(
    `/api/runs/${encodeURIComponent(runId)}`,
    normalizeBaseUrl(apiBaseUrl),
  );
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Could not read the requested persisted Run from the API");
  }
  if (!response.ok) {
    throw new Error(`Run API returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Run API returned invalid JSON");
  }
}

function configuredAttestor(): string {
  const attestor = process.env.PARALLAX_DECISION_REGISTRY_ATTESTOR;
  if (
    !attestor ||
    !registryAddressPattern.test(attestor) ||
    attestor.toLowerCase() === zeroAddress
  ) {
    throw new Error(
      "Set PARALLAX_DECISION_REGISTRY_ATTESTOR to the public attestor address in .env",
    );
  }
  return attestor.toLowerCase();
}

function configuredRegistryAddress(options: Options): string {
  const address =
    option(options, "registry") ??
    process.env.PARALLAX_DECISION_REGISTRY_ADDRESS;
  if (
    !address ||
    !registryAddressPattern.test(address) ||
    address.toLowerCase() === zeroAddress
  ) {
    throw new Error(
      "Set PARALLAX_DECISION_REGISTRY_ADDRESS or pass --registry with a deployed contract address",
    );
  }
  return address.toLowerCase();
}

function configuredChainId(options: Options): number {
  const value = option(options, "chain-id");
  if (value === undefined) return defaultChainId;
  const chainId = Number(value);
  if (!Number.isSafeInteger(chainId) || chainId !== defaultChainId) {
    throw new Error(
      "Decision Registry MVP is configured for Arbitrum Sepolia (421614)",
    );
  }
  return chainId;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("API base URL must be valid HTTP(S)");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("API base URL must not contain embedded credentials");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const localHost =
    hostname === "localhost" ||
    hostname === "::1" ||
    (isIP(hostname) === 4 && hostname.startsWith("127."));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("API base URL must use HTTPS except on loopback");
  }
  return `${url.origin}/`;
}

async function loadRegistryRuntimeBytecode(): Promise<RegistryRuntimeBytecode> {
  runFoundry("forge", ["build"]);
  const artifactPath = path.join(
    foundryProject,
    "out/ParallaxDecisionRegistry.sol/ParallaxDecisionRegistry.json",
  );
  let parsed: {
    deployedBytecode?: { object?: unknown; immutableReferences?: unknown };
  };
  try {
    parsed = JSON.parse(await readFile(artifactPath, "utf8")) as typeof parsed;
  } catch {
    throw new Error("Could not load the compiled Registry bytecode artifact");
  }
  const deployedBytecode = parsed.deployedBytecode;
  if (
    typeof deployedBytecode?.object !== "string" ||
    typeof deployedBytecode.immutableReferences !== "object" ||
    deployedBytecode.immutableReferences === null
  ) {
    throw new Error("Compiled Registry bytecode artifact is invalid");
  }
  return {
    object: deployedBytecode.object,
    immutableReferences:
      deployedBytecode.immutableReferences as RegistryRuntimeBytecode["immutableReferences"],
  };
}

function runFoundry(command: "forge" | "cast", arguments_: string[]): void {
  const result = spawnSync(command, arguments_, {
    cwd: foundryProject,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed; no success is claimed`);
  }
}

function parseOptions(arguments_: string[]): Options {
  const options = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined || !argument.startsWith("--")) {
      throw new Error("Options must use --name value form");
    }
    const name = argument.slice(2);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--") || options.has(name)) {
      throw new Error(`Missing or repeated --${name} option`);
    }
    options.set(name, value);
    index += 1;
  }
  return options;
}

function option(options: Options, name: string): string | undefined {
  return options.get(name);
}

function requiredOption(options: Options, name: string): string {
  const value = option(options, name);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required --${name} option`);
  }
  return value;
}

function printUsage(): void {
  console.log(`
Parallax Decision Registry (Arbitrum Sepolia, chain 421614)

  pnpm --filter @parallax/api decision-registry:deploy -- --account <foundry-keystore-name>
  pnpm --filter @parallax/api decision-registry:verify-deployment -- --registry <contract-address>
  pnpm --filter @parallax/api decision-registry:prepare -- --api-base-url <api-origin> --run-id <run-id> --out <private-json-path>
  pnpm --filter @parallax/api decision-registry:anchor -- --bundle <private-json-path> --api-base-url <api-origin> --account <foundry-keystore-name>
  pnpm --filter @parallax/api decision-registry:verify -- --bundle <private-json-path>

Environment: ARBITRUM_SEPOLIA_RPC_URL, PARALLAX_DECISION_REGISTRY_ATTESTOR,
            PARALLAX_DECISION_REGISTRY_ADDRESS (address is set after deploy).
Signing is through a local Foundry keystore; no raw private key is accepted.
`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Decision Registry failed",
    );
    process.exitCode = 1;
  });
}
