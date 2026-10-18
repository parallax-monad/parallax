import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildComposeArgs,
  getCheckoutComposeProjectName,
  isAllowedLocalHost,
  isPrivateBindAddress,
  recreateFork,
  tryRecoverFork,
  waitForAnvil,
  waitForProxyHealth,
} from "./manager.js";
import { getForkHarnessConfig } from "./smoke.js";

const config = getForkHarnessConfig();

function withCheckoutMetadata<T>(run: (metadataDir: string) => T): T {
  const metadataDir = mkdtempSync(join(tmpdir(), "parallax-fork-project-"));
  try {
    return run(metadataDir);
  } finally {
    rmSync(metadataDir, { recursive: true, force: true });
  }
}

type HttpHandler = (
  request: IncomingMessage,
) => Promise<{ readonly status?: number; readonly body: unknown }>;

async function withHttpServer<T>(
  handler: HttpHandler,
  run: (port: number) => Promise<T>,
): Promise<T> {
  const server = createServer(async (request, response) => {
    const result = await handler(request);
    response.writeHead(result.status ?? 200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(result.body));
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    return await run((address as AddressInfo).port);
  } finally {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  }
}

async function readRpcMethod(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return (JSON.parse(body) as { method: string }).method;
}

function rpcResponse(method: string, chainId: string) {
  const blockNumber = `0x${BigInt(config.source.blockNumber).toString(16)}`;
  const results: Record<string, unknown> = {
    eth_chainId: chainId,
    eth_blockNumber: blockNumber,
    eth_getBlockByNumber: {
      number: blockNumber,
      hash: config.source.blockHash,
    },
    web3_clientVersion: `anvil/v${config.anvil.version}`,
  };
  return { jsonrpc: "2.0", id: 1, result: results[method] };
}

describe("Arbitrum One fork manager lifecycle", () => {
  it("reuses one persisted Compose identity for the same checkout", () => {
    withCheckoutMetadata((metadataDir) => {
      const identityPath = join(metadataDir, "checkout-id");
      const identity = "00000000-0000-4000-8000-000000000010";

      const firstName = getCheckoutComposeProjectName(
        identityPath,
        () => identity,
      );
      const secondName = getCheckoutComposeProjectName(identityPath, () => {
        throw new Error("A persisted checkout identity must be reused.");
      });

      expect(firstName).toBe(
        "parallax-arbitrum-one-fork-00000000-0000-4000-8000-000000000010",
      );
      expect(secondName).toBe(firstName);
      expect(readFileSync(identityPath, "utf8")).toBe(`${identity}\n`);
    });
  });

  it("isolates Compose project names for distinct checkout metadata", () => {
    withCheckoutMetadata((metadataDir) => {
      const firstName = getCheckoutComposeProjectName(
        join(metadataDir, "first-checkout"),
        () => "00000000-0000-4000-8000-000000000011",
      );
      const secondName = getCheckoutComposeProjectName(
        join(metadataDir, "second-checkout"),
        () => "00000000-0000-4000-8000-000000000012",
      );

      expect(firstName).not.toBe(secondName);
      expect(firstName).toMatch(/^parallax-arbitrum-one-fork-[0-9a-f-]+$/);
      expect(secondName).toMatch(/^parallax-arbitrum-one-fork-[0-9a-f-]+$/);
    });
  });

  it.each([
    ["ps", "--status", "running", "--quiet"],
    ["up", "-d"],
    ["down", "--volumes", "--remove-orphans"],
  ])("uses the checkout project name for Compose %s", (...operation) => {
    const projectName =
      "parallax-arbitrum-one-fork-00000000-0000-4000-8000-000000000013";
    const args = buildComposeArgs(projectName, operation);
    const projectNameIndex = args.indexOf("--project-name");

    expect(args[0]).toBe("compose");
    expect(args[projectNameIndex + 1]).toBe(projectName);
    expect(args.slice(-operation.length)).toEqual(operation);
    expect(args).not.toContain("parallax-arbitrum-one-fork");
  });

  it("rejects an invalid stored checkout identity instead of replacing it", () => {
    withCheckoutMetadata((metadataDir) => {
      const identityPath = join(metadataDir, "checkout-id");
      writeFileSync(identityPath, "not-a-uuid\n", "utf8");

      let error: unknown;
      try {
        getCheckoutComposeProjectName(identityPath);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "COMPOSE_PROJECT_ID_UNAVAILABLE" });
      expect(readFileSync(identityPath, "utf8")).toBe("not-a-uuid\n");
    });
  });

  it("rejects wildcard and all other 0/8 bind addresses", () => {
    for (const address of ["0.0.0.0", "0.1.2.3", "0.255.255.255"]) {
      expect(isPrivateBindAddress(address), address).toBe(false);
      expect(isAllowedLocalHost(address), address).toBe(false);
    }
  });

  it("accepts loopback and RFC1918 bind addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.20.30.40",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.10",
    ]) {
      expect(isPrivateBindAddress(address), address).toBe(true);
      expect(isAllowedLocalHost(address), address).toBe(true);
    }
    expect(isPrivateBindAddress("172.32.0.1")).toBe(false);
    expect(isPrivateBindAddress("8.8.8.8")).toBe(false);
  });

  it("reports proxy readiness only when its health response is successful", async () => {
    await withHttpServer(
      async (request) => ({
        body: request.url === "/healthz" ? { ok: true } : { ok: false },
      }),
      async (port) =>
        waitForProxyHealth({
          FORK_BIND_ADDRESS: "127.0.0.1",
          FORK_PROXY_HOST_PORT: String(port),
        }),
    );
  });

  it("fails readiness immediately for a source-chain health mismatch", async () => {
    await withHttpServer(
      async () => ({
        body: { ok: false, code: "SOURCE_CHAIN_ID_MISMATCH" },
      }),
      async (port) =>
        expect(
          waitForProxyHealth({
            FORK_BIND_ADDRESS: "127.0.0.1",
            FORK_PROXY_HOST_PORT: String(port),
          }),
        ).rejects.toMatchObject({ code: "SOURCE_CHAIN_ID_MISMATCH" }),
    );
  });

  it("accepts Anvil only after local chain, pinned block/hash, and version match", async () => {
    const chainId = `0x${config.localExecutionChainId.toString(16)}`;
    await withHttpServer(
      async (request) => {
        return { body: rpcResponse(await readRpcMethod(request), chainId) };
      },
      async (port) =>
        waitForAnvil({
          FORK_BIND_ADDRESS: "127.0.0.1",
          FORK_LOCAL_HOST_PORT: String(port),
        }),
    );
  });

  it("rejects a local-chain identity mismatch during Anvil readiness", async () => {
    await withHttpServer(
      async (request) => {
        return { body: rpcResponse(await readRpcMethod(request), "0x1") };
      },
      async (port) =>
        expect(
          waitForAnvil({
            FORK_BIND_ADDRESS: "127.0.0.1",
            FORK_LOCAL_HOST_PORT: String(port),
          }),
        ).rejects.toMatchObject({ code: "ANVIL_IDENTITY_MISMATCH" }),
    );
  });

  it("tears down before clearing metadata and starts a fresh instance on reset", async () => {
    const events: string[] = [];
    const newInstanceId = "00000000-0000-4000-8000-000000000002";
    const instanceId = await recreateFork({
      prepare: () => {
        events.push("prepare");
      },
      teardown: () => {
        events.push("teardown");
      },
      clearMetadata: () => {
        events.push("clear-metadata");
      },
      createInstanceId: () => {
        events.push("new-instance");
        return newInstanceId;
      },
      start: async (id) => {
        events.push(`start:${id}`);
      },
    });

    expect(instanceId).toBe(newInstanceId);
    expect(events).toEqual([
      "prepare",
      "teardown",
      "clear-metadata",
      "new-instance",
      `start:${newInstanceId}`,
    ]);
  });

  it("recovers a failed snapshot reset by recreating the fork, and reports failed recovery", async () => {
    const events: string[] = [];
    const actions = {
      prepare: () => {
        events.push("prepare");
      },
      teardown: () => {
        events.push("teardown");
      },
      clearMetadata: () => {
        events.push("clear-metadata");
      },
      createInstanceId: () => "00000000-0000-4000-8000-000000000003",
      start: async () => {
        events.push("start");
      },
    };

    await expect(tryRecoverFork(actions)).resolves.toBe(true);
    expect(events).toEqual(["prepare", "teardown", "clear-metadata", "start"]);

    const failed = await tryRecoverFork({
      ...actions,
      teardown: () => {
        throw new Error("simulated teardown failure");
      },
    });
    expect(failed).toBe(false);
    expect(events).toEqual([
      "prepare",
      "teardown",
      "clear-metadata",
      "start",
      "prepare",
    ]);
  });
});
