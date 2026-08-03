import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyLiveError } from "./errors.js";
import { normalizeLiveKuruEvidence } from "./normalize.js";
import { toJsonValue } from "./serialize.js";
import type {
  JsonValue,
  LiveKuruAdapterInput,
  LiveKuruResult,
  NormalizedMossError,
  RawKuruEvidence,
  RuntimeIdentity,
  StageName,
  StageRecord,
} from "./types.js";

/**
 * Kuru MON -> USDC live adapter over a pinned Moss runtime.
 *
 * The adapter owns the raw Moss boundary. Moss raw types never leak outside
 * `@parallax/moss-bridge`: consumers only see `NormalizedKuruEvidence` and the
 * stage records. No signing, broadcast, custody, or wallet mutation exists in
 * this module - the action stage only constructs unsigned calldata.
 */

const PACKAGE_DIST_CANDIDATES: Record<string, string[]> = {
  "@themoss/core": ["packages/core/dist/index.js"],
  "@themoss/erc": ["packages/erc/dist/index.js"],
  "@themoss/protocol-kuru": [
    "packages/protocols/kuru/dist/index.js",
    "packages/protocol-kuru/dist/index.js",
  ],
  "@themoss/simulator": ["packages/simulator/dist/index.js"],
  "@themoss/system": ["packages/system/dist/index.js"],
};

const PACKAGE_MANIFEST_CANDIDATES: Record<string, string[]> = {
  "@themoss/core": ["packages/core/package.json"],
  "@themoss/erc": ["packages/erc/package.json"],
  "@themoss/protocol-kuru": [
    "packages/protocols/kuru/package.json",
    "packages/protocol-kuru/package.json",
  ],
  "@themoss/simulator": ["packages/simulator/package.json"],
  "@themoss/system": ["packages/system/package.json"],
};

/** Minimal structural shape of the pinned Moss runtime (never exported). */
export type MossRuntimeBundle = {
  core: Record<string, unknown>;
  erc: Record<string, unknown>;
  kuru: Record<string, unknown>;
  simulator: Record<string, unknown>;
  system: Record<string, unknown>;
  packageVersions: Record<string, string>;
};

function firstExisting(runtimePath: string, candidates: string[]): string {
  for (const candidate of candidates) {
    const resolved = join(runtimePath, candidate);
    if (existsSync(resolved)) return resolved;
  }
  throw new Error(
    `Moss runtime at ${runtimePath} is missing one of: ${candidates.join(", ")}`,
  );
}

/**
 * Load every `@themoss/*` package from a pinned Moss checkout and read its
 * exact package.json version. This is the reproducible runtime identity.
 */
export async function loadMossRuntime(
  runtimePath: string,
): Promise<MossRuntimeBundle> {
  if (!existsSync(join(runtimePath, "package.json"))) {
    throw new Error(
      `MOSS_RUNTIME_PATH does not contain a Moss checkout: ${runtimePath}`,
    );
  }
  const [core, erc, kuru, simulator, system] = await Promise.all([
    import(
      pathToFileURL(
        firstExisting(runtimePath, PACKAGE_DIST_CANDIDATES["@themoss/core"]),
      ).href
    ),
    import(
      pathToFileURL(
        firstExisting(runtimePath, PACKAGE_DIST_CANDIDATES["@themoss/erc"]),
      ).href
    ),
    import(
      pathToFileURL(
        firstExisting(
          runtimePath,
          PACKAGE_DIST_CANDIDATES["@themoss/protocol-kuru"],
        ),
      ).href
    ),
    import(
      pathToFileURL(
        firstExisting(
          runtimePath,
          PACKAGE_DIST_CANDIDATES["@themoss/simulator"],
        ),
      ).href
    ),
    import(
      pathToFileURL(
        firstExisting(runtimePath, PACKAGE_DIST_CANDIDATES["@themoss/system"]),
      ).href
    ),
  ]);
  const packageVersions: Record<string, string> = {};
  for (const [name, candidates] of Object.entries(
    PACKAGE_MANIFEST_CANDIDATES,
  )) {
    const manifestPath = firstExisting(runtimePath, candidates);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      version?: string;
    };
    packageVersions[manifest.name ?? name] = manifest.version ?? "unknown";
  }
  return { core, erc, kuru, simulator, system, packageVersions };
}

type MossRegistry = {
  use(...sources: unknown[]): MossRegistry;
  discover(filter: { protocol?: string }): unknown[];
  load(coords: readonly { protocol: string; method: string }[]): unknown[];
  action(
    protocol: string,
    method: string,
    account: string,
    rawParams: Record<string, unknown>,
  ): Promise<unknown>;
  parseReceipt(capability: unknown, changes: unknown): unknown;
};

type MossSimulator = {
  simulate(root: unknown): Promise<unknown>;
};

type LiveContext = {
  registry: MossRegistry;
  simulator: MossSimulator;
  readBlockNumber: () => Promise<string>;
};

function stageError(error: unknown, stage: StageName): NormalizedMossError {
  return classifyLiveError(error, {
    stage,
    source: stage === "QUOTE" ? "quote" : stage === "SIMULATE" ? "rpc" : "moss",
  });
}

async function recordStage(
  context: LiveContext,
  stage: StageName,
  run: () => unknown | Promise<unknown>,
  raw: RawKuruEvidence,
  errors: Record<string, JsonValue>,
  stages: StageRecord[],
  runtime: RuntimeIdentity,
): Promise<boolean> {
  const startedAt = new Date().toISOString();
  const blockNumber = await context.readBlockNumber().catch(() => undefined);
  try {
    const value = await run();
    const finishedAt = new Date().toISOString();
    (raw as Record<string, JsonValue | null>)[stageKey(stage)] =
      toJsonValue(value);
    stages.push({
      stage,
      startedAt,
      finishedAt,
      success: true,
      raw: toJsonValue(value),
      runtime,
      ...(blockNumber ? { blockNumber } : {}),
    });
    return true;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const normalized = stageError(error, stage);
    errors[stageKey(stage)] = toJsonValue(normalized);
    stages.push({
      stage,
      startedAt,
      finishedAt,
      success: false,
      error: normalized,
      raw: toJsonValue(error instanceof Error ? error.message : error),
      runtime,
      ...(blockNumber ? { blockNumber } : {}),
    });
    return false;
  }
}

