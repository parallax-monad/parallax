import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type LiveKuruAdapterInput,
  loadMossRuntime,
  type MossRuntimeBundle,
  normalizeLiveKuruEvidence,
  redact,
  runKuruLiveSwapWithBundle,
  validateMossRuntimePathSync,
} from "../src/index.js";

const SENDER = "0xcccccccccccccccccccccccccccccccccccccccc";
const TOKEN_OUT = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const ROUTER = "0xd651346d7c789536ebf06dc72aE3C8502cd695CC";

const INTENT: LiveKuruAdapterInput["intent"] = {
  chainId: "143",
  sender: SENDER,
  tokenIn: "MON",
  tokenOut: TOKEN_OUT,
  amountIn: "0.01",
  minimumReceivedSource: "unavailable",
};

const TRANSACTION = {
  from: SENDER,
  to: ROUTER,
  data: "0xdeadbeef",
  value: "0x2386f26fc10000",
};

const CAPABILITY = {
  kind: "capability",
  protocol: "kuru",
  method: "swap",
  params: {
    tokenIn: "native",
    tokenOut: TOKEN_OUT,
    amountIn: "0.01",
    slippage: 50,
  },
  children: [{ kind: "transaction", transaction: TRANSACTION }],
};

const QUOTE = {
  kind: "query",
  protocol: "kuru",
  method: "quote",
  data: {
    amountSide: "amountIn",
    amountIn: "0.01",
    estimatedAmountOut: "0.000223",
    minimumAmountOut: "0.000221",
    path: ["native", TOKEN_OUT],
  },
};

function fakeBundle(
  overrides: {
    discoverError?: Error;
    loadError?: Error;
    quoteError?: Error;
    actionError?: Error;
    simulateError?: Error;
    simulate?: unknown;
    coreVersion?: string;
    blockNumber?: bigint;
    quoteHang?: boolean;
    withoutPinnedBlock?: boolean;
  } = {},
): MossRuntimeBundle {
  const { createRuntime, Registry } = fakeCore(overrides);
  return {
    core: {
      version: overrides.coreVersion ?? "0.1.0",
      createRuntime,
      Registry,
    },
    erc: { version: "0.1.0" },
    kuru: { version: "0.1.0" },
    simulator: {
      version: "0.1.0",
      createTraceSimulator: () => ({
        ...(overrides.withoutPinnedBlock
          ? { pinnedBlockNumber: overrides.blockNumber ?? 100n }
          : {
              getPinnedBlockNumber: () => overrides.blockNumber ?? 100n,
            }),
        simulate: async () => {
          if (overrides.simulateError) throw overrides.simulateError;
          return (
            overrides.simulate ?? {
              results: [
                {
                  protocol: "kuru",
                  method: "swap",
                  transaction: TRANSACTION,
                  reverted: false,
                  receipt: {
                    kind: "receipt",
                    outcome: {
                      operation: "swap",
                      protocol: "kuru",
                      sender: SENDER,
                      tokenIn: "native",
                      tokenOut: TOKEN_OUT,
                      amountIn: "10000000000000000",
                      amountOut: "223000000000000",
                    },
                    text: "Kuru Swap verified",
                    changes: [],
                  },
                  changes: [],
                  warnings: [],
                  gas: "1",
                },
              ],
            }
          );
        },
      }),
    },
    system: { version: "0.1.0" },
    packageVersions: {
      "@themoss/core": "0.1.0",
      "@themoss/erc": "0.1.0",
      "@themoss/protocol-kuru": "0.1.0",
      "@themoss/simulator": "0.1.0",
      "@themoss/system": "0.1.0",
    },
    checkoutRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
  };
}

