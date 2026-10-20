import {
  request as createHttpRequest,
  createServer as createHttpServer,
  Agent as HttpAgent,
} from "node:http";
import { createConnection, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createForwarderServer,
  FORWARD_TARGET,
  FORWARDER_PORT,
} from "./host-forwarder.mjs";

function listen(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function requestJsonRpc(port, payload, agent) {
  return new Promise((resolvePromise, rejectPromise) => {
    const body = JSON.stringify(payload);
    let socket;
    const request = createHttpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/",
        method: "POST",
        agent,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          try {
            resolvePromise({
              payload: JSON.parse(responseBody),
              reusedSocket: request.reusedSocket,
              socket,
            });
          } catch (error) {
            rejectPromise(error);
          }
        });
      },
    );
    request.on("socket", (assignedSocket) => {
      socket = assignedSocket;
    });
    request.on("error", rejectPromise);
    request.end(body);
  });
}

describe("fixed Anvil host RPC forwarder", () => {
  let forwarder;
  let mockAnvil;
  let clientAgent;

  afterEach(async () => {
    clientAgent?.destroy();
    clientAgent = undefined;
    if (forwarder?.listening) await close(forwarder);
    if (mockAnvil?.listening) await close(mockAnvil);
    forwarder = undefined;
    mockAnvil = undefined;
  });

  it("has a fixed Anvil destination and container listener", () => {
    expect(FORWARD_TARGET).toEqual({ host: "anvil", port: 8545 });
    expect(FORWARDER_PORT).toBe(8546);
  });

  it("forwards TCP data in both directions to its upstream connector", async () => {
    mockAnvil = createServer((socket) => {
      socket.once("data", (data) => {
        socket.write(Buffer.concat([Buffer.from("reply:"), data]));
      });
    });
    const mockAnvilPort = await listen(mockAnvil);
    forwarder = createForwarderServer(() =>
      createConnection({ host: "127.0.0.1", port: mockAnvilPort }),
    );
    const forwarderPort = await listen(forwarder);

    const response = await new Promise((resolvePromise, rejectPromise) => {
      const client = createConnection({
        host: "127.0.0.1",
        port: forwarderPort,
      });
      client.once("error", rejectPromise);
      client.once("data", (chunk) => {
        resolvePromise(chunk.toString("utf8"));
        client.destroy();
      });
      client.write("probe");
    });

    expect(response).toBe("reply:probe");
  });

  it("answers the fixed-purpose instance handshake without forwarding it to Anvil", async () => {
    const instanceId = "00000000-0000-4000-8000-000000000001";
    let upstreamConnections = 0;
    let downstreamSocket;
    mockAnvil = createServer(() => {
      upstreamConnections += 1;
    });
    const mockAnvilPort = await listen(mockAnvil);
    forwarder = createForwarderServer(() => {
      upstreamConnections += 1;
      return createConnection({ host: "127.0.0.1", port: mockAnvilPort });
    }, instanceId);
    forwarder.once("connection", (socket) => {
      downstreamSocket = socket;
    });
    const forwarderPort = await listen(forwarder);

    const response = await fetch(`http://127.0.0.1:${forwarderPort}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "parallax_forkInstanceId",
        params: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: instanceId,
    });
    expect(upstreamConnections).toBe(0);
    expect(downstreamSocket.listenerCount("data")).toBe(0);
  });

  it("forwards ordinary JSON-RPC requests unchanged when identity interception is enabled", async () => {
    const instanceId = "00000000-0000-4000-8000-000000000001";
    let receivedRequest;
    mockAnvil = createHttpServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      receivedRequest = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: receivedRequest.id,
          result: "0x7a69",
        }),
      );
    });
    const mockAnvilPort = await listen(mockAnvil);
    forwarder = createForwarderServer(
      () => createConnection({ host: "127.0.0.1", port: mockAnvilPort }),
      instanceId,
    );
    const forwarderPort = await listen(forwarder);
    const requestPayload = {
      jsonrpc: "2.0",
      id: 9,
      method: "eth_chainId",
      params: [],
    };

    const response = await fetch(`http://127.0.0.1:${forwarderPort}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 9,
      result: "0x7a69",
    });
    expect(receivedRequest).toEqual(requestPayload);
  });

  it("stops inspecting after routing and forwards requests on a keep-alive connection", async () => {
    const instanceId = "00000000-0000-4000-8000-000000000001";
    const receivedRequests = [];
    let upstreamConnections = 0;
    let downstreamSocket;
    mockAnvil = createHttpServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      const payload = JSON.parse(body);
      receivedRequests.push(payload);
      response.writeHead(200, {
        "content-type": "application/json",
        connection: "keep-alive",
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          result: "0x7a69",
        }),
      );
    });
    mockAnvil.on("connection", () => {
      upstreamConnections += 1;
    });
    const mockAnvilPort = await listen(mockAnvil);
    forwarder = createForwarderServer(
      () => createConnection({ host: "127.0.0.1", port: mockAnvilPort }),
      instanceId,
    );
    forwarder.once("connection", (socket) => {
      downstreamSocket = socket;
    });
    const forwarderPort = await listen(forwarder);
    clientAgent = new HttpAgent({ keepAlive: true, maxSockets: 1 });
    const requestPayloads = [11, 12, 13].map((id) => ({
      jsonrpc: "2.0",
      id,
      method: "eth_chainId",
      params: [],
    }));
    const responses = [];

    for (const payload of requestPayloads) {
      responses.push(await requestJsonRpc(forwarderPort, payload, clientAgent));
      if (responses.length === 1) {
        expect(downstreamSocket.listenerCount("data")).toBe(1);
      }
    }

    expect(responses.map((response) => response.payload)).toEqual(
      requestPayloads.map((payload) => ({
        jsonrpc: "2.0",
        id: payload.id,
        result: "0x7a69",
      })),
    );
    expect(responses.map((response) => response.socket)).toEqual([
      responses[0].socket,
      responses[0].socket,
      responses[0].socket,
    ]);
    expect(responses.slice(1).every((response) => response.reusedSocket)).toBe(
      true,
    );
    expect(receivedRequests).toEqual(requestPayloads);
    expect(upstreamConnections).toBe(1);
  });
});
