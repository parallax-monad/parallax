import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getForkHarnessConfig } from "./smoke.js";

const config = getForkHarnessConfig();
const compose = readFileSync(
  fileURLToPath(new URL("./compose.yaml", import.meta.url)),
  "utf8",
);

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
});
