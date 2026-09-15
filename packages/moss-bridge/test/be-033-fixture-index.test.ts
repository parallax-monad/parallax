import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Deterministic validation of the BE-033 Moss handoff fixture index.
 *
 * This test is offline-only: it reads repository JSON and never calls a
 * Provider, RPC endpoint, or the network. It keeps the machine-readable index
 * truthful (real vs mock/rule/unavailable), resolvable (every non-null path
 * exists), and internally consistent with the Provider Owner handoff.
 */

const FIXTURE_INDEX_URL = new URL(
  "../../../fixtures/provider-registry/be-033/moss/fixture-index.json",
  import.meta.url,
);

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Capture = {
  runId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  recordedAt?: string;
  parallaxCommitAtCapture: string | null;
};

type RuntimeIdentity = {
  runtimeVersion: string | null;
  runtimeRevision: string | null;
  runtimeVersionNote?: string;
};

type RequestScope = {
  direction: string | null;
  sender: string | null;
  tokenIn: string | null;
  tokenOut: string | null;
  amountIn: string | null;
};

type BlockContext = {
  stageBlock: string | null;
  quoteAndActionBlock: string | null;
  simulatorPinnedBlock: string | null;
  blockHash: string | null;
};

type ExpectedControlState = {
  providerStatus: string | null;
  integrationStatus: string | null;
  executionStatus: string | null;
  backendControlStatus?: string | null;
  backendControlStatusProposal?: string;
  note?: string;
};

type FixtureEntry = {
  id: string;
  providerId: string;
  chainId: number | null;
  protocol: string | null;
  evidenceClass: string;
  real: boolean;
  supportState: string;
  qualificationClass: string;
  sourcePath: string | null;
  capture: Capture;
  runtimeIdentity: RuntimeIdentity;
  requestScope: RequestScope;
  blockContext: BlockContext;
  expectedControlState: ExpectedControlState;
  proves: string[];
  doesNotProve: string[];
  reproducibilityNote: string;
};

type FixtureIndex = {
  schemaVersion: string;
  status: string;
  evidenceClasses: string[];
  qualificationClasses: string[];
  supportStates: string[];
  provider: {
    providerId: string;
    scope: string;
    capabilities: Record<string, { state: string }>;
    knownLimitations: string[];
  };
  fixtureIndex: FixtureEntry[];
  preparedExecutionBinding: {
    coreInvariant: string;
    legacyPath: { status: string; statement: string };
    targetPath: {
      status: string;
      contractName: string;
      contractVersion: string;
      authority: string;
      flow: string[];
      requiredFields: Record<string, string>;
      coreInvariant: string;
      exactTransactionFailClosed: {
        rule: string;
        comparisonMaterial: string[];
        failureClass: string;
      };
      provenanceOwnership: {
        inputContext: string[];
        outputProviderProvenance: string[];
        orderingRule: string;
      };
      blockLayerDistinction: string[];
      mergedBackendPipeline57: {
        status: string;
        mergeCommit: string;
        shape: string;
        mergedFields: string[];
        alignment: string;
      };
      remainingContractOwnerScope: string;
    };
    unresolved: string[];
  };
  unresolvedContractOwnerDecisions: string[];
  noNewLiveProbe: { run: boolean; statement: string };
};

type NormalizedEvidenceStatus = {
  integrationStatus?: string;
  executionStatus?: string;
  simulationCoverage?: {
    value?: { halted?: boolean; complete?: boolean } | null;
  };
};

type NormalizedCoverage = {
  halted?: boolean;
  complete?: boolean;
};

function readFixtureIndex(): FixtureIndex {
  return JSON.parse(readFileSync(FIXTURE_INDEX_URL, "utf8")) as FixtureIndex;
}

/** Offline read of a referenced normalized evidence fixture, if one exists. */
function readNormalizedEvidence(
  sourcePath: string,
): NormalizedEvidenceStatus | undefined {
  const normalizedPath = `${REPOSITORY_ROOT}${sourcePath}normalized.json`;
  if (!existsSync(normalizedPath)) return undefined;
  return JSON.parse(
    readFileSync(normalizedPath, "utf8"),
  ) as NormalizedEvidenceStatus;
}

function coverageOf(
  evidence: NormalizedEvidenceStatus,
): NormalizedCoverage | undefined {
  return evidence.simulationCoverage?.value ?? undefined;
}

