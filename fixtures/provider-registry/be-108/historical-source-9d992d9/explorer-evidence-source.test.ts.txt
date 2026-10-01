import { describe, expect, it, vi } from "vitest";
import {
  classifyExplorerFailure,
  createExplorerEvidenceSource,
  EXPLORER_CAPABILITY_DESCRIPTORS,
  EXPLORER_EVIDENCE_CAPABILITIES,
  EXPLORER_UNSUPPORTED_CAPABILITIES,
  type ExplorerApiClient,
  type ExplorerCapabilityObservation,
  type ExplorerEvidenceTarget,
} from "./explorer-evidence-source.js";

const ROUTER = "0x171B925C51565F5D2a7d8C494ba3188D304EFD93";
const USDC = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const SENDER = "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396";
const TX = `0x${"ab".repeat(32)}`;
const BLOCK_HASH = `0x${"cd".repeat(32)}`;
const BLOCK_NUMBER = "310131879";
const RATE_LIMIT_MESSAGE =
  "Too many requests. Increase limits now at https://dev.blockscout.com";
const API_KEY_SENTINEL = "sentinel-explorer-credential-must-not-escape";
const SOURCE_SENTINEL = "sentinel-raw-source-code-must-not-escape";

/**
 * Response shapes below mirror the real responses recorded by the #108 bounded
 * probe against a live Etherscan-compatible explorer for Arbitrum Sepolia,
 * trimmed to the fields this source normalizes. Failure envelopes are the
 * verbatim observed messages.
 */
function ok(result: unknown): unknown {
  return { status: "1", message: "OK", result };
}

function target(
  overrides: Partial<ExplorerEvidenceTarget> = {},
): ExplorerEvidenceTarget {
  return {
    runId: "run-108",
    chainId: 421_614,
    protocol: "camelot-v3",
    blockContext: { blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH },
    transactionHash: TX,
    contracts: [ROUTER],
    token: USDC,
    account: SENDER,
    ...overrides,
  };
}

/**
 * Narrows a capability observation to its checked shape so a test can assert
 * normalized detail without a non-null assertion.
 */
function checkedDetail(observation: ExplorerCapabilityObservation) {
  if (observation.status !== "checked") {
    throw new Error(
      `Expected a checked observation, received ${observation.status}`,
    );
  }
  return observation.detail;
}

function clientFor(
  handler: (query: {
    module: string;
    action: string;
    params?: Readonly<Record<string, string | number>>;
  }) => Promise<unknown> | unknown,
): ExplorerApiClient & { request: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn(
      async (query: {
        module: string;
        action: string;
        params?: Readonly<Record<string, string | number>>;
      }) => handler(query),
    ),
  };
}

function liveCompatibleClient(): ExplorerApiClient {
  return clientFor(({ module, action }) => {
    if (module === "contract" && action === "getsourcecode") {
      return ok([
        {
          SourceCode: `${SOURCE_SENTINEL}// SPDX-License-Identifier: GPL-2.0-or-later`,
          ABI: '[{"type":"function","name":"exactInputSingle"}]',
          ContractName: "SwapRouter",
          CompilerVersion: "v0.7.6+commit.7338295f",
          OptimizationUsed: "true",
          IsProxy: "false",
        },
      ]);
    }
    if (module === "contract" && action === "getabi") {
      return ok('[{"type":"function","name":"exactInputSingle"}]');
    }
    if (module === "contract" && action === "getcontractcreation") {
      return ok([
        {
          contractAddress: ROUTER.toLowerCase(),
          contractCreator: "0x864ba7d19EcD545C7ef0B901D5e4Cc107C0914e1",
          txHash: `0x${"04".repeat(32)}`,
          blockNumber: "1000",
        },
      ]);
    }
    if (module === "token" && action === "getToken") {
      return ok({
        name: "USDC Sepolia",
        symbol: "USDC",
        decimals: "18",
        totalSupply: "900099999999999999999999",
        type: "ERC-20",
      });
    }
    if (module === "logs" && action === "getLogs") {
      return ok([
        { topics: [`0x${"dd".repeat(32)}`], transactionHash: TX },
        { topics: [`0x${"dd".repeat(32)}`], transactionHash: TX },
      ]);
    }
    if (module === "account" && action === "tokentx") {
      return ok([
        { tokenSymbol: "USDC", hash: TX },
        { tokenSymbol: "USDC", hash: TX },
        { tokenSymbol: "WETH", hash: TX },
      ]);
    }
    if (module === "proxy") {
      return { status: "0", message: "Unknown module", result: null };
    }
    throw new Error(`Unexpected query ${module}/${action}`);
  });
}