function fakeCore(overrides: {
  discoverError?: Error;
  loadError?: Error;
  quoteError?: Error;
  actionError?: Error;
  blockNumber?: bigint;
  quoteHang?: boolean;
}) {
  return {
    createRuntime: async () => ({
      rpcUrl: "https://rpc.example.invalid",
      client: {
        getChainId: async () => 143,
        getBlockNumber: async () => overrides.blockNumber ?? 100n,
      },
    }),
    Registry: class FakeRegistry {
      use() {
        return this;
      }
      discover() {
        if (overrides.discoverError) throw overrides.discoverError;
        return [
          {
            protocol: "kuru",
            method: "quote",
            kind: "query",
            category: "dex",
            tags: ["clob"],
            summary: "Quote",
          },
          {
            protocol: "kuru",
            method: "swap",
            kind: "capability",
            verb: "swap",
            category: "dex",
            tags: ["clob"],
            summary: "Swap",
          },
        ];
      }
      load() {
        if (overrides.loadError) throw overrides.loadError;
        return [
          {
            protocol: "kuru",
            method: "swap",
            kind: "capability",
            intent: "Swap",
            params: {},
          },
        ];
      }
      async action(_protocol: string, method: string) {
        if (method === "quote" && overrides.quoteHang) {
          return new Promise(() => {});
        }
        if (method === "quote" && overrides.quoteError)
          throw overrides.quoteError;
        if (method === "swap" && overrides.actionError)
          throw overrides.actionError;
        if (method === "quote") return QUOTE;
        return CAPABILITY;
      }
      parseReceipt() {
        return { kind: "receipt", outcome: null, text: "", changes: [] };
      }
    },
  };
}

