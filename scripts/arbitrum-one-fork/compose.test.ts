import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getForkHarnessConfig } from "./smoke.js";

const config = getForkHarnessConfig();
const compose = readFileSync(
  fileURLToPath(new URL("./compose.yaml", import.meta.url)),
  "utf8",
);

function serviceBlock(name: string): string {
  return (
    compose.match(
      new RegExp(
        `^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}[\\w-]+:\\n|^networks:\\n)`,
        "m",
      ),
    )?.[1] ?? ""
  );
}

function serviceNetworks(name: string): string[] {
  const networkList = serviceBlock(name).match(
    /^ {4}networks:\n((?: {6}- [\w-]+\n?)+)/m,
  )?.[1];

  return (
    networkList
      ?.trim()
      .split("\n")
      .map((network) => network.trim().slice(2)) ?? []
  );
}

function networkBlock(name: string): string {
  const networks =
    compose.match(/^networks:\n([\s\S]*?)^secrets:\n/m)?.[1] ?? "";

  return (
    networks.match(
      new RegExp(
        `^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:\\n|(?![\\s\\S]))`,
        "m",
      ),
    )?.[1] ?? ""
  );
}

describe("Arbitrum One fork container configuration", () => {
  it("pins multi-architecture images by release and immutable digest", () => {
    expect(config.anvil.image).toMatch(/foundry:v1\.8\.5@sha256:[a-f0-9]{64}$/);
    expect(config.rpcProxy.image).toMatch(
      /node:22\.23\.2-alpine3\.23@sha256:[a-f0-9]{64}$/,
    );
    expect(compose).toContain("FORK_ANVIL_IMAGE");
    expect(compose).toContain("FORK_RPC_PROXY_IMAGE");
    expect(compose).not.toMatch(/:\s*latest\b/i);
  });

  it("uses a fixed source block and a separate local execution chain", () => {
    expect(config.source.chainId).toBe(42161);
    expect(config.source.blockNumber).toBe("515881859");
    expect(config.source.blockHash).toBe(
      "0x304b694bc77e488eca3af067e45712e71753e2c42ca04881e21039b71da4560e",
    );
    expect(config.localExecutionChainId).toBe(31337);
    expect(compose).toContain("--fork-block-number");
    expect(compose).toContain("SOURCE_BLOCK_NUMBER");
    expect(compose).toContain("--chain-id");
    expect(compose).toContain("LOCAL_EXECUTION_CHAIN_ID");
    expect(compose).toContain("http://rpc-proxy:18546");
    expect(compose).toContain("--accounts");
    expect(compose).toContain('"0"');
    expect(compose).toContain("--silent");
    expect(compose).toContain("--no-mining");
  });

  it("starts the RPC proxy module in the rpc-proxy service", () => {
    const rpcProxyService = compose.match(
      /^ {2}rpc-proxy:\n([\s\S]*?)(?=^ {2}[\w-]+:\n|^networks:\n)/m,
    )?.[1];

    expect(rpcProxyService).toContain(
      "command:\n      - node\n      - /opt/fork/rpc-proxy.mjs",
    );
  });

  it("keeps the environment-backed RPC secret compatible with proxy hardening", () => {
    const rpcProxyService = serviceBlock("rpc-proxy");
    const anvilService = serviceBlock("anvil");
    const forwarderService = serviceBlock("anvil-host-forwarder");

    expect(rpcProxyService).toContain("- upstream_rpc_url");
    expect(rpcProxyService).toContain(
      "networks:\n      - fork\n      - egress",
    );
    expect(compose).toContain(
      "upstream_rpc_url:\n    environment: ARBITRUM_ONE_FORK_UPSTREAM_RPC_URL",
    );
    expect(rpcProxyService).not.toMatch(/^ {4}read_only: true$/m);
    expect(rpcProxyService).toContain("cap_drop:\n      - ALL");
    expect(rpcProxyService).toContain("no-new-privileges:true");
    expect(rpcProxyService).toContain(
      "tmpfs:\n      - /tmp:rw,noexec,nosuid,size=16m",
    );
    expect(anvilService).toMatch(/^ {4}read_only: true$/m);
    expect(forwarderService).toMatch(/^ {4}read_only: true$/m);
  });

  it("accepts Cast's quoted chain ID in the read-only Anvil healthcheck", () => {
    const anvilService = compose.match(
      /^ {2}anvil:\n([\s\S]*?)(?=^ {2}[\w-]+:\n|^networks:\n)/m,
    )?.[1];

    expect(anvilService).toMatch(/^ {4}read_only: true$/m);
    expect(anvilService).toContain(
      `- cast rpc eth_chainId --rpc-url http://127.0.0.1:8545 | grep -qx '"0x7a69"'`,
    );
    expect(() =>
      execFileSync("grep", ["-qx", '"0x7a69"'], { input: '"0x7a69"\n' }),
    ).not.toThrow();
  });

  it("mounts the upstream URL as a runtime secret and publishes only configurable local ports", () => {
    expect(compose).toContain(
      "environment: ARBITRUM_ONE_FORK_UPSTREAM_RPC_URL",
    );
    expect(compose).toContain("- upstream_rpc_url");
    expect(compose).toContain('host_ip: "');
    expect(compose).toContain("FORK_BIND_ADDRESS:-127.0.0.1");
    expect(compose).toContain("internal: true");
    expect(compose).not.toContain("ARBITRUM_ONE_FORK_UPSTREAM_RPC_URL:");
    expect(compose).not.toContain("--fork-url latest");
  });

  it("publishes the local fork RPC only through a loopback-configurable forwarder", () => {
    const proxyService = serviceBlock("rpc-proxy");
    const anvilService = serviceBlock("anvil");
    const forwarderService = serviceBlock("anvil-host-forwarder");

    expect(proxyService).toContain("target: 18546");
    expect(proxyService).toContain(
      `published: "\${FORK_PROXY_HOST_PORT:-18546}"`,
    );
    expect(forwarderService).toContain("target: 8546");
    expect(forwarderService).toContain(
      `published: "\${FORK_LOCAL_HOST_PORT:-8545}"`,
    );
    expect(forwarderService).toContain(
      `host_ip: "\${FORK_BIND_ADDRESS:-127.0.0.1}"`,
    );
    expect(forwarderService).toContain(
      "./scripts/arbitrum-one-fork/host-forwarder.mjs:/opt/fork/host-forwarder.mjs:ro",
    );
    expect(anvilService).not.toMatch(/^ {4}ports:/m);
  });

  it("keeps the fixed forwarder secret-free while joining only its required networks", () => {
    const forwarderService = serviceBlock("anvil-host-forwarder");

    expect(forwarderService).toContain("FORK_RPC_PROXY_IMAGE");
    expect(forwarderService).toContain(
      `FORK_INSTANCE_ID: \${FORK_INSTANCE_ID:?FORK_INSTANCE_ID is required}`,
    );
    expect(serviceNetworks("anvil-host-forwarder")).toEqual([
      "fork",
      "host-publish",
    ]);
    expect(forwarderService).not.toContain("- egress");
    expect(forwarderService).not.toContain("secrets:");
    expect(forwarderService).not.toContain("upstream_rpc_url");
    expect(forwarderService).not.toContain(
      "ARBITRUM_ONE_FORK_UPSTREAM_RPC_URL",
    );
    expect(forwarderService).toContain("condition: service_healthy");
  });

  it("limits the dedicated non-internal publish bridge to the host forwarder", () => {
    expect(serviceNetworks("rpc-proxy")).toEqual(["fork", "egress"]);
    expect(serviceNetworks("anvil")).toEqual(["fork"]);
    expect(serviceNetworks("anvil-host-forwarder")).toContain("host-publish");
    expect(networkBlock("fork")).toMatch(/^ {4}internal: true$/m);

    const hostPublishNetwork = networkBlock("host-publish");
    expect(hostPublishNetwork).toMatch(/^ {4}driver: bridge$/m);
    expect(hostPublishNetwork).toMatch(
      /^ {6}com\.docker\.network\.bridge\.enable_ip_masquerade: "false"$/m,
    );
    expect(hostPublishNetwork).not.toMatch(/^ {4}internal: true$/m);
  });

  it("keeps Anvil isolated and read-only behind the host forwarder", () => {
    const anvilService = serviceBlock("anvil");

    expect(anvilService).toMatch(/^ {4}read_only: true$/m);
    expect(anvilService).toContain("cap_drop:\n      - ALL");
    expect(anvilService).toContain("no-new-privileges:true");
    expect(serviceNetworks("anvil")).toEqual(["fork"]);
    expect(anvilService).not.toContain("- egress");
    expect(anvilService).not.toMatch(/^ {4}ports:/m);
  });
});
