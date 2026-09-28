import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPLORER_CAPABILITY_DESCRIPTORS,
  EXPLORER_UNSUPPORTED_CAPABILITIES,
} from "../../apps/api/src/backend/explorer-evidence-source.js";
import {
  assertUnchangedSource,
  captureSourceProvenance,
} from "./native-rpc-source-provenance.js";

/**
 * #108 — two-hour bounded feasibility probe for an `ExplorerEvidenceSource`
 * (Arbiscan / Etherscan V2).
 *
 * The probe answers one question with real observations only:
 *
 *   can an explorer API truthfully supply contract verification, ABI,
 *   deployment, token metadata, historical transaction, receipt, logs, token
 *   transfers, and explorer provenance — and can it never be mistaken for a
 *   simulation, trace, or state-diff provider?
 *
 * It records, per capability and per probed surface, the real HTTP status, the
 * observed rate-limit headers, the normalized facts, and a response
 * fingerprint. Raw response bodies are never persisted. No credential is read,
 * written, or logged.
 *
 * Run:
 *
 *   node --import=tsx/esm scripts/provider-probes/explorer-evidence-feasibility.ts
 */

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");

/** Arbitrum Sepolia targets taken from accepted repository evidence. */
const ROUTER = "0x171B925C51565F5D2a7d8C494ba3188D304EFD93";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const USDC = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const POOL = "0x3965361ea4f9000ae3cf995f553115b2832d0e2d";
const SENDER = "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396";
const ACCEPTED_TX =
  "0xb116ef6ce279668d555498e0e5a836f8ef35f997667e87a75757ec47332a644a";
const PINNED_BLOCK = "310131879";
const PINNED_BLOCK_HASH =
  "0x715bfaca417a25ed4d317748ecf0cfbd0ad38d4e14c2e1c0fb42ac0c8e60feff";
const CHAIN_ID = 421_614;

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";
const ETHERSCAN_V2_CHAINLIST = "https://api.etherscan.io/v2/chainlist";
const LEGACY_ARBISCAN_V1 = "https://api.arbiscan.io/api";
/** Live, keyless, Etherscan-compatible surface for the same chain. */
const LIVE_COMPATIBLE_SURFACE = "https://arbitrum-sepolia.blockscout.com/api";
/** Live, keyless REST surface of the same explorer. */
const LIVE_REST_SURFACE = "https://arbitrum-sepolia.blockscout.com/api/v2";
const USER_AGENT = "parallax-issue108-explorer-feasibility";

/** Documented Etherscan V2 facts, each with its official source URL. */
const DOCUMENTED = {
  apiKeyRequirement: {
    statement: "Every request to the Etherscan API needs an API key.",
    source: "https://docs.etherscan.io/set-up-your-api-key",
  },
  multichain: {
    statement: "All 60+ EVM chains under one key. Set chainid to choose one.",
    source: "https://docs.etherscan.io/introduction",
  },
  rateLimits: {
    source: "https://docs.etherscan.io/rate-limits",
    plans: [
      {
        tier: "Free",
        callsPerSecond: 3,
        callsPerDay: 100000,
        proEndpoints: false,
        note: "selected chains only",
      },
      {
        tier: "Lite",
        callsPerSecond: 5,
        callsPerDay: 100000,
        proEndpoints: false,
        note: "",
      },
      {
        tier: "Standard",
        callsPerSecond: 10,
        callsPerDay: 200000,
        proEndpoints: true,
        note: "",
      },
      {
        tier: "Advanced",
        callsPerSecond: 20,
        callsPerDay: 500000,
        proEndpoints: true,
        note: "",
      },
      {
        tier: "Professional",
        callsPerSecond: 30,
        callsPerDay: 1000000,
        proEndpoints: true,
        note: "",
      },
      {
        tier: "Pro Plus",
        callsPerSecond: 30,
        callsPerDay: 1500000,
        proEndpoints: true,
        note: "",
      },
      {
        tier: "Dedicated/Custom",
        callsPerSecond: null,
        callsPerDay: null,
        proEndpoints: true,
        note: "contact us",
      },
    ],
  },
  tokenMetadataIsPro: {
    statement:
      "Get Token Info by ContractAddress is a PRO endpoint, available to the Standard Plan and above, throttled to 2 calls/second; the free plan documents tokensupply/tokenbalance only.",
    source: "https://docs.etherscan.io/api-reference/endpoint/tokeninfo",
  },
} as const;