function stageKey(stage: StageName): keyof RawKuruEvidence {
  if (stage === "DISCOVER") return "discover";
  if (stage === "LOAD") return "load";
  if (stage === "QUOTE") return "quote";
  if (stage === "ACTION") return "action";
  return "simulation";
}

/**
 * Run the full Kuru MON -> USDC live chain:
 * discover -> load -> quote -> action -> simulate.
 *
 * The caller supplies a pinned `runtimeRevision` (Moss git commit or verifiable
 * package identity). If the loaded packages disagree with `runtimeVersion`, the
 * run fails closed with a structured integration error.
 */
export async function runKuruLiveSwap(
  input: LiveKuruAdapterInput,
): Promise<LiveKuruResult> {
  const bundle = await loadMossRuntime(input.runtimePath);
  return runKuruLiveSwapWithBundle(input, bundle);
}

/**
 * Same as `runKuruLiveSwap` with a preloaded runtime bundle. Exported for
 * reproducible tests that inject a deterministic fake runtime; production call
 * sites use `runKuruLiveSwap`.
 */
export async function runKuruLiveSwapWithBundle(
  input: LiveKuruAdapterInput,
  bundle: MossRuntimeBundle,
): Promise<LiveKuruResult> {
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();

  const runtimeVersion = String(
    bundle.core.version ?? bundle.packageVersions["@themoss/core"],
  );
  if (runtimeVersion !== input.runtimeVersion) {
    throw new Error(
      `MOSS runtime mismatch: expected ${input.runtimeVersion}, loaded ${runtimeVersion} (${input.runtimeRevision})`,
    );
  }

  const identity: RuntimeIdentity = {
    runtimeVersion: input.runtimeVersion,
    runtimeRevision: input.runtimeRevision,
    packageVersions: bundle.packageVersions,
  };

  const raw: RawKuruEvidence = {
    discover: null,
    load: null,
    quote: null,
    action: null,
    simulation: null,
  };
  const errors: Record<string, JsonValue> = {};
  const stages: StageRecord[] = [];
  const { createRuntime, Registry } = bundle.core as {
    createRuntime: (opts: { rpcUrl: string }) => Promise<{
      rpcUrl: string;
      client: { getBlockNumber(): Promise<bigint> };
    }>;
    Registry: new (runtime: unknown) => MossRegistry;
  };
  const mossRuntime = await createRuntime({ rpcUrl: input.rpcUrl });
  const client = mossRuntime.client;
  const readBlock = async (): Promise<string> =>
    (await client.getBlockNumber()).toString();
  const initialBlock = await readBlock().catch(() => undefined);
  const registry = new Registry(mossRuntime).use(
    bundle.system,
    bundle.erc,
    bundle.kuru,
  );
  const { createTraceSimulator } = bundle.simulator as {
    createTraceSimulator: (
      runtime: unknown,
      options: {
        receipt: (capability: unknown, changes: unknown) => unknown;
      },
    ) => MossSimulator;
  };
  const simulator = createTraceSimulator(mossRuntime, {
    receipt: (capability, changes) =>
      registry.parseReceipt(capability, changes),
  });
  const context: LiveContext = {
    registry,
    simulator,
    readBlockNumber: readBlock,
  };

  const params = swapParamsOf(input.intent);

  const discovered = await recordStage(
    context,
    "DISCOVER",
    () => registry.discover({ protocol: "kuru" }),
    raw,
    errors,
    stages,
    identity,
  );

  let loaded = discovered;
  if (loaded) {
    loaded = await recordStage(
      context,
      "LOAD",
      () => registry.load([{ protocol: "kuru", method: "swap" }]),
      raw,
      errors,
      stages,
      identity,
    );
  }

  let quoted = loaded;
  if (quoted) {
    quoted = await recordStage(
      context,
      "QUOTE",
      () => registry.action("kuru", "quote", input.intent.sender, params),
      raw,
      errors,
      stages,
      identity,
    );
  }

  let actioned = quoted;
  let capability: unknown;
  if (actioned) {
    actioned = await recordStage(
      context,
      "ACTION",
      async () => {
        const built = await registry.action(
          "kuru",
          "swap",
          input.intent.sender,
          params,
        );
        capability = built;
        return built;
      },
      raw,
      errors,
      stages,
      identity,
    );
  }

  if (actioned && capability !== undefined) {
    await recordStage(
      context,
      "SIMULATE",
      () => simulator.simulate(capability),
      raw,
      errors,
      stages,
      identity,
    );
  }

  const evidence = normalizeLiveKuruEvidence({
    intent: input.intent,
    raw: {
      ...raw,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    },
    runtime: identity,
    fetchedAt,
    stages,
    initialBlock,
  });

  return { runId: input.runId, evidence, raw, stages, runtime: identity };
}

function swapParamsOf(
  intent: LiveKuruAdapterInput["intent"],
): Record<string, unknown> {
  return {
    tokenIn: nativeTokenOf(intent.tokenIn),
    tokenOut: intent.tokenOut,
    amountIn: intent.amountIn,
    slippage: 50,
  };
}

function nativeTokenOf(tokenIn: string): string {
  return tokenIn === "MON" || tokenIn === "native" ? "native" : tokenIn;
}
