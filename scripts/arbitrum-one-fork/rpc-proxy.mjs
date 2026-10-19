import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const READ_ONLY_UPSTREAM_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_getProof",
  "eth_call",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "net_version",
  "web3_clientVersion",
]);

const MAX_BODY_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const SECRET_PATH = "/run/secrets/upstream_rpc_url";

function hexQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function isReadOnlyUpstreamMethod(method) {
  return typeof method === "string" && READ_ONLY_UPSTREAM_METHODS.has(method);
}

export function validateUpstreamPayload(payload, requestId) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("UPSTREAM_INVALID_RESPONSE");
  }
  if (payload.error !== undefined) {
    const code = Number.isInteger(payload.error?.code)
      ? payload.error.code
      : -32000;
    throw Object.assign(new Error("UPSTREAM_RPC_ERROR"), { rpcCode: code });
  }
  if (!Object.hasOwn(payload, "result")) {
    throw new Error("UPSTREAM_INVALID_RESPONSE");
  }
  return { jsonrpc: "2.0", id: requestId ?? null, result: payload.result };
}

export function createReadOnlyProxy({
  upstreamUrl,
  sourceChainId,
  sourceBlockNumber,
  sourceBlockHash,
  fetchImplementation = globalThis.fetch,
}) {
  const parsedUrl = new URL(upstreamUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("INVALID_RPC_ENDPOINT");
  }
  const blockNumber = BigInt(sourceBlockNumber);
  const expectedHash = String(sourceBlockHash).toLowerCase();
  let healthCache = null;
  let healthCacheAt = 0;
  let nextHealthId = 1;

  async function forward(payload) {
    const response = await fetchImplementation(parsedUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("UPSTREAM_UNAVAILABLE");
    const upstreamPayload = await response.json();
    return validateUpstreamPayload(upstreamPayload, payload.id);
  }

  async function health() {
    if (healthCache !== null && Date.now() - healthCacheAt < 5_000) {
      return healthCache;
    }
    try {
      const chain = await forward({
        jsonrpc: "2.0",
        id: nextHealthId++,
        method: "eth_chainId",
        params: [],
      });
      if (BigInt(chain.result) !== BigInt(sourceChainId)) {
        healthCache = { ok: false, code: "SOURCE_CHAIN_ID_MISMATCH" };
      } else {
        const block = await forward({
          jsonrpc: "2.0",
          id: nextHealthId++,
          method: "eth_getBlockByNumber",
          params: [hexQuantity(blockNumber), false],
        });
        if (block.result === null) {
          healthCache = { ok: false, code: "SOURCE_BLOCK_UNAVAILABLE" };
        } else if (
          BigInt(block.result.number) !== blockNumber ||
          String(block.result.hash).toLowerCase() !== expectedHash
        ) {
          healthCache = { ok: false, code: "SOURCE_BLOCK_HASH_MISMATCH" };
        } else {
          healthCache = {
            ok: true,
            sourceChainId: Number(sourceChainId),
            sourceBlockNumber: blockNumber.toString(),
            sourceBlockHash: expectedHash,
          };
        }
      }
    } catch {
      healthCache = { ok: false, code: "UPSTREAM_UNAVAILABLE" };
    }
    healthCacheAt = Date.now();
    return healthCache;
  }

  async function handleCall(payload) {
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      payload.jsonrpc !== "2.0" ||
      typeof payload.method !== "string"
    ) {
      return jsonRpcError(payload?.id, -32600, "Invalid JSON-RPC request");
    }
    if (!isReadOnlyUpstreamMethod(payload.method)) {
      return jsonRpcError(payload.id, -32601, "Read-only RPC method required");
    }
    try {
      return await forward({
        jsonrpc: "2.0",
        id: payload.id ?? null,
        method: payload.method,
        params: Array.isArray(payload.params) ? payload.params : [],
      });
    } catch (error) {
      const code = Number.isInteger(error?.rpcCode) ? error.rpcCode : -32000;
      return jsonRpcError(
        payload.id,
        code,
        "Upstream read-only RPC request failed",
      );
    }
  }

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      const result = await health();
      sendJson(response, result.ok ? 200 : 503, result);
      return;
    }
    if (request.method !== "POST" || request.url !== "/") {
      sendJson(response, 404, { code: "NOT_FOUND" });
      return;
    }
    let payload;
    try {
      payload = await readBody(request);
    } catch (error) {
      sendJson(response, error?.message === "REQUEST_TOO_LARGE" ? 413 : 400, {
        code:
          error?.message === "REQUEST_TOO_LARGE"
            ? "REQUEST_TOO_LARGE"
            : "INVALID_JSON",
      });
      return;
    }
    const result = Array.isArray(payload)
      ? await Promise.all(payload.map(handleCall))
      : await handleCall(payload);
    sendJson(response, 200, result);
  });
}

async function main() {
  let upstreamUrl;
  let configuration;
  try {
    upstreamUrl = readFileSync(SECRET_PATH, "utf8").trim();
    if (upstreamUrl === "") throw new Error("INVALID_RPC_ENDPOINT");
    configuration = {
      sourceChainId: process.env.SOURCE_CHAIN_ID,
      sourceBlockNumber: process.env.SOURCE_BLOCK_NUMBER,
      sourceBlockHash: process.env.SOURCE_BLOCK_HASH,
    };
  } catch {
    console.error("read-only RPC proxy configuration unavailable");
    process.exitCode = 1;
    return;
  }

  let server;
  try {
    server = createReadOnlyProxy({ upstreamUrl, ...configuration });
  } catch {
    console.error("read-only RPC proxy endpoint is invalid");
    process.exitCode = 1;
    return;
  }

  const port = Number(process.env.RPC_PROXY_PORT ?? "18546");
  server.on("error", () => {
    console.error("read-only RPC proxy failed to bind");
    process.exitCode = 1;
  });
  server.listen(port, "0.0.0.0", () => {
    console.log("read-only RPC proxy ready");
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
