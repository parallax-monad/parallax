import { runResultSchema } from "@parallax/contracts";
import { describe, expect, it, vi } from "vitest";
import { assertAttestorSignerMatches } from "./cli.js";
import {
  assertDecisionAnchorMatchesPersistedRun,
  buildDecisionRecordV1,
  canonicalizeJsonV1,
  deriveCommitment,
  keccak256Hex,
  prepareDecisionAnchor,
  verifyDecisionAnchorBundle,
} from "./decision-record.js";
import {
  readRpcChainId,
  runtimeBytecodeMatches,
  verifyDecisionAnchorOnchain,
  verifyRegistryDeployment,
} from "./rpc.js";

const runId = "9ca8a0f8-9ad5-4e17-9b45-25d3ca330ce8";
const registryAddress = "0x1234567890123456789012345678901234567890";
const sender = "0x1111111111111111111111111111111111111111";
const tokenOut = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const createdAt = "2026-10-04T09:00:00.000Z";

function persistedRun(
  overrides: {
    replayMode?: boolean;
    outerRunId?: string;
    envelopeStatus?: "started";
    summary?: string;
    omitResultCreatedAt?: boolean;
    evidencePresentation?: unknown;
    providerData?: Record<string, unknown>;
  } = {},
) {
  const replayMode = overrides.replayMode ?? false;
  const intent = {
    chainId: 421614,
    protocol: "camelot-v3",
    sender,
    recipient: sender,
    recipientSource: "defaulted_from_sender",
    tokenIn: { kind: "native" },
    tokenOut: { kind: "erc20", address: tokenOut },
    amountInAtomic: "1000000000000000",
    economicBoundary: { availability: "unavailable", source: "unavailable" },
  };
  const routeEvidence = {
    kind: "generic",
    key: "route-quote",
    status: "confirmed",
    summary: "A route quote was observed",
    source: "quote",
    stage: "QUOTE",
    blockNumber: "12345",
    runtimeVersion: "test-runtime",
    runtimeRevision: "test-revision",
    reproducibility: "REPRODUCIBLE",
    ...(replayMode ? { fixtureId: "fixture-1" } : {}),
    isReplay: replayMode,
    isMock: false,
    routeInputRole: "ROUTE_QUOTE",
  };
  const routeEvidenceRef = {
    key: routeEvidence.key,
    source: routeEvidence.source,
    stage: routeEvidence.stage,
    blockNumber: routeEvidence.blockNumber,
    ...(replayMode ? { fixtureId: "fixture-1" } : {}),
    reproducibility: routeEvidence.reproducibility,
    isReplay: routeEvidence.isReplay,
    isMock: routeEvidence.isMock,
    runtimeVersion: routeEvidence.runtimeVersion,
    runtimeRevision: routeEvidence.runtimeRevision,
  };
  const result = runResultSchema.parse({
    runId,
    ...(overrides.omitResultCreatedAt ? {} : { createdAt }),
    replayMode,
    intent,
    status: "completed",
    systemStatus: "OK",
    verdict: "UNKNOWN",
    summary:
      overrides.summary ??
      "Live check could not establish a trustworthy result",
    ruleResults: [
      {
        ruleId: "P0-ECONOMIC-001",
        status: "NOT_APPLICABLE",
        applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
        evidenceRefs: [],
        actionEvaluations: [],
      },
    ],
    recommendedActions: [],
    irrelevantActions: [],
    evidence: [routeEvidence],
    scope: [
      {
        key: "P0-ECONOMIC-001",
        label: "Economic result",
        status: "not_checked",
        reason: "PRECONDITION_ABSENT",
      },
      {
        key: "OUTSIDE_P0_SCOPE",
        label: "Complete protocol security",
        status: "not_checked",
        reason: "OUTSIDE_P0_SCOPE",
      },
    ],
    route: {
      availability: "available",
      protocol: "camelot-v3",
      path: [{ kind: "native" }, { kind: "erc20", address: tokenOut }],
      source: "quote",
      blockNumber: "12345",
      evidenceRef: routeEvidenceRef,
    },
    ...(overrides.evidencePresentation === undefined
      ? {}
      : { evidencePresentation: overrides.evidencePresentation }),
    ...(overrides.providerData === undefined
      ? {}
      : {
          providerEvidence: {
            intent: {
              chainId: 421614,
              protocol: "camelot-v3",
              sender,
              tokenIn: "native",
              tokenOut,
              amountIn: "0.001",
              minimumReceivedSource: "unavailable",
            },
            provider: {
              providerId: "test-provider",
              status: "UNKNOWN",
              integrationStatus: "OK",
              errors: {
                value: [],
                source: "unknown",
                reproducibility: "UNKNOWN",
              },
            },
            execution: { status: "UNKNOWN" },
            quote: {
              value: null,
              source: "unknown",
              reproducibility: "UNKNOWN",
            },
            action: {
              value: null,
              source: "unknown",
              reproducibility: "UNKNOWN",
            },
            receipt: {
              value: null,
              source: "unknown",
              reproducibility: "UNKNOWN",
            },
            outcome: {
              value: null,
              source: "unknown",
              reproducibility: "UNKNOWN",
            },
            assetChanges: {
              value: null,
              source: "unknown",
              reproducibility: "UNKNOWN",
            },
            assetChangeAssessment: "UNKNOWN",
            warnings: {
              value: null,
              source: "unknown",
              reproducibility: "UNKNOWN",
            },
            simulation: {
              value: null,
              source: "unknown",
              reproducibility: "UNKNOWN",
            },
            blockNumber: {
              value: null,
              source: "unknown",
              reproducibility: "UNKNOWN",
            },
            capabilities: [],
            provenance: { mode: "LIVE", source: "rpc" },
            checkedScope: [],
            unknownScope: [],
            providerData: overrides.providerData,
          },
        }),
  });

  return {
    runId: overrides.outerRunId ?? runId,
    createdAt,
    intent,
    status: overrides.envelopeStatus ?? "completed",
    result,
  };
}