describe("explorer evidence source", () => {
  it("normalizes explorer-only capabilities and never claims simulation, trace, or state diff", async () => {
    const source = createExplorerEvidenceSource({
      client: liveCompatibleClient(),
      mode: "LIVE",
      now: () => "2026-09-28T14:00:00.000Z",
    });

    const result = await source.evaluate(target());

    expect(result.status).toBe("partial");
    expect(result.source.sourceId).toBe("explorer-evidence");
    expect(result.source.surface).toBe("etherscan-compatible-v2");
    expect(result.binding.runId).toBe("run-108");
    expect(result.binding.chainId).toBe(421_614);
    expect(result.unsupportedCapabilities).toEqual([
      "simulation",
      "trace",
      "state-diff",
    ]);

    const verification = result.capabilities["contract-verification"];
    expect(verification.status).toBe("checked");
    expect(verification.verification).toBe("live_verified");
    expect(checkedDetail(verification)).toMatchObject({
      verified: true,
      contractName: "SwapRouter",
      compilerVersion: "v0.7.6+commit.7338295f",
    });

    expect(checkedDetail(result.capabilities["contract-abi"])).toMatchObject({
      abiEntryCount: 1,
    });
    expect(checkedDetail(result.capabilities.deployment)).toMatchObject({
      contractCreator: "0x864ba7d19EcD545C7ef0B901D5e4Cc107C0914e1",
    });
    expect(checkedDetail(result.capabilities["token-metadata"])).toMatchObject({
      name: "USDC Sepolia",
      symbol: "USDC",
      decimals: "18",
      tokenType: "ERC-20",
    });
    expect(checkedDetail(result.capabilities.logs)).toMatchObject({
      logCount: 2,
      topic0Count: 1,
    });
    expect(checkedDetail(result.capabilities["token-transfers"])).toMatchObject(
      {
        transferCount: 3,
        tokenSymbols: ["USDC", "WETH"],
      },
    );
    expect(checkedDetail(result.capabilities.provenance)).toMatchObject({
      sourceId: "explorer-evidence",
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      chainId: 421_614,
    });

    // The Etherscan-compatible module=proxy form is not served by the keyless
    // surface used for the live probe. The capability split records that
    // difference instead of inferring a transaction or a receipt.
    expect(result.capabilities.transaction).toEqual({
      status: "unknown",
      reason: "surface_unsupported_module",
      verification: "live_verified",
    });
    expect(result.capabilities.receipt).toEqual({
      status: "unknown",
      reason: "surface_unsupported_module",
      verification: "documented_unverified",
    });

    expect(result.checkedScope).toEqual([
      "explorer.contract-verification",
      "explorer.contract-abi",
      "explorer.deployment",
      "explorer.token-metadata",
      "explorer.logs",
      "explorer.token-transfers",
      "explorer.provenance",
    ]);
    expect(result.unknownScope).toEqual([
      "explorer.transaction",
      "explorer.receipt",
    ]);
    expect(result.unavailableScope).toEqual([]);
  });

  it("keeps a rate-limited or unauthenticated capability unknown instead of inferring it", async () => {
    const rateLimited = createExplorerEvidenceSource({
      client: clientFor(({ module, action }) => {
        if (module === "contract" && action === "getsourcecode") {
          return {
            httpStatus: 429,
            message: RATE_LIMIT_MESSAGE,
          };
        }
        if (module === "contract" && action === "getabi") {
          return {
            status: "0",
            message: "NOTOK",
            result: "Missing/Invalid API Key",
          };
        }
        if (module === "contract" && action === "getcontractcreation") {
          return {
            status: "0",
            message: "NOTOK",
            result: "chain not supported",
          };
        }
        if (module === "token" && action === "getToken") {
          return {
            status: "0",
            message: "NOTOK",
            result: "This is a PRO endpoint",
          };
        }
        if (module === "logs" && action === "getLogs") {
          return {
            status: "0",
            message: "NOTOK",
            result: "deprecated V1 endpoint",
          };
        }
        if (module === "account" && action === "tokentx") {
          return {
            status: "0",
            message: "No token transfers found",
            result: [],
          };
        }
        return { status: "0", message: "Unknown module", result: null };
      }),
      mode: "LIVE",
    });

    const result = await rateLimited.evaluate(target());

    expect(result.capabilities["contract-verification"]).toMatchObject({
      status: "unknown",
      reason: "rate_limited",
    });
    expect(result.capabilities["contract-abi"]).toMatchObject({
      status: "unknown",
      reason: "auth_required",
    });
    expect(result.capabilities.deployment).toMatchObject({
      status: "unknown",
      reason: "chain_unsupported",
    });
    expect(result.capabilities["token-metadata"]).toMatchObject({
      status: "unknown",
      reason: "plan_restricted",
    });
    expect(result.capabilities.logs).toMatchObject({
      status: "unknown",
      reason: "surface_unsupported_module",
    });
    expect(result.capabilities["token-transfers"]).toMatchObject({
      status: "unknown",
      reason: "not_found",
    });
    // Provenance is never inferred from a failed capability.
    expect(result.capabilities.provenance.status).toBe("checked");
    expect(result.status).toBe("partial");
  });

  it("fails closed with target_missing when a capability has no evidence coordinate", async () => {
    const source = createExplorerEvidenceSource({
      client: clientFor(() => ok([])),
      mode: "MOCK",
    });

    const result = await source.evaluate({
      runId: "run-108",
      chainId: 421_614,
    });

    for (const capability of EXPLORER_EVIDENCE_CAPABILITIES) {
      if (capability === "provenance") continue;
      expect(result.capabilities[capability]).toMatchObject({
        status: "unknown",
        reason: "target_missing",
      });
    }
    expect(result.status).toBe("partial");
  });

  it("treats a malformed response as unknown rather than fabricating a value", async () => {
    const source = createExplorerEvidenceSource({
      client: clientFor(({ module, action }) => {
        if (module === "contract" && action === "getsourcecode") {
          return ok([{ ContractName: "SwapRouter" }]);
        }
        if (module === "contract" && action === "getabi") {
          return ok("not-json");
        }
        if (module === "contract" && action === "getcontractcreation") {
          return ok([]);
        }
        if (module === "token" && action === "getToken") {
          return ok({ name: "USDC Sepolia" });
        }
        return { status: "0", message: "Unknown module", result: null };
      }),
      mode: "LIVE",
    });

    const result = await source.evaluate(target());

    expect(result.capabilities["contract-abi"]).toMatchObject({
      status: "unknown",
      reason: "malformed_response",
    });
    expect(result.capabilities["token-metadata"]).toMatchObject({
      status: "unknown",
      reason: "malformed_response",
    });
    expect(result.capabilities.deployment).toMatchObject({
      status: "unknown",
      reason: "not_found",
    });
  });

  it("keeps the endpoint, credentials, and raw payloads outside the normalized result", async () => {
    const client = clientFor(({ module, action }) => {
      if (module === "contract" && action === "getsourcecode") {
        return {
          status: "1",
          message: "OK",
          result: [
            {
              SourceCode: SOURCE_SENTINEL,
              ABI: "[]",
              ContractName: "SwapRouter",
              ExplorerCredential: API_KEY_SENTINEL,
            },
          ],
        };
      }
      return ok([]);
    });
    const source = createExplorerEvidenceSource({ client, mode: "LIVE" });

    const result = await source.evaluate(target());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(SOURCE_SENTINEL);
    expect(serialized).not.toContain(API_KEY_SENTINEL);
    expect(serialized).not.toContain("http");
    expect(Object.keys(result)).toEqual([
      "status",
      "source",
      "binding",
      "capabilities",
      "unsupportedCapabilities",
      "checkedScope",
      "unknownScope",
      "unavailableScope",
    ]);

    // Every query carries module/action/params only: credentials belong to the
    // injected transport, never to this source.
    for (const call of client.request.mock.calls) {
      expect(Object.keys(call[0]).sort()).toEqual([
        "action",
        "module",
        "params",
      ]);
    }
  });

  it("refuses to construct without a transport or with an unknown mode", () => {
    expect(() =>
      createExplorerEvidenceSource({
        client: undefined as unknown as ExplorerApiClient,
        mode: "LIVE",
      }),
    ).toThrow(/injected client/);
    expect(() =>
      createExplorerEvidenceSource({
        client: clientFor(() => ok([])),
        mode: "PROD" as unknown as "LIVE",
      }),
    ).toThrow(/mode must be/);
  });

  it("declares every capability exactly once and exposes no selection semantics", () => {
    const declared = EXPLORER_CAPABILITY_DESCRIPTORS.map(
      (entry) => entry.capability,
    );
    expect(declared).toEqual([...EXPLORER_EVIDENCE_CAPABILITIES]);
    for (const entry of EXPLORER_CAPABILITY_DESCRIPTORS) {
      expect(["live_verified", "documented_unverified"]).toContain(
        entry.verification,
      );
      expect(entry.request.module.length).toBeGreaterThan(0);
      expect(entry.request.action.length).toBeGreaterThan(0);
    }
    for (const unsupported of EXPLORER_UNSUPPORTED_CAPABILITIES) {
      expect(declared).not.toContain(unsupported);
    }
    expect(classifyExplorerFailure(new Error("boom")).reason).toBe(
      "transport_error",
    );
  });
});