function input(
  overrides: Partial<LiveKuruAdapterInput> = {},
): LiveKuruAdapterInput {
  return {
    runId: "run-1",
    intent: INTENT,
    rpcUrl: "https://rpc.example.invalid",
    runtimePath: "/nonexistent",
    runtimeVersion: "0.1.0",
    runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
    fetchedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

const NO_SIGNING_KEYWORDS = [
  "sendTransaction",
  "sendRawTransaction",
  "signTransaction",
  "signMessage",
  "privateKey",
  "walletClient",
  "eth_sendTransaction",
];

describe("kuru live adapter", () => {
  it("runs discover -> load -> quote -> action -> simulate in order", async () => {
    const result = await runKuruLiveSwapWithBundle(input(), fakeBundle());
    expect(result.stages.map((stage) => stage.stage)).toEqual([
      "DISCOVER",
      "LOAD",
      "QUOTE",
      "ACTION",
      "SIMULATE",
    ]);
    expect(result.stages.every((stage) => stage.success)).toBe(true);
    expect(
      result.stages.every((stage) => stage.startedAt <= stage.finishedAt),
    ).toBe(true);
    expect(result.stages.every((stage) => stage.raw !== null)).toBe(true);
    expect(result.stages.every((stage) => stage.blockNumber === "100")).toBe(
      true,
    );
  });

  it("never signs or broadcasts: adapter source has no signing/wallet surface", () => {
    const source = readFileSync(
      new URL("../src/live-kuru.ts", import.meta.url),
      "utf8",
    );
    for (const keyword of NO_SIGNING_KEYWORDS) {
      expect(source).not.toContain(keyword);
    }
  });

  it("carries full runtime and block provenance with isReplay=false isMock=false", async () => {
    const result = await runKuruLiveSwapWithBundle(input(), fakeBundle());
    const evidence = result.evidence;
    expect(evidence.runtimeVersion).toBe("0.1.0");
    expect(evidence.runtimeRevision).toBe(
      "d09b38cbc44ee7f5722c5d09e7224f7750187762",
    );
    expect(evidence.isReplay).toBe(false);
    expect(evidence.isMock).toBe(false);
    expect(evidence.replayMode).toBe(false);
    expect(evidence.fetchedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(evidence.blockNumber.value).toBe("100");
    expect(evidence.source).toBe("moss");
    expect(evidence.integrationStatus).toBe("OK");
    expect(evidence.executionStatus).toBe("SUCCESS");
    expect(evidence.simulationCoverage.value?.complete).toBe(true);
    expect(evidence.simulationCoverage.value?.expectedTransactions).toBe(1);
    expect(evidence.simulatorPinnedBlock).toBe("100");
  });

  it("fails closed on runtime version mismatch", async () => {
    const bundle = fakeBundle({ coreVersion: "0.1.0" });
    await expect(
      runKuruLiveSwapWithBundle(input({ runtimeVersion: "9.9.9" }), bundle),
    ).rejects.toThrow(/MOSS runtime mismatch/);
  });

  it("fails closed on a non-core Moss package version mismatch", async () => {
    const bundle = fakeBundle();
    bundle.packageVersions["@themoss/simulator"] = "9.9.9";
    await expect(runKuruLiveSwapWithBundle(input(), bundle)).rejects.toThrow(
      /MOSS package version mismatch.*@themoss\/simulator=9\.9\.9/,
    );
  });

  it("keeps FlipOrderUpdated warnings and returns UNKNOWN, not success", async () => {
    const bundle = fakeBundle({
      simulate: {
        results: [
          {
            protocol: "kuru",
            method: "swap",
            transaction: TRANSACTION,
            reverted: false,
            warnings: [
              {
                code: "RECEIPT_FAILED",
                message:
                  "Unexpected Change: Kuru market emitted FlipOrderUpdated",
              },
            ],
            gas: null,
          },
        ],
        halted: {
          transactionIndex: 0,
          reason: "Unexpected Change: Kuru market emitted FlipOrderUpdated",
        },
      },
    });
    const result = await runKuruLiveSwapWithBundle(input(), bundle);
    expect(result.evidence.integrationStatus).toBe("OK");
    expect(result.evidence.executionStatus).toBe("UNKNOWN");
    expect(result.evidence.warnings.value?.length).toBe(1);
    expect(JSON.stringify(result.evidence.warnings.value)).toContain(
      "FlipOrderUpdated",
    );
    expect(result.evidence.simulationCoverage.value?.complete).toBe(false);
    expect(result.evidence.simulationCoverage.value?.halted).toBe(true);
    expect(
      result.evidence.limitations.some((limitation) =>
        limitation.includes("FlipOrderUpdated"),
      ),
    ).toBe(true);
  });

  it("maps a structured revert to OK/REVERTED", async () => {
    const bundle = fakeBundle({
      simulate: {
        results: [
          {
            protocol: "kuru",
            method: "swap",
            transaction: TRANSACTION,
            reverted: true,
            revertReason: "execution reverted: insufficient balance",
            warnings: [],
            gas: "1",
          },
        ],
      },
    });
    const result = await runKuruLiveSwapWithBundle(input(), bundle);
    expect(result.evidence.integrationStatus).toBe("OK");
    expect(result.evidence.executionStatus).toBe("REVERTED");
    expect(result.evidence.revertReason.value).toContain(
      "insufficient balance",
    );
  });

  it("maps a timeout to TIMEOUT with UNKNOWN verdict", async () => {
    const bundle = fakeBundle({
      quoteError: new Error("request timed out after 10s"),
    });
    const result = await runKuruLiveSwapWithBundle(input(), bundle);
    expect(result.evidence.integrationStatus).toBe("TIMEOUT");
    expect(result.evidence.executionStatus).toBe("UNKNOWN");
    const error = result.stages.find((stage) => stage.stage === "QUOTE")?.error;
    expect(error?.code).toBe("TIMEOUT");
    expect(error?.retryable).toBe(true);
    expect(error?.normalization).toBe("DERIVED");
  });

  it("maps structured SimulatorUnavailableError to UNAVAILABLE (PRESERVED)", async () => {
    const unavailable = new Error(
      "debug_traceCall is not supported by this RPC",
    );
    unavailable.name = "SimulatorUnavailableError";
    const bundle = fakeBundle({ simulateError: unavailable });
    const result = await runKuruLiveSwapWithBundle(input(), bundle);
    expect(result.evidence.integrationStatus).toBe("UNAVAILABLE");
    expect(result.evidence.executionStatus).toBe("UNKNOWN");
    const error = result.stages.find(
      (stage) => stage.stage === "SIMULATE",
    )?.error;
    expect(error?.code).toBe("UNAVAILABLE");
    expect(error?.normalization).toBe("PRESERVED");
  });

  it("maps a completed no-route quote to OK/NO_ROUTE", async () => {
    const bundle = fakeBundle({
      quoteError: new Error("no verified Kuru market path for this token pair"),
    });
    const result = await runKuruLiveSwapWithBundle(input(), bundle);
    expect(result.evidence.integrationStatus).toBe("OK");
    expect(result.evidence.executionStatus).toBe("NO_ROUTE");
    const error = result.stages.find((stage) => stage.stage === "QUOTE")?.error;
    expect(error?.code).toBe("NO_ROUTE");
  });

  it("maps an integration error and stops before later stages", async () => {
    const bundle = fakeBundle({
      discoverError: new Error("registry failed to initialize"),
    });
    const result = await runKuruLiveSwapWithBundle(input(), bundle);
    expect(result.stages.map((stage) => stage.stage)).toEqual(["DISCOVER"]);
    expect(result.stages[0].success).toBe(false);
    expect(result.stages[0].error?.code).toBe("INTEGRATION_ERROR");
    expect(result.evidence.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(result.evidence.executionStatus).toBe("UNKNOWN");
  });

  it("reports incomplete coverage when no result matches the action transaction", async () => {
    const bundle = fakeBundle({
      simulate: { results: [] },
    });
    const result = await runKuruLiveSwapWithBundle(input(), bundle);
    const coverage = result.evidence.simulationCoverage.value;
    expect(coverage?.complete).toBe(false);
    expect(coverage?.expectedTransactions).toBe(1);
    expect(coverage?.missingTransactionIndexes).toEqual([0]);
    expect(result.evidence.executionStatus).toBe("UNKNOWN");
  });

  it("reads per-stage block provenance", async () => {
    const bundle = fakeBundle({ blockNumber: 91383505n });
    const result = await runKuruLiveSwapWithBundle(input(), bundle);
    for (const stage of result.stages) {
      expect(stage.blockNumber).toBe("91383505");
    }
    expect(result.evidence.blockNumber.value).toBe("91383505");
  });

  it("records the simulator pinned block when the runtime exposes it", async () => {
    const result = await runKuruLiveSwapWithBundle(
      input(),
      fakeBundle({ blockNumber: 91383505n }),
    );
    expect(result.simulatorPinnedBlock).toBe("91383505");
    expect(result.evidence.simulatorPinnedBlock).toBe("91383505");
  });

  it("does not trust an incidental pinnedBlockNumber property", async () => {
    const result = await runKuruLiveSwapWithBundle(
      input(),
      fakeBundle({ withoutPinnedBlock: true }),
    );

    expect(result.simulatorPinnedBlock).toBeUndefined();
    expect(result.evidence.simulatorPinnedBlock).toBeUndefined();
  });

  it("maps a hanging stage to TIMEOUT and keeps structured evidence", async () => {
    const bundle = fakeBundle({ quoteHang: true });
    const result = await runKuruLiveSwapWithBundle(
      input({ stageTimeoutMs: 50 }),
      bundle,
    );
    expect(result.evidence.integrationStatus).toBe("TIMEOUT");
    expect(result.evidence.executionStatus).toBe("UNKNOWN");
    expect(result.stages.map((stage) => stage.stage)).toEqual([
      "DISCOVER",
      "LOAD",
      "QUOTE",
    ]);
    const quote = result.stages.find((stage) => stage.stage === "QUOTE");
    expect(quote?.success).toBe(false);
    expect(quote?.error?.code).toBe("TIMEOUT");
    expect(quote?.error?.integrationStatus).toBe("TIMEOUT");
    expect(quote?.error?.normalization).toBe("PRESERVED");
    expect(quote?.error?.retryable).toBe(true);
  });

  it("emits redacted stage start and finish logs", async () => {
    const lines: string[] = [];
    const result = await runKuruLiveSwapWithBundle(
      input({ logger: (line) => lines.push(line) }),
      fakeBundle(),
    );
    expect(lines[0]).toContain("[INIT] chainId=143");
    expect(lines).toContain("[DISCOVER] START");
    expect(lines.some((line) => line.startsWith("[SIMULATE] OK"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toMatch(/https?:\/\//);
      expect(line).not.toMatch(/rpc\.example/);
    }
    expect(result.stages.length).toBe(5);
  });
});

describe("loadMossRuntime", () => {
  const createMossRuntimeFixture = (
    overrides: {
      coreSource?: string;
      versions?: Record<string, string>;
      withGit?: boolean;
    } = {},
  ) => {
    const dir = mkdtempSync(join(tmpdir(), "moss-runtime-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "moss", version: "0.0.0" }),
    );
    const packages = [
      { rel: "packages/core", name: "@themoss/core" },
      { rel: "packages/erc", name: "@themoss/erc" },
      {
        rel: "packages/protocols/kuru",
        name: "@themoss/protocol-kuru",
      },
      { rel: "packages/simulator", name: "@themoss/simulator" },
      { rel: "packages/system", name: "@themoss/system" },
    ];
    for (const { rel, name } of packages) {
      const distDir = join(dir, rel, "dist");
      mkdirSync(distDir, { recursive: true });
      writeFileSync(
        join(dir, rel, "package.json"),
        JSON.stringify({
          name,
          version: overrides.versions?.[name] ?? "0.1.0",
        }),
      );
      writeFileSync(
        join(distDir, "index.js"),
        name === "@themoss/core"
          ? (overrides.coreSource ?? "export const marker = 'stub';\n")
          : "export const marker = 'stub';\n",
      );
    }
    let revision = "0".repeat(40);
    if (overrides.withGit !== false) {
      execFileSync("git", ["init", "-q", dir]);
      execFileSync("git", ["-C", dir, "add", "."]);
      execFileSync("git", [
        "-C",
        dir,
        "-c",
        "user.name=Moss Test",
        "-c",
        "user.email=moss-test@example.invalid",
        "commit",
        "-q",
        "-m",
        "fixture",
      ]);
      revision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
    }
    return { dir, revision };
  };

  it("reads exact package versions from a pinned Moss checkout", async () => {
    const { dir, revision } = createMossRuntimeFixture();
    const bundle = await loadMossRuntime(dir, {
      runtimeVersion: "0.1.0",
      runtimeRevision: revision,
    });
    expect(bundle.packageVersions["@themoss/core"]).toBe("0.1.0");
    expect(bundle.packageVersions["@themoss/erc"]).toBe("0.1.0");
    expect(bundle.packageVersions["@themoss/protocol-kuru"]).toBe("0.1.0");
    expect(bundle.packageVersions["@themoss/simulator"]).toBe("0.1.0");
    expect(bundle.packageVersions["@themoss/system"]).toBe("0.1.0");
    expect(bundle.core.marker).toBe("stub");
    expect(bundle.kuru.marker).toBe("stub");
  });

  it("rejects a package version mismatch before importing any bundle", async () => {
    const marker = "__parallax_moss_bundle_imported__";
    const { dir, revision } = createMossRuntimeFixture({
      coreSource: `globalThis[${JSON.stringify(marker)}] = true;\nexport const marker = 'stub';\n`,
      versions: { "@themoss/core": "0.2.0" },
    });
    const globalState = globalThis as Record<string, unknown>;
    delete globalState[marker];

    try {
      await expect(
        loadMossRuntime(dir, {
          runtimeVersion: "0.1.0",
          runtimeRevision: revision,
        }),
      ).rejects.toThrow(/MOSS package version mismatch/);
      expect(globalState[marker]).toBeUndefined();
    } finally {
      delete globalState[marker];
    }
  });

  it("rejects a revision mismatch before importing any bundle", async () => {
    const marker = "__parallax_moss_bundle_imported__";
    const { dir } = createMossRuntimeFixture({
      coreSource: `globalThis[${JSON.stringify(marker)}] = true;\nexport const marker = 'stub';\n`,
    });
    const globalState = globalThis as Record<string, unknown>;
    delete globalState[marker];

    try {
      await expect(
        loadMossRuntime(dir, {
          runtimeVersion: "0.1.0",
          runtimeRevision: "0".repeat(40),
        }),
      ).rejects.toThrow(/MOSS runtime revision mismatch/);
      expect(globalState[marker]).toBeUndefined();
    } finally {
      delete globalState[marker];
    }
  });

  it("reports a non-Git checkout separately from a revision mismatch", async () => {
    const { dir, revision } = createMossRuntimeFixture({ withGit: false });
    const expected = {
      runtimeVersion: "0.1.0",
      runtimeRevision: revision,
    };

    await expect(loadMossRuntime(dir, expected)).rejects.toThrow(
      /not a readable Git checkout/,
    );
    expect(() => validateMossRuntimePathSync(dir, expected)).toThrow(
      /not a readable Git checkout/,
    );
  });

  it("rejects a path that is not a Moss checkout", async () => {
    await expect(
      loadMossRuntime(join(tmpdir(), "definitely-not-moss"), {
        runtimeVersion: "0.1.0",
        runtimeRevision: "0".repeat(40),
      }),
    ).rejects.toThrow(/does not contain a Moss checkout/);
  });
});

describe("live normalization over the recorded fixture", () => {
  it("replays the recorded MON->USDC raw evidence as live UNKNOWN with FlipOrderUpdated preserved", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL(
          "../../../fixtures/chain-evidence/kuru/mon-to-usdc/raw.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as import("../src/index.js").RawKuruEvidence;
    const evidence = normalizeLiveKuruEvidence({
      intent: INTENT,
      raw,
      runtime: {
        runtimeVersion: "0.1.0",
        runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
        packageVersions: {
          "@themoss/core": "0.1.0",
          "@themoss/erc": "0.1.0",
          "@themoss/protocol-kuru": "0.1.0",
          "@themoss/simulator": "0.1.0",
          "@themoss/system": "0.1.0",
        },
      },
      fetchedAt: "2026-08-03T00:00:00.000Z",
      stages: [
        {
          stage: "DISCOVER",
          startedAt: "2026-08-03T00:00:00.000Z",
          finishedAt: "2026-08-03T00:00:00.100Z",
          success: true,
          raw: null,
          runtime: {
            runtimeVersion: "0.1.0",
            runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
            packageVersions: {},
          },
          blockNumber: "91383505",
        },
        {
          stage: "SIMULATE",
          startedAt: "2026-08-03T00:00:00.000Z",
          finishedAt: "2026-08-03T00:00:00.100Z",
          success: true,
          raw: null,
          runtime: {
            runtimeVersion: "0.1.0",
            runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
            packageVersions: {},
          },
          blockNumber: "91383505",
        },
      ],
      initialBlock: "91383505",
    });
    expect(evidence.executionStatus).toBe("UNKNOWN");
    expect(evidence.integrationStatus).toBe("OK");
    expect(evidence.isReplay).toBe(false);
    expect(evidence.isMock).toBe(false);
    expect(evidence.runtimeRevision).toBe(
      "d09b38cbc44ee7f5722c5d09e7224f7750187762",
    );
    expect(evidence.blockNumber.value).toBe("91383505");
    expect(JSON.stringify(evidence.warnings.value)).toContain(
      "FlipOrderUpdated",
    );
    expect(evidence.simulationCoverage.value?.complete).toBe(false);
    expect(
      evidence.limitations.some((limitation) =>
        limitation.includes("FlipOrderUpdated"),
      ),
    ).toBe(true);
  });

  it("does not create a live success fixture from the halted recorded raw", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL(
          "../../../fixtures/chain-evidence/kuru/mon-to-usdc/raw.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as import("../src/index.js").RawKuruEvidence;
    const evidence = normalizeLiveKuruEvidence({
      intent: INTENT,
      raw,
      runtime: {
        runtimeVersion: "0.1.0",
        runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
        packageVersions: {},
      },
      fetchedAt: "2026-08-03T00:00:00.000Z",
      stages: [],
    });
    expect(evidence.executionStatus).not.toBe("SUCCESS");
    expect(evidence.receipt.value).toBeNull();
  });
});

function liveErrors(
  rawErrors: import("../src/index.js").RawKuruEvidence["errors"],
) {
  return normalizeLiveKuruEvidence({
    intent: INTENT,
    raw: {
      discover: null,
      load: null,
      quote: null,
      action: null,
      simulation: null,
      errors: rawErrors,
    },
    runtime: {
      runtimeVersion: "0.1.0",
      runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
      packageVersions: {},
    },
    fetchedAt: "2026-08-03T00:00:00.000Z",
    stages: [],
  });
}

describe("structured integrationStatus preservation", () => {
  it("preserves SIMULATE INTEGRATION_ERROR when code is missing", () => {
    const evidence = liveErrors({
      simulate: {
        stage: "SIMULATE",
        integrationStatus: "INTEGRATION_ERROR",
        message: "execution reverted",
      },
    });
    expect(evidence.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(evidence.executionStatus).toBe("UNKNOWN");
    expect(evidence.errors.value).toEqual([
      expect.objectContaining({
        stage: "SIMULATE",
        code: "INTEGRATION_ERROR",
        integrationStatus: "INTEGRATION_ERROR",
        normalization: "PRESERVED",
      }),
    ]);
  });

  it("preserves SIMULATE INTEGRATION_ERROR when code is invalid", () => {
    const evidence = liveErrors({
      simulate: {
        stage: "SIMULATE",
        code: "INVALID_CODE",
        integrationStatus: "INTEGRATION_ERROR",
        message: "execution reverted",
      },
    });
    expect(evidence.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(evidence.executionStatus).toBe("UNKNOWN");
    expect(evidence.errors.value).toEqual([
      expect.objectContaining({
        stage: "SIMULATE",
        code: "INTEGRATION_ERROR",
        integrationStatus: "INTEGRATION_ERROR",
        normalization: "PRESERVED",
      }),
    ]);
  });

  it("preserves SIMULATE INTEGRATION_ERROR when code is mismatched", () => {
    const evidence = liveErrors({
      simulate: {
        stage: "SIMULATE",
        code: "RPC_FAILURE",
        integrationStatus: "INTEGRATION_ERROR",
        message: "execution reverted",
      },
    });
    expect(evidence.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(evidence.executionStatus).toBe("UNKNOWN");
    expect(evidence.errors.value).toEqual([
      expect.objectContaining({
        stage: "SIMULATE",
        code: "INTEGRATION_ERROR",
        integrationStatus: "INTEGRATION_ERROR",
        normalization: "PRESERVED",
      }),
    ]);
  });

  it("preserves QUOTE INTEGRATION_ERROR and does not derive NO_ROUTE", () => {
    const evidence = liveErrors({
      quote: {
        stage: "QUOTE",
        integrationStatus: "INTEGRATION_ERROR",
        message: "no route found",
      },
    });
    expect(evidence.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(evidence.executionStatus).toBe("UNKNOWN");
    expect(evidence.errors.value).toEqual([
      expect.objectContaining({
        stage: "QUOTE",
        code: "INTEGRATION_ERROR",
        integrationStatus: "INTEGRATION_ERROR",
        normalization: "PRESERVED",
      }),
    ]);
  });

  it("derives REVERTED from a confirmed SIMULATE revert result", () => {
    const evidence = normalizeLiveKuruEvidence({
      intent: INTENT,
      raw: {
        discover: null,
        load: null,
        quote: QUOTE,
        action: CAPABILITY,
        simulation: {
          results: [
            {
              protocol: "kuru",
              method: "swap",
              transaction: TRANSACTION,
              reverted: true,
              revertReason: "execution reverted",
              warnings: [],
              gas: "1",
            },
          ],
        },
      },
      runtime: {
        runtimeVersion: "0.1.0",
        runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
        packageVersions: {},
      },
      fetchedAt: "2026-08-03T00:00:00.000Z",
      stages: [],
    });
    expect(evidence.integrationStatus).toBe("OK");
    expect(evidence.executionStatus).toBe("REVERTED");
    expect(evidence.revertReason.value).toBe("execution reverted");
  });

  it("derives NO_ROUTE from unstructured QUOTE route message", () => {
    const evidence = liveErrors({
      quote: "no verified Kuru market path for this token pair",
    });
    expect(evidence.integrationStatus).toBe("OK");
    expect(evidence.executionStatus).toBe("NO_ROUTE");
    expect(evidence.errors.value).toEqual([
      expect.objectContaining({
        stage: "QUOTE",
        code: "NO_ROUTE",
        integrationStatus: "OK",
        normalization: "DERIVED",
      }),
    ]);
  });

  it("keeps FlipOrderUpdated warnings through the live entry point", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL(
          "../../../fixtures/chain-evidence/kuru/mon-to-usdc/raw.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as import("../src/index.js").RawKuruEvidence;
    const evidence = normalizeLiveKuruEvidence({
      intent: INTENT,
      raw,
      runtime: {
        runtimeVersion: "0.1.0",
        runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
        packageVersions: {},
      },
      fetchedAt: "2026-08-03T00:00:00.000Z",
      stages: [],
    });
    expect(evidence.executionStatus).toBe("UNKNOWN");
    expect(evidence.integrationStatus).toBe("OK");
    expect(evidence.receipt.value).toBeNull();
    expect(evidence.outcome.value).toBeNull();
    expect(JSON.stringify(evidence.warnings.value)).toContain(
      "FlipOrderUpdated",
    );
    expect(evidence.simulationCoverage.value?.complete).toBe(false);
    expect(
      evidence.limitations.some((limitation) =>
        limitation.includes("FlipOrderUpdated"),
      ),
    ).toBe(true);
  });
});

describe("secret redaction", () => {
  it("redacts RPC userinfo and query secrets", () => {
    const redacted = redact(
      "https://user:supersecret@rpc.example.invalid/api?token=abc123&api_key=xyz",
    );
    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("xyz");
    expect(redacted).toContain("***");
  });
});

describe.skipIf(!process.env.MOSS_RUNTIME_PATH)(
  "pinned real Moss runtime",
  () => {
    const runtimePath = process.env.MOSS_RUNTIME_PATH as string;

    it("loads the exact recorded baseline package versions", async () => {
      const bundle = await loadMossRuntime(runtimePath, {
        runtimeVersion: "0.1.0",
        runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
      });
      expect(bundle.packageVersions["@themoss/core"]).toBe("0.1.0");
      expect(bundle.packageVersions["@themoss/erc"]).toBe("0.1.0");
      expect(bundle.packageVersions["@themoss/protocol-kuru"]).toBe("0.1.0");
      expect(bundle.packageVersions["@themoss/simulator"]).toBe("0.1.0");
      expect(bundle.packageVersions["@themoss/system"]).toBe("0.1.0");
      expect(typeof bundle.core.createRuntime).toBe("function");
      expect(typeof bundle.core.Registry).toBe("function");
      expect(typeof bundle.kuru.Kuru).toBe("function");
      expect(typeof bundle.simulator.createTraceSimulator).toBe("function");
    });

    it("resolves the recorded runtimeRevision identity to the pinned checkout", async () => {
      const { execFileSync } = await import("node:child_process");
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: runtimePath,
        encoding: "utf8",
      }).trim();
      expect(head).toBe("d09b38cbc44ee7f5722c5d09e7224f7750187762");
    });
  },
);