describe("decision record commitment", () => {
  it("only anchors the bundle whose record matches the persisted API Run", () => {
    const bundle = prepareDecisionAnchor(persistedRun(), {
      chainId: 421614,
      registryAddress,
    });

    expect(() =>
      assertDecisionAnchorMatchesPersistedRun(bundle, persistedRun()),
    ).not.toThrow();
    expect(() =>
      assertDecisionAnchorMatchesPersistedRun(
        bundle,
        persistedRun({ summary: "A different persisted decision" }),
      ),
    ).toThrow(/does not match the persisted Run returned by the API/iu);
  });

  it("refuses to anchor from an account other than the immutable attestor", () => {
    const attestor = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(() => assertAttestorSignerMatches(attestor, attestor)).not.toThrow();
    expect(() =>
      assertAttestorSignerMatches(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        attestor,
      ),
    ).toThrow(/no transaction sent/iu);
    expect(() =>
      assertAttestorSignerMatches("not-an-address", attestor),
    ).toThrow(/valid non-zero addresses/iu);
    const zeroAddress = `0x${"0".repeat(40)}`;
    expect(() => assertAttestorSignerMatches(zeroAddress, attestor)).toThrow(
      /non-zero/iu,
    );
    expect(() => assertAttestorSignerMatches(attestor, zeroAddress)).toThrow(
      /non-zero/iu,
    );
  });

  it("canonicalizes object keys and produces Ethereum Keccak-256", () => {
    expect(canonicalizeJsonV1({ z: 1, a: { b: true, a: "x" } })).toBe(
      '{"a":{"a":"x","b":true},"z":1}',
    );
    expect(keccak256Hex(new Uint8Array())).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    expect(() => canonicalizeJsonV1("\ud800")).toThrow(/Unicode/iu);
    expect(() => canonicalizeJsonV1(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /imprecise/iu,
    );
  });

  it("pins the complete V1 Run-key and commitment test vector", () => {
    const bundle = prepareDecisionAnchor(persistedRun(), {
      chainId: 421614,
      registryAddress,
    });

    expect(bundle.runKey).toBe(
      "0x7df5777ba581595efa57a91f87926b87faa3ad34644d6b6f418466c29b40e4fb",
    );
    expect(bundle.recordHash).toBe(
      "0xbd9489b2b9370b9722e979b06a4cd23ce007bee57b43fc4db7de135bdda2016f",
    );
    expect(bundle.commitment).toBe(
      "0x01b55c9f666d1fcbdd61f4726216e9c0139fa1af9373e4e5da260bd0aa043af8",
    );
  });

  it("verifies V1 snapshots without reinterpreting nested data as today's Run schema", () => {
    const bundle = prepareDecisionAnchor(persistedRun(), {
      chainId: 421614,
      registryAddress,
    });
    const record = JSON.parse(JSON.stringify(bundle.record)) as {
      decision: { evidence: Array<Record<string, unknown>> };
    };
    record.decision.evidence = [
      { ...record.decision.evidence[0], historicalV1Field: "preserved" },
    ];
    const recordHash = keccak256Hex(
      new TextEncoder().encode(canonicalizeJsonV1(record)),
    );
    const commitment = deriveCommitment(
      bundle.chainId,
      bundle.registryAddress,
      bundle.runKey,
      recordHash,
    );

    expect(
      verifyDecisionAnchorBundle({ ...bundle, record, recordHash, commitment }),
    ).toEqual({ runKey: bundle.runKey, recordHash, commitment });
  });

  it("matches only the compiled runtime bytecode apart from immutable slots", () => {
    const artifact = {
      object: "0x600100006002",
      immutableReferences: { attestor: [{ start: 2, length: 2 }] },
    };
    expect(runtimeBytecodeMatches("0x6001aabb6002", artifact)).toBe(true);
    expect(runtimeBytecodeMatches("0x6001aabb6003", artifact)).toBe(false);
  });

  it("verifies a Sepolia deployment and fixed attestor without a Run bundle", async () => {
    const attestor = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const registry = "0x2222222222222222222222222222222222222222";
    const attestorSelector = keccak256Hex(
      new TextEncoder().encode("attestor()"),
    ).slice(0, 10);
    const methods: string[] = [];
    const request = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
          params: Array<{ data?: string }>;
        };
        methods.push(body.method);
        const result =
          body.method === "eth_chainId"
            ? "0x66eee"
            : body.method === "eth_getCode"
              ? "0x6000"
              : body.params[0]?.data === attestorSelector
                ? `0x${"0".repeat(24)}${attestor.slice(2)}`
                : `0x${"0".repeat(64)}`;
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;

    await expect(
      verifyRegistryDeployment(
        "https://rpc.example",
        registry,
        421614,
        { object: "0x6000", immutableReferences: {} },
        attestor,
        request,
      ),
    ).resolves.toEqual({
      status: "MATCH",
      chainId: 421614,
      registryAddress: registry,
      attestor,
    });
    expect(methods).toEqual([
      "eth_chainId",
      "eth_getCode",
      "eth_call",
      "eth_call",
    ]);

    const missingCodeRequest = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        const result = body.method === "eth_chainId" ? "0x66eee" : "0x";
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    await expect(
      verifyRegistryDeployment(
        "https://rpc.example",
        registry,
        421614,
        { object: "0x6000", immutableReferences: {} },
        attestor,
        missingCodeRequest,
      ),
    ).rejects.toThrow(/No verified ParallaxDecisionRegistry/iu);
  });

  it("requires TLS for remote RPC and refuses RPC redirects", async () => {
    const request = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        const body = JSON.parse(String(init?.body)) as { id: number };
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x66eee" }),
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;

    await expect(readRpcChainId("http://rpc.example", request)).rejects.toThrow(
      /HTTPS except on loopback/iu,
    );
    expect(request).not.toHaveBeenCalled();
    await expect(readRpcChainId("https://rpc.example", request)).resolves.toBe(
      421614,
    );
  });

  it("builds a stable, versioned record from a persisted live Run only", () => {
    const first = buildDecisionRecordV1(persistedRun(), {
      chainId: 421614,
      registryAddress,
    });
    const mixedCaseAddress = "0x1234567890AbCdEf1234567890aBcDeF12345678";
    const second = buildDecisionRecordV1(persistedRun(), {
      chainId: 421614,
      registryAddress: mixedCaseAddress,
    });

    expect(first.registry.address).toBe(registryAddress);
    expect(second.registry.address).toBe(mixedCaseAddress.toLowerCase());
    expect(first).toMatchObject({
      schema: "parallax.decision-record",
      version: 1,
      registry: { chainId: 421614, address: registryAddress },
      run: { runId, createdAt, replayMode: false },
      decision: { status: "completed", verdict: "UNKNOWN" },
    });
    expect(first).not.toHaveProperty("decision.evidencePresentation");
    expect(first).not.toHaveProperty("decision.providerEvidence.providerData");

    const withDisplayProjection = buildDecisionRecordV1(
      persistedRun({
        evidencePresentation: { version: 1, items: [], capabilities: [] },
      }),
      { chainId: 421614, registryAddress },
    );
    expect(withDisplayProjection).not.toHaveProperty(
      "decision.evidencePresentation",
    );

    expect(
      buildDecisionRecordV1(persistedRun({ omitResultCreatedAt: true }), {
        chainId: 421614,
        registryAddress,
      }).run.createdAt,
    ).toBe(createdAt);
  });

  it.each([
    ["started records", { envelopeStatus: "started" }],
    ["replayed runs", { replayMode: true }],
    ["mismatched outer Run IDs", { outerRunId: "another-run" }],
  ] as const)("rejects %s", (_label, overrides) => {
    expect(() =>
      buildDecisionRecordV1(persistedRun(overrides), {
        chainId: 421614,
        registryAddress,
      }),
    ).toThrow();
  });

  it("excludes provider payloads but commits normalized decision changes", () => {
    const clean = prepareDecisionAnchor(persistedRun(), {
      chainId: 421614,
      registryAddress,
    });
    const cleanWithProvider = prepareDecisionAnchor(
      persistedRun({ providerData: {} }),
      { chainId: 421614, registryAddress },
    );
    const withSecret = prepareDecisionAnchor(
      persistedRun({ providerData: { secret: "raw-rpc-payload" } }),
      { chainId: 421614, registryAddress },
    );
    const changedDecision = prepareDecisionAnchor(
      persistedRun({ summary: "A materially different decision summary" }),
      { chainId: 421614, registryAddress },
    );
    expect(withSecret.recordHash).toBe(cleanWithProvider.recordHash);
    expect(changedDecision.recordHash).not.toBe(clean.recordHash);
    expect(JSON.stringify(withSecret)).not.toContain("raw-rpc-payload");
    expect(withSecret.record.decision.providerEvidence).toMatchObject({
      providerData: {},
    });
  });

  it("detects changed snapshot data and recomputes the complete bundle", () => {
    const bundle = prepareDecisionAnchor(persistedRun(), {
      chainId: 421614,
      registryAddress,
    });
    expect(verifyDecisionAnchorBundle(bundle)).toEqual({
      runKey: bundle.runKey,
      recordHash: bundle.recordHash,
      commitment: bundle.commitment,
    });

    expect(() =>
      verifyDecisionAnchorBundle({
        ...bundle,
        record: {
          ...bundle.record,
          decision: { ...bundle.record.decision, summary: "tampered" },
        },
      }),
    ).toThrow(/local commitment verification/iu);
  });

  it("independently checks the on-chain view on the expected network", async () => {
    const bundle = prepareDecisionAnchor(persistedRun(), {
      chainId: 421614,
      registryAddress,
    });
    const calls: string[] = [];
    const attestorAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const attestorSelector = keccak256Hex(
      new TextEncoder().encode("attestor()"),
    ).slice(0, 10);
    const mockedFetch = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
          params: Array<{ data?: string }>;
        };
        calls.push(request.method);
        const result =
          request.method === "eth_chainId"
            ? "0x66eee"
            : request.method === "eth_getCode"
              ? "0x6000"
              : request.params[0]?.data === attestorSelector
                ? `0x${"0".repeat(24)}${attestorAddress.slice(2)}`
                : bundle.commitment;
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;

    await expect(
      verifyDecisionAnchorOnchain(
        bundle,
        "https://rpc.example",
        { object: "0x6000", immutableReferences: {} },
        attestorAddress,
        mockedFetch,
      ),
    ).resolves.toMatchObject({
      status: "MATCH",
      commitment: bundle.commitment,
    });
    expect(calls).toEqual([
      "eth_chainId",
      "eth_getCode",
      "eth_call",
      "eth_call",
    ]);
    await expect(
      verifyDecisionAnchorOnchain(
        bundle,
        "https://rpc.example",
        { object: "0x6001", immutableReferences: {} },
        attestorAddress,
        mockedFetch,
      ),
    ).rejects.toThrow(/does not match ParallaxDecisionRegistry/iu);
    await expect(
      verifyDecisionAnchorOnchain(
        bundle,
        "https://rpc.example",
        { object: "0x6000", immutableReferences: {} },
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        mockedFetch,
      ),
    ).rejects.toThrow(/attestor does not match/iu);

    const wrongNetworkFetch = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: request.method === "eth_chainId" ? "0x1" : "0x6000",
          }),
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    await expect(
      verifyDecisionAnchorOnchain(
        bundle,
        "https://rpc.example",
        { object: "0x6000", immutableReferences: {} },
        attestorAddress,
        wrongNetworkFetch,
      ),
    ).rejects.toThrow(/network does not match/iu);
  });
});
