import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { EvidenceDrawer } from "@/components/analyze/EvidenceDrawer";
import { WalletResult } from "@/components/wallet/WalletResult";
import { checkSwap, loadRun } from "./service";

const fingerprint = `sha256:${"a".repeat(64)}`;
const run = {
  runId: "backend-run-92",
  status: "completed",
  systemStatus: "OK",
  verdict: "UNKNOWN",
  summary: "Required evidence remains incomplete.",
  createdAt: "2026-09-28T13:32:55.832Z",
  replayMode: false,
  intent: {
    chainId: 421614,
    protocol: "camelot-v3",
    tokenIn: { kind: "native" },
    tokenOut: {
      kind: "erc20",
      address: "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7",
    },
    amountInAtomic: "1000000000000000",
    economicBoundary: { availability: "unavailable", source: "unavailable" },
  },
  scope: [{ key: "P0-EVIDENCE-001", status: "unknown", reason: "INCOMPLETE" }],
  evidence: [
    {
      key: "rpc-1",
      stage: "SIMULATE",
      source: "rpc",
      status: "confirmed",
      rawPayload: "DO_NOT_RENDER_RAW_RPC",
    },
  ],
  p0: {
    basicSimulation: {
      blockNumber: "313622358",
      observedAt: "2026-09-28T13:32:51.866Z",
      preparedTransactionFingerprint: fingerprint,
      uncheckedCapabilities: ["receipt", "outcome"],
    },
  },
  providerEvidence: {
    provider: { providerId: "native-rpc-arbitrum", status: "SUCCESS" },
    provenance: {
      mode: "LIVE",
      source: "rpc",
      fetchedAt: "2026-09-28T13:32:51.866Z",
      simulationBlock: "313622358",
    },
    checkedScope: ["native-rpc.eth_call", "native-rpc.estimateGas"],
    unknownScope: ["receipt", "outcome", "simulation"],
    providerData: {
      traceRpc: {
        status: "partial",
        source: {
          sourceId: "trace-rpc",
          sourceVersion: "trace-rpc-evidence-source-v1",
          mode: "LIVE",
          observedAt: "2026-09-28T13:32:55.832Z",
        },
        freshness: { status: "not_checked" },
        binding: {
          runId: "backend-run-92",
          chainId: 421614,
          protocol: "camelot-v3",
          transactionFingerprint: fingerprint,
          blockContext: { blockNumber: "313622358" },
        },
        capabilities: {
          callTracer: { status: "unknown", reason: "timeout" },
          prestateTracerDiff: { status: "observed" },
        },
        checkedScope: [
          "trace-rpc.chain",
          "trace-rpc.pinned-block",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unknownScope: ["trace-rpc.callTracer"],
        unavailableScope: [],
        rawPayload: "DO_NOT_RENDER_RAW_RPC",
      },
    },
  },
};

const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("#119 public response to #92 Result UI", () => {
  test("parses a Check, renders source coverage, and recovers the same saved Run", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/p0/metadata")
        return response({
          chainId: 421614,
          protocol: "camelot-v3",
          tokenIn: {
            asset: { kind: "native" },
            symbol: "ETH",
            decimals: 18,
            decimalsSource: "chain_config",
          },
          tokenOut: {
            asset: {
              kind: "erc20",
              address: "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7",
            },
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified",
            verifiedAtBlock: "310131879",
          },
        });
      if (path === "/api/check") return response(run);
      if (path === "/api/runs/backend-run-92") {
        return response({
          status: "completed",
          runId: run.runId,
          createdAt: run.createdAt,
          result: run,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const result = await checkSwap(
      {
        protocol: "camelot-v3",
        tokenIn: "ETH",
        tokenOut: "USDC",
        amountIn: "0.001",
      },
      { fetch: request },
    );
    const html = renderToStaticMarkup(
      <WalletResult
        language="en"
        result={result}
        onKeep={() => undefined}
        onDiscard={() => undefined}
        onOpenEvidence={() => undefined}
      />,
    );

    expect(result.verdict).toBe("UNKNOWN");
    expect(result.evidenceCoverage).toHaveLength(2);
    expect(html).toContain("Evidence sources");
    expect(html).toContain("Native RPC");
    expect(html).toContain("Trace RPC");
    expect(html).toContain("What was checked");
    expect(html).toContain("What was not checked");
    expect(html).toContain("What is unknown");
    expect(html).toContain("What is unavailable");
    expect(html).toContain("313622358");
    expect(html).toContain("2026-09-28T13:32:55.832Z");
    expect(html).toContain("The check timed out");
    expect(html).not.toContain("DO_NOT_RENDER_RAW_RPC");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_RENDER_RAW_RPC");
    const drawer = renderToStaticMarkup(
      <EvidenceDrawer
        language="en"
        result={result}
        onClose={() => undefined}
      />,
    );
    expect(drawer).toContain("Check stages");
    expect(drawer).toContain("Trace RPC");
    expect(drawer).not.toContain("DO_NOT_RENDER_RAW_RPC");

    const recovered = await loadRun(run.runId, { fetch: request });
    expect(recovered.kind).toBe("terminal");
    if (recovered.kind === "terminal") {
      expect(recovered.result.evidenceCoverage).toEqual(
        result.evidenceCoverage,
      );
      expect(recovered.result.backendRunId).toBe(run.runId);
    }
    expect(request.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/p0/metadata",
      "/api/check",
      "/api/runs/backend-run-92",
      "/api/p0/metadata",
    ]);
  });
});