type ProbeResponse = {
  readonly http: number;
  readonly ms: number;
  readonly limit: string | null;
  readonly remaining: string | null;
  readonly bodySha256: string;
  readonly body: unknown;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNode22(version: string): void {
  if (!/^v22\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error("Explorer feasibility probe requires Node 22.x");
  }
}

async function request(url: string): Promise<ProbeResponse> {
  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { unparsed: text.slice(0, 120) };
  }
  return {
    http: response.status,
    ms: Date.now() - startedAt,
    limit: response.headers.get("x-ratelimit-limit"),
    remaining: response.headers.get("x-ratelimit-remaining"),
    bodySha256: sha256(text),
    body,
  };
}

function query(base: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }
  return `${base}?${search.toString()}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function envelopeSummary(response: ProbeResponse) {
  const body = asRecord(response.body);
  const result = body?.result;
  return {
    http: response.http,
    status: typeof body?.status === "string" ? body.status : null,
    message: typeof body?.message === "string" ? body.message : null,
    resultKind: Array.isArray(result)
      ? "array"
      : result === null
        ? "null"
        : typeof result,
    resultLength: Array.isArray(result) ? result.length : null,
    resultText: typeof result === "string" ? result.slice(0, 80) : null,
    responseSha256: response.bodySha256,
    rateLimitLimit: response.limit,
    rateLimitRemaining: response.remaining,
  };
}

function firstEntry(response: ProbeResponse): Record<string, unknown> {
  const result = asRecord(response.body)?.result;
  const entries = Array.isArray(result) ? result : [result];
  return asRecord(entries[0]) ?? {};
}

function textField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function fingerprintText(value: string): string {
  return `sha256:${sha256(value)}`;
}

async function main(): Promise<void> {
  assertNode22(process.version);

  const sourceProvenance = captureSourceProvenance(REPO_ROOT);
  const runnerSha256 = sha256(readFileSync(SCRIPT_PATH));
  const capturedAt = new Date().toISOString();

  // 1) Etherscan V2: keyless auth requirement, on the target chain.
  const v2Keyless = await request(
    query(ETHERSCAN_V2_API, {
      chainid: CHAIN_ID,
      module: "contract",
      action: "getsourcecode",
      address: ROUTER,
    }),
  );

  // 2) Etherscan V2 chainlist: keyless, authoritative chain support.
  const chainlist = await request(ETHERSCAN_V2_CHAINLIST);
  const chainlistResult = asRecord(chainlist.body)?.result;
  const chains = Array.isArray(chainlistResult) ? chainlistResult : [];
  const arbitrumChains = chains
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .filter((entry) =>
      ["42161", "421614"].includes(String(entry.chainid ?? "")),
    )
    .map((entry) => ({
      chainname: entry.chainname ?? null,
      chainid: String(entry.chainid ?? ""),
      blockexplorer: entry.blockexplorer ?? null,
      apiurl: entry.apiurl ?? null,
      status: entry.status ?? null,
      comment: entry.comment ?? null,
    }));

  // 3) Legacy Arbiscan V1 API: observed migration state.
  const legacyV1 = await request(
    query(LEGACY_ARBISCAN_V1, {
      module: "contract",
      action: "getsourcecode",
      address: ROUTER,
      apikey: "YourApiKeyToken",
    }),
  );

  // 4) Live keyless Etherscan-compatible surface, capability by capability.
  const compatible: Record<string, unknown>[] = [];
  const compatibleCalls: Array<[string, Record<string, string | number>]> = [
    [
      "contract-verification",
      { module: "contract", action: "getsourcecode", address: ROUTER },
    ],
    [
      "contract-abi",
      { module: "contract", action: "getsourcecode", address: WETH },
    ],
    [
      "deployment",
      {
        module: "contract",
        action: "getcontractcreation",
        contractaddresses: ROUTER,
      },
    ],
    [
      "token-metadata",
      { module: "token", action: "getToken", contractaddress: USDC },
    ],
    [
      "logs",
      {
        module: "logs",
        action: "getLogs",
        address: POOL,
        fromBlock: PINNED_BLOCK,
        toBlock: PINNED_BLOCK,
      },
    ],
    [
      "token-transfers",
      {
        module: "account",
        action: "tokentx",
        address: SENDER,
        startblock: 0,
        endblock: 99999999,
        sort: "asc",
      },
    ],
    [
      "transaction",
      {
        module: "proxy",
        action: "eth_getTransactionByHash",
        txhash: ACCEPTED_TX,
      },
    ],
    [
      "receipt",
      {
        module: "proxy",
        action: "eth_getTransactionReceipt",
        txhash: ACCEPTED_TX,
      },
    ],
  ];

  for (const [capability, params] of compatibleCalls) {
    const response = await request(query(LIVE_COMPATIBLE_SURFACE, params));
    compatible.push({
      capability,
      request: { module: params.module, action: params.action },
      envelope: envelopeSummary(response),
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
  }

  // Re-read the two live-verified capability responses once so the capture can
  // carry normalized facts as well as the envelope summary.
  const verificationResponse = await request(
    query(LIVE_COMPATIBLE_SURFACE, {
      module: "contract",
      action: "getsourcecode",
      address: ROUTER,
    }),
  );
  const verificationFact = firstEntry(verificationResponse);
  const sourceCode = textField(verificationFact, "SourceCode") ?? "";
  const abi = textField(verificationFact, "ABI") ?? "";

  const tokenResponse = await request(
    query(LIVE_COMPATIBLE_SURFACE, {
      module: "token",
      action: "getToken",
      contractaddress: USDC,
    }),
  );
  const tokenFact = asRecord(asRecord(tokenResponse.body)?.result) ?? {};

  // 5) Live keyless REST surface of the same explorer: cross-checks the
  //    capabilities the Etherscan-compatible surface did not serve.
  const restCalls: Array<[string, string]> = [
    ["transaction", `${LIVE_REST_SURFACE}/transactions/${ACCEPTED_TX}`],
    ["logs", `${LIVE_REST_SURFACE}/transactions/${ACCEPTED_TX}/logs`],
    ["contract-verification", `${LIVE_REST_SURFACE}/smart-contracts/${ROUTER}`],
    ["deployment", `${LIVE_REST_SURFACE}/addresses/${ROUTER}`],
    ["token-metadata", `${LIVE_REST_SURFACE}/tokens/${USDC}`],
    [
      "token-transfers",
      `${LIVE_REST_SURFACE}/addresses/${SENDER}/token-transfers`,
    ],
    ["provenance", `${LIVE_REST_SURFACE}/blocks/${PINNED_BLOCK}`],
  ];

  const rest: Record<string, unknown>[] = [];
  for (const [capability, url] of restCalls) {
    const response = await request(url);
    const body = asRecord(response.body) ?? {};
    rest.push({
      capability,
      http: response.http,
      rateLimitLimit: response.limit,
      rateLimitRemaining: response.remaining,
      responseSha256: response.bodySha256,
      items: Array.isArray(body.items) ? body.items.length : null,
      facts: restFacts(capability, body),
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }

  const restTransaction = rest.find(
    (entry) => entry.capability === "transaction",
  );
  const restLogs = rest.find((entry) => entry.capability === "logs");
  const restBlock = rest.find((entry) => entry.capability === "provenance");

  const referenced = restBlock?.facts as
    | Record<string, string | number | null>
    | undefined;

  if (
    referenced?.blockHash !== undefined &&
    String(referenced.blockHash).toLowerCase() !==
      PINNED_BLOCK_HASH.toLowerCase()
  ) {
    throw new Error(
      "Explorer provenance did not reproduce the accepted pinned block hash",
    );
  }

  const capabilityMatrix = EXPLORER_CAPABILITY_DESCRIPTORS.map((descriptor) => {
    const compatibleEntry = compatible.find(
      (entry) => entry.capability === descriptor.capability,
    );
    const restEntry = rest.find(
      (entry) => entry.capability === descriptor.capability,
    );
    return {
      capability: descriptor.capability,
      request: descriptor.request,
      verification: descriptor.verification,
      note: descriptor.note ?? null,
      etherscanV2Documented: true,
      etherscanV2Observed: "auth_required_no_key",
      liveCompatibleSurface: compatibleEntry?.envelope ?? null,
      liveRestSurface: restEntry ?? null,
      normalizedFacts: normalizedFactsFor(descriptor.capability, {
        verificationFact,
        tokenFact,
        sourceCode,
        abi,
        restTransaction,
        restLogs,
        restBlock,
      }),
    };
  });

  const etherscanV2Auth = envelopeSummary(v2Keyless);
  if (etherscanV2Auth.resultText !== "Missing/Invalid API Key") {
    throw new Error(
      "Etherscan V2 keyless response did not report the expected auth requirement",
    );
  }
  if (arbitrumChains.length !== 2) {
    throw new Error("Etherscan V2 chainlist did not list both Arbitrum chains");
  }

  const evidence = {
    schemaVersion: "be-108-explorer-evidence-feasibility-v1",
    status: "PARTIAL",
    real: true,
    readOnly: true,
    capturedAt,
    chainId: CHAIN_ID,
    repositoryHeadAtCapture: sourceProvenance.repositoryHead,
    sourceProvenance,
    runner: {
      path: relative(REPO_ROOT, SCRIPT_PATH),
      sha256: runnerSha256,
      nodeVersion: process.version,
    },
    conclusion: {
      explorerCanProvide: EXPLORER_CAPABILITY_DESCRIPTORS.map(
        (entry) => entry.capability,
      ),
      explorerCannotProvide: [...EXPLORER_UNSUPPORTED_CAPABILITIES],
      etherscanV2CredentialedQualification: "BLOCKED_MISSING_API_KEY",
      etherscanV2SemanticsQualification: "PARTIAL_DOCUMENTED_ONLY",
      liveSemanticsQualification:
        "KEYLESS_ETHERSCAN_COMPATIBLE_SURFACE_SAME_CHAIN",
      productionIntegration: "NOT_STARTED",
    },
    etherscanV2: {
      requestTemplate:
        "https://api.etherscan.io/v2/api?chainid=<chainId>&module=<module>&action=<action>&apikey=<key>",
      keylessObserved: etherscanV2Auth,
      documented: DOCUMENTED,
    },
    arbiscan: {
      explorerArbitrumOne: "https://arbiscan.io/",
      explorerArbitrumSepolia: "https://sepolia.arbiscan.io/",
      legacyV1Observed: envelopeSummary(legacyV1),
    },
    chainSupport: {
      source: `${ETHERSCAN_V2_CHAINLIST} (keyless)`,
      http: chainlist.http,
      totalcount: asRecord(chainlist.body)?.totalcount ?? null,
      arbitrumChains,
    },
    rateLimits: {
      documented: DOCUMENTED.rateLimits,
      observedSurfaces: [
        {
          surface: LIVE_COMPATIBLE_SURFACE,
          keyless: true,
          observedLimitHeader:
            compatible.find((entry) => {
              const envelope = entry.envelope as Record<string, unknown>;
              return envelope.rateLimitLimit !== null;
            })?.envelope ?? null,
        },
        {
          surface: LIVE_REST_SURFACE,
          keyless: true,
          observedLimitHeader: rest[0]?.rateLimitLimit ?? null,
        },
      ],
    },
    probeSurfaces: [
      {
        id: "etherscan-v2",
        role: "target credential-gated Arbiscan / Etherscan V2 API",
        api: ETHERSCAN_V2_API,
        keyless: false,
        credentialAvailable: false,
      },
      {
        id: "etherscan-compatible-live",
        role: "live Etherscan-compatible surface on the same chain",
        api: LIVE_COMPATIBLE_SURFACE,
        keyless: true,
      },
      {
        id: "explorer-rest-live",
        role: "live explorer REST surface on the same chain",
        api: LIVE_REST_SURFACE,
        keyless: true,
      },
    ],
    capabilityMatrix,
    scope: {
      simulation: false,
      trace: false,
      stateDiff: false,
      providerRanking: false,
      providerVoting: false,
      automaticFallback: false,
      signing: false,
      broadcasting: false,
      custody: false,
      credentialsRead: false,
      credentialsPersisted: false,
      rawProviderPayloadPersisted: false,
    },
  };

  assertUnchangedSource(sourceProvenance, captureSourceProvenance(REPO_ROOT));

  if (sha256(readFileSync(SCRIPT_PATH)) !== runnerSha256) {
    throw new Error("Explorer feasibility runner changed during execution");
  }

  const stamp = capturedAt.replaceAll(":", "-").replaceAll(".", "-");
  const outputDirectory = join(
    REPO_ROOT,
    "fixtures",
    "provider-registry",
    "be-108",
    `explorer-feasibility-${stamp}`,
  );

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    join(outputDirectory, "capture.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );

  process.stdout.write(
    `${JSON.stringify({
      status: "PARTIAL",
      etherscanV2Keyless: etherscanV2Auth.resultText,
      arbitrumChains,
      compatibleSurface: compatible.map((entry) => {
        const envelope = entry.envelope as Record<string, unknown>;
        return {
          capability: entry.capability,
          http: envelope.http,
          status: envelope.status,
          message: envelope.message,
        };
      }),
      restSurface: rest.map((entry) => ({
        capability: entry.capability,
        http: entry.http,
        items: entry.items,
        facts: entry.facts,
      })),
      output: relative(REPO_ROOT, outputDirectory),
    })}\n`,
  );
}

function restFacts(
  capability: string,
  body: Record<string, unknown>,
): Record<string, string | number | null> {
  if (capability === "transaction") {
    return {
      hash: typeof body.hash === "string" ? body.hash : null,
      blockNumber:
        typeof body.block_number === "number" ? body.block_number : null,
      status: typeof body.status === "string" ? body.status : null,
      result: typeof body.result === "string" ? body.result : null,
      gasUsed: typeof body.gas_used === "string" ? body.gas_used : null,
    };
  }
  if (capability === "logs") {
    const items = Array.isArray(body.items) ? body.items : [];
    const first = asRecord(items[0]);
    const topics = Array.isArray(first?.topics) ? first?.topics : [];
    return {
      logCount: items.length,
      topic0: typeof topics[0] === "string" ? topics[0] : null,
    };
  }
  if (capability === "contract-verification") {
    return {
      isVerified: body.is_verified === true ? "true" : "false",
      language: typeof body.language === "string" ? body.language : null,
      compilerVersion:
        typeof body.compiler_version === "string"
          ? body.compiler_version
          : null,
      verifiedAt:
        typeof body.verified_at === "string" ? body.verified_at : null,
      abiEntries: Array.isArray(body.abi) ? body.abi.length : null,
    };
  }
  if (capability === "deployment") {
    return {
      isContract: body.is_contract === true ? "true" : "false",
      name: typeof body.name === "string" ? body.name : null,
      creatorAddress:
        typeof body.creator_address_hash === "string"
          ? body.creator_address_hash
          : null,
      creationTransaction:
        typeof body.creation_transaction_hash === "string"
          ? body.creation_transaction_hash
          : null,
    };
  }
  if (capability === "token-metadata") {
    return {
      name: typeof body.name === "string" ? body.name : null,
      symbol: typeof body.symbol === "string" ? body.symbol : null,
      decimals: typeof body.decimals === "string" ? body.decimals : null,
      type: typeof body.type === "string" ? body.type : null,
      totalSupply:
        typeof body.total_supply === "string" ? body.total_supply : null,
    };
  }
  if (capability === "token-transfers") {
    return {
      items: Array.isArray(body.items) ? body.items.length : null,
    };
  }
  return {
    height: typeof body.height === "number" ? body.height : null,
    blockHash: typeof body.hash === "string" ? body.hash : null,
    timestamp: typeof body.timestamp === "string" ? body.timestamp : null,
  };
}

function normalizedFactsFor(
  capability: string,
  context: {
    verificationFact: Record<string, unknown>;
    tokenFact: Record<string, unknown>;
    sourceCode: string;
    abi: string;
    restTransaction: Record<string, unknown> | undefined;
    restLogs: Record<string, unknown> | undefined;
    restBlock: Record<string, unknown> | undefined;
  },
): Record<string, string | number | boolean | null> {
  if (capability === "contract-verification") {
    return {
      contractName: textField(context.verificationFact, "ContractName"),
      compilerVersion: textField(context.verificationFact, "CompilerVersion"),
      optimizationUsed: textField(context.verificationFact, "OptimizationUsed"),
      isProxy: textField(context.verificationFact, "IsProxy"),
      sourceFingerprint: context.sourceCode
        ? fingerprintText(context.sourceCode)
        : null,
      verified: context.sourceCode !== "",
    };
  }
  if (capability === "contract-abi") {
    return {
      abiFingerprint: context.abi ? fingerprintText(context.abi) : null,
      abiEntryCount: (() => {
        try {
          const parsed = JSON.parse(context.abi);
          return Array.isArray(parsed) ? parsed.length : null;
        } catch {
          return null;
        }
      })(),
    };
  }
  if (capability === "token-metadata") {
    return {
      name: textField(context.tokenFact, "name"),
      symbol: textField(context.tokenFact, "symbol"),
      decimals: textField(context.tokenFact, "decimals"),
      type: textField(context.tokenFact, "type"),
      totalSupply: textField(context.tokenFact, "totalSupply"),
    };
  }
  if (capability === "transaction") {
    return (
      (context.restTransaction?.facts as Record<
        string,
        string | number | null
      >) ?? {}
    );
  }
  if (capability === "logs") {
    return (
      (context.restLogs?.facts as Record<string, string | number | null>) ?? {}
    );
  }
  if (capability === "provenance") {
    return (
      (context.restBlock?.facts as Record<string, string | number | null>) ?? {}
    );
  }
  return {};
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown feasibility failure";
    process.stderr.write(`Explorer evidence feasibility failed: ${message}\n`);
    process.exitCode = 1;
  });
}
