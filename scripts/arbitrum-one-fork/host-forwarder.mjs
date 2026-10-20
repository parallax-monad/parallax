import { createConnection, createServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FORWARDER_PORT = 8546;
export const FORWARD_TARGET = Object.freeze({
  host: "anvil",
  port: 8545,
});

const FORK_INSTANCE_ID_METHOD = "parallax_forkInstanceId";
const FORK_INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDENTITY_REQUEST_BYTES = 64 * 1024;

function isForkInstanceId(value) {
  return typeof value === "string" && FORK_INSTANCE_ID_PATTERN.test(value);
}

function connectToAnvil() {
  return createConnection(FORWARD_TARGET);
}

function inspectIdentityRequest(buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    if (buffer.length > MAX_IDENTITY_REQUEST_BYTES) return { kind: "forward" };
    const expectedPrefix = Buffer.from("POST /");
    const prefixLength = Math.min(buffer.length, expectedPrefix.length);
    return buffer
      .subarray(0, prefixLength)
      .equals(expectedPrefix.subarray(0, prefixLength))
      ? { kind: "wait" }
      : { kind: "forward" };
  }
  if (headerEnd > 16 * 1024) return { kind: "forward" };

  const headers = buffer
    .subarray(0, headerEnd)
    .toString("latin1")
    .split("\r\n");
  if (headers[0] !== "POST / HTTP/1.1" && headers[0] !== "POST / HTTP/1.0") {
    return { kind: "forward" };
  }
  if (headers.some((header) => /^transfer-encoding\s*:/i.test(header))) {
    return { kind: "forward" };
  }
  const contentLengthHeader = headers.find((header) =>
    /^content-length\s*:/i.test(header),
  );
  if (contentLengthHeader === undefined) return { kind: "forward" };
  const contentLength = contentLengthHeader
    .slice(contentLengthHeader.indexOf(":") + 1)
    .trim();
  if (!/^\d+$/.test(contentLength)) return { kind: "forward" };
  const bodyLength = Number(contentLength);
  if (
    !Number.isSafeInteger(bodyLength) ||
    bodyLength > MAX_IDENTITY_REQUEST_BYTES
  ) {
    return { kind: "forward" };
  }
  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + bodyLength) return { kind: "wait" };

  let payload;
  try {
    payload = JSON.parse(
      buffer.subarray(bodyStart, bodyStart + bodyLength).toString("utf8"),
    );
  } catch {
    return { kind: "forward" };
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    payload.jsonrpc !== "2.0" ||
    payload.method !== FORK_INSTANCE_ID_METHOD ||
    (payload.params !== undefined &&
      (!Array.isArray(payload.params) || payload.params.length !== 0)) ||
    (typeof payload.id !== "string" &&
      !(typeof payload.id === "number" && Number.isFinite(payload.id)))
  ) {
    return { kind: "forward" };
  }
  return { kind: "identity", requestId: payload.id };
}

function sendIdentityResponse(socket, requestId, instanceId) {
  const body = Buffer.from(
    JSON.stringify({ jsonrpc: "2.0", id: requestId, result: instanceId }),
    "utf8",
  );
  socket.end(
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n`,
        "ascii",
      ),
      body,
    ]),
  );
}

export function createForwarderServer(
  connectUpstream = connectToAnvil,
  instanceId = process.env.FORK_INSTANCE_ID,
) {
  const identity = isForkInstanceId(instanceId) ? instanceId : undefined;
  return createServer((downstream) => {
    let buffered = Buffer.alloc(0);
    let routed = false;
    let identityTimeout;

    function routeToAnvil(sourceEnded = false) {
      if (routed) return;
      routed = true;
      if (identityTimeout !== undefined) clearTimeout(identityTimeout);
      downstream.off("data", inspect);
      const upstream = connectUpstream();
      downstream.on("error", () => upstream.destroy());
      upstream.on("error", () => downstream.destroy());
      downstream.on("close", () => upstream.destroy());
      upstream.on("close", () => downstream.destroy());
      if (sourceEnded) {
        upstream.end(buffered);
      } else {
        if (buffered.length > 0) upstream.write(buffered);
        downstream.pipe(upstream);
      }
      upstream.pipe(downstream);
    }

    function inspect(chunk) {
      if (routed) return;
      buffered = Buffer.concat([buffered, chunk]);
      const result =
        identity === undefined
          ? { kind: "forward" }
          : inspectIdentityRequest(buffered);
      if (result.kind === "wait") {
        if (identityTimeout === undefined) {
          identityTimeout = setTimeout(() => routeToAnvil(), 1_000);
          identityTimeout.unref();
        }
        return;
      }
      if (result.kind === "identity") {
        routed = true;
        if (identityTimeout !== undefined) clearTimeout(identityTimeout);
        downstream.off("data", inspect);
        sendIdentityResponse(downstream, result.requestId, identity);
        return;
      }
      routeToAnvil();
    }

    downstream.on("data", inspect);
    downstream.on("end", () => routeToAnvil(true));
    downstream.on("close", () => {
      if (identityTimeout !== undefined) clearTimeout(identityTimeout);
    });
  });
}

function startForwarder() {
  const instanceId = process.env.FORK_INSTANCE_ID;
  if (!isForkInstanceId(instanceId)) {
    console.error("fixed Anvil host forwarder identity is unavailable");
    process.exitCode = 1;
    return;
  }
  const server = createForwarderServer(connectToAnvil, instanceId);
  server.on("error", () => {
    process.exitCode = 1;
  });
  server.listen(FORWARDER_PORT, "0.0.0.0");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  startForwarder();
}
