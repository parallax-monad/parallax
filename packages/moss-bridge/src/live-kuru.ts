import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyLiveError, StageTimeoutError } from "./errors.js";
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
 *
 * Two-layer timeout: each stage gets `stageTimeoutMs` (default 30s) and the
 * whole chain gets `overallTimeoutMs` (default 90s), both produced by
 * `Promise.race` because Moss APIs do not accept AbortSignal. Internal
 * deadlines are deliberately shorter than the Vitest `testTimeout` (120s) so a
 * timeout can be captured, logged, and written to the artifact directory before
 * the test runner kills the process.
 *
 * Provenance trust levels (kept deliberately separate):
 *   1. Smoke configuration inputs: the smoke harness receives
 *      MOSS_RUNTIME_PATH / MOSS_RUNTIME_VERSION / MOSS_RUNTIME_REVISION from
 *      the operator. The current harness does not independently attest the
 *      checkout Git revision, every loaded `@themoss/*` package identity, the
 *      RPC chain ID, or the simulator's pinned block; full runtime
 *      verification remains downstream.
 *   2. Adapter caller-declared runtime provenance: `runtimeVersion` and
 *      `runtimeRevision` are provided by the caller of `runKuruLiveSwap`.
 *      The adapter fail-closes when the loaded `@themoss/core` version
 *      disagrees with `runtimeVersion`, but it does not independently prove
 *      the checkout Git revision or the identity of every loaded package; the
 *      declared identity is recorded as provenance only.
 *   3. RPC-observed chain and stage blocks: `chainId` is read from the RPC
 *      client and recorded (not enforced to equal 143), and each stage's
 *      `blockNumber` is the block observed through RPC immediately before the
 *      stage call. It is not the block internally pinned by the Moss
 *      simulator (not exposed by the runtime API, Moss ADR 0002), so it must
 *      not be described as the exact simulator block.
 * A consumer must independently re-verify the Moss Git revision, every
 * package identity, the RPC chain ID, and simulator block consistency before
 * interpreting the result as P0_LIVE_READY, authoritative Live Evidence, or
 * production Agent Flow input; it is not authoritative unless re-verified.
 */

const DEFAULT_STAGE_TIMEOUT_MS = 30_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 90_000;

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
  log: (line: string) => void;
};

/** Race a promise against a deadline; the loser rejects with StageTimeoutError. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  stage: string,
): Promise<T> {
  if (ms <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StageTimeoutError(stage, ms)), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function stageError(error: unknown, stage: StageName): NormalizedMossError {
  return classifyLiveError(error, {
    stage,
    source: stage === "QUOTE" ? "quote" : stage === "SIMULATE" ? "rpc" : "moss",
  });
}

function stageLogStatus(error: NormalizedMossError): string {
  if (error.code === "TIMEOUT") return "TIMEOUT";
  if (error.code === "NO_ROUTE") return "NO_ROUTE";
  if (error.code === "REVERTED") return "REVERTED";
  return "ERROR";
}

async function recordStage(
  context: LiveContext,
  stage: StageName,
  run: () => unknown | Promise<unknown>,
  raw: RawKuruEvidence,
  errors: Record<string, JsonValue>,
  stages: StageRecord[],
  runtime: RuntimeIdentity,
  stageTimeoutMs: number,
): Promise<boolean> {
  context.log(`[${stage}] START`);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const blockNumber = await context.readBlockNumber().catch(() => undefined);
  try {
    const value = await withTimeout(
      Promise.resolve().then(run),
      stageTimeoutMs,
      stage,
    );
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
    context.log(
      `[${stage}] OK duration=${Date.now() - startedMs}ms block=${
        blockNumber ?? "n/a"
      }`,
    );
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
    context.log(
      `[${stage}] ${stageLogStatus(normalized)} duration=${
        Date.now() - startedMs
      }ms block=${blockNumber ?? "n/a"} code=${normalized.code}`,
    );
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
  const log = input.logger ?? (() => {});
  const stageTimeoutMs = input.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
  const overallTimeoutMs = input.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;

  const execute = async (): Promise<LiveKuruResult> => {
    const fetchedAt = input.fetchedAt ?? new Date().toISOString();

    const runtimeVersion = String(
      bundle.core.version ?? bundle.packageVersions["@themoss/core"],
    );
    if (runtimeVersion !== input.runtimeVersion) {
      throw new Error(
        `MOSS runtime mismatch: expected ${input.runtimeVersion}, loaded ${runtimeVersion} (${input.runtimeRevision})`,
      );
    }

    // Caller-declared runtime provenance: recorded as provenance, not proven
    // here. A loaded @themoss/core version disagreement fails closed above;
    // the checkout Git revision and full package identity verification remain
    // a downstream/operator responsibility, not an adapter check.
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
        client: {
          getChainId(): Promise<number>;
          getBlockNumber(): Promise<bigint>;
        };
      }>;
      Registry: new (runtime: unknown) => MossRegistry;
    };
    const mossRuntime = await createRuntime({ rpcUrl: input.rpcUrl });
    const client = mossRuntime.client;
    // chainId is observed (read) from the RPC client, not enforced by the
    // adapter; the Smoke Harness and any authoritative consumer must confirm
    // the RPC is on Chain ID 143 before trusting the run.
    const chainId = await client.getChainId().catch(() => undefined);
    const readBlock = async (): Promise<string> =>
      (await client.getBlockNumber()).toString();
    const initialBlock = await readBlock().catch(() => undefined);
    log(
      `[INIT] chainId=${chainId ?? "n/a"} block=${
        initialBlock ?? "n/a"
      } runtimeVersion=${input.runtimeVersion} runtimeRevision=${input.runtimeRevision}`,
    );
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
      log,
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
      stageTimeoutMs,
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
        stageTimeoutMs,
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
        stageTimeoutMs,
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
        stageTimeoutMs,
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
        stageTimeoutMs,
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
  };

  return withTimeout(execute(), overallTimeoutMs, "OVERALL");
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
