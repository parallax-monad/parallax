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
  backendControlStatus?: string;
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
      pendingType: string;
      pendingFields: string[];
    };
    unresolved: string[];
  };
  unresolvedContractOwnerDecisions: string[];
  noNewLiveProbe: { run: boolean; statement: string };
};

function readFixtureIndex(): FixtureIndex {
  return JSON.parse(readFileSync(FIXTURE_INDEX_URL, "utf8")) as FixtureIndex;
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
      /freshness policy remains unresolved/i,
    );
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

  it("documents both the legacy and the pending target binding", () => {
    const binding = index.preparedExecutionBinding;
    expect(binding.coreInvariant).toMatch(/must not silently reconstruct/i);
    expect(binding.legacyPath.status).toBe("MERGED_CURRENT_BEHAVIOR");
    expect(binding.targetPath.status).toBe("PENDING_PULL_REQUEST_57");
    expect(binding.targetPath.pendingFields).toContain("runId");
    expect(binding.targetPath.pendingFields).toContain("unsignedTransaction");
    expect(binding.unresolved.length).toBeGreaterThan(0);
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
