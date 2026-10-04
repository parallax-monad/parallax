import { isIP } from "node:net";
import { keccak256Hex, verifyDecisionAnchorBundle } from "./decision-record.js";

const zeroBytes32 = `0x${"0".repeat(64)}`;
const commitmentOfSelector = keccak256Hex(
  new TextEncoder().encode("commitmentOf(bytes32)"),
).slice(0, 10);
const attestorSelector = keccak256Hex(
  new TextEncoder().encode("attestor()"),
).slice(0, 10);

export type RegistryObservation = {
  chainId: number;
  deployed: boolean;
  commitment: string;
  attestor?: string;
};

export type RegistryRuntimeBytecode = {
  object: string;
  immutableReferences: Record<string, Array<{ start: number; length: number }>>;
};

export async function verifyRegistryDeployment(
  rpcUrl: string,
  registryAddress: string,
  expectedChainId: number,
  expectedRuntimeBytecode: RegistryRuntimeBytecode,
  expectedAttestor: string,
  request: typeof fetch = fetch,
): Promise<{
  status: "MATCH";
  chainId: number;
  registryAddress: string;
  attestor: string;
}> {
  const observation = await readRegistryObservation(
    rpcUrl,
    registryAddress,
    zeroBytes32,
    expectedChainId,
    expectedRuntimeBytecode,
    expectedAttestor,
    request,
  );
  if (!observation.deployed || observation.attestor === undefined) {
    throw new Error("No verified ParallaxDecisionRegistry deployment found");
  }
  return {
    status: "MATCH",
    chainId: observation.chainId,
    registryAddress: registryAddress.toLowerCase(),
    attestor: observation.attestor,
  };
}

export async function readRpcChainId(
  rpcUrl: string,
  request: typeof fetch = fetch,
): Promise<number> {
  const chainIdHex = await jsonRpc<string>(rpcUrl, "eth_chainId", [], request);
  if (!/^0x[0-9a-f]+$/iu.test(chainIdHex)) {
    throw new Error("RPC returned an invalid chain ID");
  }
  const chainId = Number(BigInt(chainIdHex));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("RPC returned an unsupported chain ID");
  }
  return chainId;
}

export async function readRegistryObservation(
  rpcUrl: string,
  registryAddress: string,
  runKey: string,
  expectedChainId: number,
  expectedRuntimeBytecode: RegistryRuntimeBytecode,
  expectedAttestor: string,
  request: typeof fetch = fetch,
): Promise<RegistryObservation> {
  const chainId = await readRpcChainId(rpcUrl, request);
  if (expectedChainId !== undefined && chainId !== expectedChainId) {
    throw new Error("RPC network does not match the prepared Registry chain");
  }

  const code = await jsonRpc<string>(
    rpcUrl,
    "eth_getCode",
    [registryAddress, "latest"],
    request,
  );
  if (!/^0x(?:[0-9a-f]{2})*$/iu.test(code)) {
    throw new Error("RPC returned invalid contract code");
  }

  let commitment = zeroBytes32;
  let attestor: string | undefined;
  if (code !== "0x") {
    if (!runtimeBytecodeMatches(code, expectedRuntimeBytecode)) {
      throw new Error("Deployed code does not match ParallaxDecisionRegistry");
    }
    const attestorResponse = await jsonRpc<string>(
      rpcUrl,
      "eth_call",
      [{ to: registryAddress, data: attestorSelector }, "latest"],
      request,
    );
    if (!/^0x0{24}[0-9a-f]{40}$/iu.test(attestorResponse)) {
      throw new Error("Registry returned an invalid attestor address");
    }
    attestor = `0x${attestorResponse.slice(-40).toLowerCase()}`;
    if (
      expectedAttestor !== undefined &&
      attestor !== expectedAttestor.toLowerCase()
    ) {
      throw new Error("Registry attestor does not match configured address");
    }
    const data = `${commitmentOfSelector}${runKey.slice(2)}`;
    const response = await jsonRpc<string>(
      rpcUrl,
      "eth_call",
      [{ to: registryAddress, data }, "latest"],
      request,
    );
    if (!/^0x[0-9a-f]{64}$/iu.test(response)) {
      throw new Error("Registry returned an invalid commitment value");
    }
    commitment = response.toLowerCase();
  }

  return {
    chainId,
    deployed: code !== "0x",
    commitment,
    ...(attestor === undefined ? {} : { attestor }),
  };
}