const index = readFixtureIndex();

const REAL_EVIDENCE_CLASSES = new Set([
  "REAL_LIVE_SIMULATION",
  "REAL_RECORDED_HISTORICAL",
]);

const MOCK_OR_RULE_EVIDENCE_CLASSES = new Set([
  "RULE_TEST_INPUT",
  "DETERMINISTIC_RULE_GUARD",
  "RECORDED_REPLAY",
]);

describe("BE-033 Moss fixture index", () => {
  it("parses and declares the BE-033 schema", () => {
    expect(index.schemaVersion).toBe("be-033-moss-handoff-v1");
    expect(index.status).toBe("DRAFT_PROVIDER_OWNER_HANDOFF");
    expect(index.provider.providerId).toBe("moss-kuru");
    expect(index.fixtureIndex.length).toBeGreaterThan(0);
  });

  it("uses unique fixture ids", () => {
    const ids = index.fixtureIndex.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every non-null source path to an existing repository path", () => {
    for (const entry of index.fixtureIndex) {
      if (entry.sourcePath === null) continue;
      expect(
        existsSync(`${REPOSITORY_ROOT}${entry.sourcePath}`),
        `${entry.id} -> ${entry.sourcePath} must exist`,
      ).toBe(true);
    }
  });

  it("declares every evidence class used by an entry", () => {
    const declared = new Set(index.evidenceClasses);
    for (const entry of index.fixtureIndex) {
      expect(
        declared.has(entry.evidenceClass),
        `${entry.id} uses undeclared evidenceClass ${entry.evidenceClass}`,
      ).toBe(true);
    }
  });

  it("declares every qualification class used by an entry", () => {
    const declared = new Set(index.qualificationClasses);
    for (const entry of index.fixtureIndex) {
      expect(
        declared.has(entry.qualificationClass),
        `${entry.id} uses undeclared qualificationClass ${entry.qualificationClass}`,
      ).toBe(true);
    }
  });

  it("declares every support state used by an entry or capability", () => {
    const declared = new Set(index.supportStates);
    for (const entry of index.fixtureIndex) {
      expect(declared.has(entry.supportState)).toBe(true);
    }
    for (const [name, capability] of Object.entries(
      index.provider.capabilities,
    )) {
      expect(
        declared.has(capability.state),
        `capability ${name} uses undeclared state ${capability.state}`,
      ).toBe(true);
    }
  });

  it("keeps real entries truthful: a path and a real-observation class", () => {
    const realEntries = index.fixtureIndex.filter((entry) => entry.real);
    expect(realEntries.length).toBeGreaterThan(0);
    for (const entry of realEntries) {
      expect(
        entry.sourcePath,
        `${entry.id} is real and must reference a source path`,
      ).not.toBeNull();
      expect(
        REAL_EVIDENCE_CLASSES.has(entry.evidenceClass),
        `${entry.id} is real but uses ${entry.evidenceClass}`,
      ).toBe(true);
      expect(entry.id).not.toContain("mock");
    }
  });

  it("never promotes a mock, rule, replay, or unavailable entry to real", () => {
    for (const entry of index.fixtureIndex) {
      if (MOCK_OR_RULE_EVIDENCE_CLASSES.has(entry.evidenceClass)) {
        expect(entry.real, `${entry.id} must not be real`).toBe(false);
      }
      if (entry.evidenceClass === "UNAVAILABLE") {
        expect(entry.real, `${entry.id} must not be real`).toBe(false);
      }
      if (entry.evidenceClass === "RULE_TEST_INPUT") {
        expect(
          entry.qualificationClass,
          `${entry.id} rule input must be MOCK_ONLY`,
        ).toBe("MOCK_ONLY");
      }
    }
  });

  it("keeps RECORDED_REPLAY distinct from MOCK_ONLY and REAL_OBSERVED", () => {
    const replay = index.fixtureIndex.filter(
      (entry) => entry.evidenceClass === "RECORDED_REPLAY",
    );
    expect(replay.length).toBeGreaterThan(0);

    for (const entry of replay) {
      expect(
        entry.qualificationClass,
        `${entry.id} recorded replay must not be qualified MOCK_ONLY`,
      ).not.toBe("MOCK_ONLY");
      expect(
        entry.qualificationClass,
        `${entry.id} recorded replay must use its own qualification class`,
      ).toBe("RECORDED_REPLAY");
      // Recorded replay is deterministic but is not a fresh live observation.
      expect(
        entry.real,
        `${entry.id} recorded replay must not claim real`,
      ).toBe(false);
    }

    // Mock/rule fixtures stay mock/rule-qualified.
    for (const entry of index.fixtureIndex) {
      if (entry.evidenceClass === "RULE_TEST_INPUT") {
        expect(entry.qualificationClass).toBe("MOCK_ONLY");
      }
    }

    // The three classes remain mutually distinct across the whole index.
    const classes = new Set(
      index.fixtureIndex.map((entry) => entry.qualificationClass),
    );
    expect(classes.has("REAL_OBSERVED")).toBe(true);
    expect(classes.has("RECORDED_REPLAY")).toBe(true);
    expect(classes.has("MOCK_ONLY")).toBe(true);
    expect(index.qualificationClasses).toContain("RECORDED_REPLAY");
  });

  it("records unavailable real cases with no path and no real claim", () => {
    const unavailable = index.fixtureIndex.filter(
      (entry) => entry.evidenceClass === "UNAVAILABLE",
    );
    expect(unavailable.length).toBeGreaterThan(0);
    for (const entry of unavailable) {
      expect(entry.real).toBe(false);
      expect(entry.sourcePath).toBeNull();
      expect(entry.qualificationClass).toBe("UNQUALIFIED");
    }
  });

  it("records every control-state case required by issue #58", () => {
    const ids = new Set(index.fixtureIndex.map((entry) => entry.id));
    for (const required of [
      "moss-timeout",
      "moss-outage",
      "moss-auth-failure",
      "moss-rate-limit",
      "moss-malformed-response",
      "moss-partial-response",
      "moss-stale-evidence",
      "moss-unknown-outcome",
      "moss-unsupported-guard",
      "moss-reverted-mock",
      "moss-live-success-mon-to-usdc",
    ]) {
      expect(ids.has(required), `missing fixture entry ${required}`).toBe(true);
    }
  });

  it("does not claim real revert, failure, or timeout coverage", () => {
    const realClasses = index.fixtureIndex
      .filter((entry) => entry.real)
      .map((entry) => entry.evidenceClass);
    expect(realClasses).toEqual([
      "REAL_LIVE_SIMULATION",
      "REAL_RECORDED_HISTORICAL",
      "REAL_RECORDED_HISTORICAL",
    ]);

    const byId = new Map(index.fixtureIndex.map((entry) => [entry.id, entry]));
    expect(byId.get("moss-reverted-mock")).toMatchObject({
      real: false,
      evidenceClass: "RULE_TEST_INPUT",
    });
    expect(byId.get("moss-timeout")).toMatchObject({
      real: false,
      evidenceClass: "UNAVAILABLE",
      sourcePath: null,
    });
    expect(byId.get("moss-integration-error-mock")).toMatchObject({
      real: false,
      evidenceClass: "RULE_TEST_INPUT",
    });
  });

  it("keeps the real success evidence scoped to Monad x Kuru", () => {
    const success = index.fixtureIndex.find(
      (entry) => entry.id === "moss-live-success-mon-to-usdc",
    );
    expect(success).toBeDefined();
    expect(success?.chainId).toBe(143);
    expect(success?.protocol).toBe("kuru");
    expect(success?.runtimeIdentity.runtimeVersion).toBe("0.1.0");
    expect(success?.runtimeIdentity.runtimeRevision).toBe(
      "ef15448e166f31c891e80dba5073dae04a052a2b",
    );
    expect(success?.blockContext).toMatchObject({
      quoteAndActionBlock: "94112901",
      simulatorPinnedBlock: "94112902",
      blockHash: null,
    });
    expect(success?.doesNotProve.join(" ")).toMatch(/universal Moss support/i);
  });

  it("keeps freshness policy explicitly unresolved", () => {
    const freshness = index.provider.capabilities.freshnessOrStalePolicy;
    expect(freshness?.state).toBe("UNKNOWN");
    const stale = index.fixtureIndex.find(
      (entry) => entry.id === "moss-stale-evidence",
    );
    expect(stale?.evidenceClass).toBe("UNAVAILABLE");
    expect(stale?.expectedControlState.note).toMatch(
      /no reviewed freshness policy/i,
    );
    expect(stale?.expectedControlState.note).toMatch(/fail closed/i);
  });

  it("bounds every non-success control state away from success", () => {
    const byId = new Map(index.fixtureIndex.map((entry) => [entry.id, entry]));
    expect(byId.get("moss-timeout")?.expectedControlState).toMatchObject({
      backendControlStatus: "timeout",
      providerStatus: "UNKNOWN",
    });
    expect(
      byId.get("moss-integration-error-mock")?.expectedControlState,
    ).toMatchObject({
      backendControlStatus: "failed",
      providerStatus: "FAILED",
    });
    expect(byId.get("moss-reverted-mock")?.expectedControlState).toMatchObject({
      executionStatus: "REVERTED",
      integrationStatus: "OK",
    });
    expect(
      byId.get("moss-unknown-outcome")?.expectedControlState,
    ).toMatchObject({
      backendControlStatus: "unknown",
      providerStatus: "UNKNOWN",
    });
  });

  it("documents both the legacy and the specified V1 target binding", () => {
    const binding = index.preparedExecutionBinding;
    expect(binding.coreInvariant).toMatch(/must not silently reconstruct/i);
    expect(binding.legacyPath.status).toBe("MERGED_CURRENT_BEHAVIOR");

    const target = binding.targetPath;
    expect(target.status).toBe("SPECIFIED_BY_PROVIDER_OWNER_V1");
    expect(target.contractName).toBe("MossPreparedExecutionInput");
    expect(target.contractVersion).toBe("V1");
    expect(target.flow).toEqual([
      "BackendPipelinePreparedExecution",
      "buildProviderInput(...)",
      "MossPreparedExecutionInput V1",
      "Moss evaluation",
    ]);
    expect(Object.keys(target.requiredFields).sort()).toEqual(
      [
        "blockContext",
        "chainId",
        "finality",
        "gasEstimate",
        "intent",
        "protocol",
        "quote",
        "runId",
        "unsignedTransaction",
      ].sort(),
    );

    // The required Moss Adapter input is specified; only the shared/final
    // generic type remains Contract Owner scope.
    expect(target.remainingContractOwnerScope).toMatch(
      /final shared generic PreparedExecution/i,
    );
    expect(binding.unresolved.join(" ")).toMatch(
      /final shared generic PreparedExecution \/ Evidence type/i,
    );
    expect(binding.unresolved.join(" ")).not.toMatch(
      /Moss-specific input shape/i,
    );
  });

  it("specifies exact-transaction fail-closed behavior", () => {
    const target = index.preparedExecutionBinding.targetPath;
    expect(target.coreInvariant).toMatch(
      /MUST evaluate the exact prepared unsigned transaction/i,
    );
    expect(target.coreInvariant).toMatch(/MUST NOT silently re-quote/i);
    expect(target.exactTransactionFailClosed.rule).toMatch(
      /must fail closed as invalid\/failed/i,
    );
    expect(target.exactTransactionFailClosed.comparisonMaterial).toEqual([
      "from",
      "to",
      "data",
      "value",
    ]);
    expect(target.exactTransactionFailClosed.failureClass).toBe("invalid");
  });

  it("separates INPUT preparation context from OUTPUT provider provenance", () => {
    const provenance =
      index.preparedExecutionBinding.targetPath.provenanceOwnership;
    expect(provenance.inputContext.join(" ")).toMatch(/blockContext/i);
    expect(provenance.outputProviderProvenance.join(" ")).toMatch(
      /simulatorPinnedBlock/i,
    );
    expect(provenance.outputProviderProvenance.join(" ")).toMatch(
      /runtime identity/i,
    );
    expect(provenance.orderingRule).toMatch(
      /simulator-pinned block is Provider evaluation OUTPUT/i,
    );

    const layers =
      index.preparedExecutionBinding.targetPath.blockLayerDistinction;
    expect(layers).toHaveLength(4);
    expect(layers.join(" ")).toMatch(/Backend preparation block/i);
    expect(layers.join(" ")).toMatch(/Moss stage block/i);
    expect(layers.join(" ")).toMatch(/Moss quote\/action evidence block/i);
    expect(layers.join(" ")).toMatch(/Moss simulator-pinned block/i);
  });

  it("records PR #57 as merged and the V1 binding as aligned", () => {
    const pr57 =
      index.preparedExecutionBinding.targetPath.mergedBackendPipeline57;
    expect(pr57.status).toBe("MERGED_ON_MAIN");
    expect(pr57.mergeCommit).toBe("0e718667a4f76958228f4a46837bb57d670b1de3");
    expect(pr57.shape).toBe(
      "BackendPipelinePreparedExecution<NormalizedIntent>",
    );
    expect(pr57.alignment).toMatch(
      /matches the BE-033 MossPreparedExecutionInput V1 binding/i,
    );

    // The merged field list is the same nine fields the V1 binding requires.
    const v1Fields = Object.keys(
      index.preparedExecutionBinding.targetPath.requiredFields,
    ).sort();
    expect([...pr57.mergedFields].sort()).toEqual(v1Fields);
  });

  it("cross-checks real historical expected control state against normalized evidence", () => {
    const historical = index.fixtureIndex.filter(
      (entry) =>
        entry.real &&
        entry.sourcePath !== null &&
        entry.evidenceClass === "REAL_RECORDED_HISTORICAL",
    );
    expect(historical.length).toBeGreaterThan(0);

    for (const entry of historical) {
      if (entry.sourcePath === null) continue;
      const normalized = readNormalizedEvidence(entry.sourcePath);
      expect(
        normalized,
        `${entry.id} must reference a loadable normalized.json`,
      ).toBeDefined();
      if (normalized === undefined) continue;

      const expected = entry.expectedControlState;
      if (normalized.integrationStatus !== undefined) {
        expect(
          expected.integrationStatus,
          `${entry.id} integrationStatus must match normalized evidence`,
        ).toBe(normalized.integrationStatus);
      }
      expect(
        expected.executionStatus,
        `${entry.id} executionStatus must match normalized evidence`,
      ).toBe(normalized.executionStatus);
    }
  });

  it("never indexes incomplete or halted real simulation as execution SUCCESS", () => {
    let checked = 0;
    for (const entry of index.fixtureIndex) {
      if (!entry.real || entry.sourcePath === null) continue;
      const normalized = readNormalizedEvidence(entry.sourcePath);
      if (normalized === undefined) continue;
      const coverage = coverageOf(normalized);
      if (coverage === undefined) continue;
      checked += 1;
      if (coverage.complete === false || coverage.halted === true) {
        expect(
          entry.expectedControlState.executionStatus,
          `${entry.id} has incomplete/halted simulation and must not be indexed as SUCCESS`,
        ).not.toBe("SUCCESS");
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps the two historical recordings at execution UNKNOWN", () => {
    const byId = new Map(index.fixtureIndex.map((entry) => [entry.id, entry]));
    for (const id of [
      "moss-recorded-mon-to-usdc",
      "moss-recorded-usdc-to-mon",
    ]) {
      const entry = byId.get(id);
      expect(entry, `${id} must exist`).toBeDefined();
      expect(entry?.expectedControlState.executionStatus).toBe("UNKNOWN");
      expect(entry?.expectedControlState.providerStatus).toBe("UNKNOWN");
      expect(entry?.expectedControlState.integrationStatus).toBe("OK");
    }
  });

  it("records stale handling as proposed and Contract Owner unresolved", () => {
    const stale = index.fixtureIndex.find(
      (entry) => entry.id === "moss-stale-evidence",
    );
    expect(stale).toBeDefined();
    expect(stale?.expectedControlState.backendControlStatus).toBeNull();
    expect(stale?.expectedControlState.backendControlStatusProposal).toBe(
      "PROPOSED / CONTRACT_OWNER_UNRESOLVED",
    );
    expect(stale?.expectedControlState.providerStatus).toBe("UNKNOWN");
    expect(stale?.expectedControlState.note).toMatch(
      /does not currently emit `?STALE`?|does not currently emit STALE/i,
    );
  });

  it("records that no new live probe was run", () => {
    expect(index.noNewLiveProbe.run).toBe(false);
    expect(index.noNewLiveProbe.statement).toMatch(/no new live moss probe/i);
  });

  it("keeps the Contract Owner decision list present", () => {
    expect(index.unresolvedContractOwnerDecisions.length).toBeGreaterThan(0);
  });

  it("declares V1-era limitations carried from BE-011", () => {
    expect(index.provider.knownLimitations.join(" ")).toMatch(
      /ERC-20 affordability/i,
    );
    expect(index.provider.knownLimitations.join(" ")).toMatch(
      /prepared execution/i,
    );
  });
});