export function runtimeBytecodeMatches(
  deployedCode: string,
  artifact: RegistryRuntimeBytecode,
): boolean {
  if (
    !/^0x(?:[0-9a-f]{2})+$/iu.test(deployedCode) ||
    !/^0x(?:[0-9a-f]{2})+$/iu.test(artifact.object)
  ) {
    return false;
  }
  let normalizedDeployed = deployedCode.toLowerCase();
  let normalizedArtifact = artifact.object.toLowerCase();
  const immutableRanges = Object.values(artifact.immutableReferences).flat();
  for (const range of immutableRanges) {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.length) ||
      range.start < 0 ||
      range.length <= 0 ||
      range.start + range.length > (normalizedArtifact.length - 2) / 2 ||
      range.start + range.length > (normalizedDeployed.length - 2) / 2
    ) {
      return false;
    }
    const start = 2 + range.start * 2;
    const end = start + range.length * 2;
    const zeroed = "0".repeat(range.length * 2);
    normalizedDeployed = `${normalizedDeployed.slice(0, start)}${zeroed}${normalizedDeployed.slice(end)}`;
    normalizedArtifact = `${normalizedArtifact.slice(0, start)}${zeroed}${normalizedArtifact.slice(end)}`;
  }
  return normalizedDeployed === normalizedArtifact;
}

export async function verifyDecisionAnchorOnchain(
  input: unknown,
  rpcUrl: string,
  expectedRuntimeBytecode: RegistryRuntimeBytecode,
  expectedAttestor: string,
  request: typeof fetch = fetch,
): Promise<{
  status: "MATCH";
  runKey: string;
  recordHash: string;
  commitment: string;
  chainId: number;
  registryAddress: string;
}> {
  const verified = verifyDecisionAnchorBundle(input);
  const bundle = input as {
    chainId: number;
    registryAddress: string;
    runKey: string;
  };
  const observation = await readRegistryObservation(
    rpcUrl,
    bundle.registryAddress,
    bundle.runKey,
    bundle.chainId,
    expectedRuntimeBytecode,
    expectedAttestor,
    request,
  );
  if (!observation.deployed) {
    throw new Error("No contract is deployed at the prepared Registry address");
  }
  if (observation.commitment !== verified.commitment) {
    throw new Error("On-chain commitment does not match the prepared Run");
  }
  return {
    status: "MATCH",
    ...verified,
    chainId: observation.chainId,
    registryAddress: bundle.registryAddress.toLowerCase(),
  };
}

let nextRpcId = 1;

async function jsonRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  request: typeof fetch,
): Promise<T> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rpcUrl);
  } catch {
    throw new Error("RPC URL must be a valid HTTP(S) URL");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("RPC URL must use HTTP or HTTPS");
  }
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const localHost =
    hostname === "localhost" ||
    hostname === "::1" ||
    (isIP(hostname) === 4 && hostname.startsWith("127."));
  if (
    parsedUrl.protocol !== "https:" &&
    !(parsedUrl.protocol === "http:" && localHost)
  ) {
    throw new Error("RPC URL must use HTTPS except on loopback");
  }

  const id = nextRpcId++;
  let response: Response;
  try {
    response = await request(parsedUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`RPC request failed for ${method}`);
  }
  if (!response.ok) {
    throw new Error(
      `RPC request for ${method} returned HTTP ${response.status}`,
    );
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new Error(`RPC returned invalid JSON for ${method}`);
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("id" in envelope) ||
    envelope.id !== id
  ) {
    throw new Error(`RPC response ID did not match for ${method}`);
  }
  if ("error" in envelope && envelope.error !== undefined) {
    throw new Error(`RPC returned an error for ${method}`);
  }
  if (!("result" in envelope)) {
    throw new Error(`RPC response omitted result for ${method}`);
  }
  return envelope.result as T;
}
