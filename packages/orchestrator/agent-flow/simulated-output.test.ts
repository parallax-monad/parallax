import type {
  EvidenceItem,
  GenericEvidence,
  JsonValue,
  NormalizedSwapIntent,
} from "@parallax/contracts";
import { runResultSchema } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { projectGenericEvidenceToRunResult } from "./index.js";
import { extractSimulatedOutput } from "./simulated-output.js";

const recipient = `0x${"1".repeat(40)}`;
const token = `0x${"2".repeat(40)}`;
const pool = `0x${"3".repeat(40)}`;
const revision = "a".repeat(40);
const key = (suffix: string) => `${revision}:${suffix}`;
const intent: NormalizedSwapIntent = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender: recipient,
  recipient,
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: token },
  amountInAtomic: "1",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

function field<T>(value: T) {
  return {
    value,
    source: "moss" as const,
    reproducibility: "REPRODUCIBLE" as const,
    blockNumber: "1",
  };
}
function fixture() {
  const outcome: Record<string, JsonValue> = {
    recipient,
    tokenOut: token,
    amountReceivedAtomic: "10",
    derivation: "recipient_balance_delta",
    derivationVersion: "snapshot/v1",
    balanceBeforeAtomic: "5",
    balanceAfterAtomic: "15",
    amountInAtomic: "1",
    evaluatedAmountIn: "1",
    transactionFingerprint: `sha256:${"4".repeat(64)}`,
    blockHash: `0x${"5".repeat(64)}`,
    inputEvidenceKeys: [key("outcome")],
  };
  const evidence: GenericEvidence = {
    intent: {
      chainId: 421614,
      protocol: "camelot-v3",
      sender: recipient,
      tokenIn: "native",
      tokenOut: token,
      amountIn: "1",
      minimumReceivedSource: "unavailable",
    },
    provider: {
      providerId: "test-normalized",
      status: "SUCCESS",
      integrationStatus: "OK",
      errors: field([]),
    },
    execution: { status: "SUCCESS" },
    quote: field(null),
    action: field([{ transactionFingerprint: `sha256:${"4".repeat(64)}` }]),
    receipt: field({
      transactionFingerprint: `sha256:${"4".repeat(64)}`,
      blockHash: `0x${"5".repeat(64)}`,
    }),
    outcome: field(outcome),
    assetChanges: field([]),
    assetChangeAssessment: "EXPLAINED",
    warnings: field([]),
    simulation: field({
      expectedTransactions: 1,
      observedResults: 1,
      unmatchedResultIndexes: [],
      missingTransactionIndexes: [],
      halted: false,
      complete: true,
    }),
    blockNumber: field("1"),
    capabilities: ["simulate"],
    checkedScope: [],
    unknownScope: [],
    providerData: {},
    provenance: {
      mode: "LIVE",
      source: "moss",
      simulationBlock: "1",
      runtime: {
        commit: revision,
        runtimeVersion: "1",
        runtimeRevision: revision,
      },
    },
  };
  const item = (
    suffix: string,
    role?: "RECIPIENT_BALANCE_SNAPSHOT" | "ASSET_CHANGE_SET",
  ): Extract<EvidenceItem, { kind: "generic" }> => ({
    key: key(suffix),
    kind: "generic",
    status: "confirmed",
    summary: `Synthetic ${suffix} unit-test proof`,
    source: "moss",
    stage: "SIMULATE",
    reproducibility: "REPRODUCIBLE",
    isReplay: false,
    isMock: false,
    blockNumber: "1",
    simulatorPinnedBlock: "1",
    runtimeVersion: "1",
    runtimeRevision: revision,
    ...(role ? { simulationInputRole: role } : {}),
  });
  const items = [item("outcome", "RECIPIENT_BALANCE_SNAPSHOT")];
  return { outcome, evidence, items, item };
}

function assetFixture() {
  const f = fixture();
  f.outcome.derivation = "asset_change";
  f.outcome.derivationVersion = "qualified-net/v1";
  delete f.outcome.balanceBeforeAtomic;
  delete f.outcome.balanceAfterAtomic;
  f.outcome.inputEvidenceKeys = [
    key("asset-changes"),
    key("token-qualification"),
  ];
  f.outcome.qualificationEvidenceKey = key("token-qualification");
  const fingerprint = `sha256:${"4".repeat(64)}`;
  const blockHash = `0x${"5".repeat(64)}`;
  const tokenCodeHash = `sha256:${"6".repeat(64)}`;
  f.outcome.transactionFingerprint = fingerprint;
  f.outcome.blockHash = blockHash;
  f.outcome.tokenQualification = {
    chainId: intent.chainId,
    protocol: intent.protocol,
    tokenOut: token,
    sender: recipient,
    recipient,
    amountInAtomic: "1",
    transactionFingerprint: fingerprint,
    blockNumber: "1",
    blockHash,
    tokenCodeHash,
    semantics: "transfer_events_equal_balance_changes",
    qualificationVersion: "synthetic-token-semantics/v1",
    completeLogSet: true,
    completeAssetChanges: true,
  };
  f.evidence.action.value = [{ transactionFingerprint: fingerprint }];
  f.evidence.receipt.value = {
    transactionFingerprint: fingerprint,
    blockHash,
    tokenCodeHash,
    tokenOut: token,
  };
  f.items.splice(
    0,
    1,
    f.item("asset-changes", "ASSET_CHANGE_SET"),
    f.item("token-qualification"),
  );
  f.evidence.assetChanges.value = [
    {
      kind: "assetChange",
      token,
      from: pool,
      to: recipient,
      amountAtomic: "20",
    },
    {
      kind: "assetChange",
      token,
      from: recipient,
      to: pool,
      amountAtomic: "10",
    },
    {
      kind: "assetChange",
      token,
      from: recipient,
      to: recipient,
      amountAtomic: "100",
    },
  ];
  return f;
}

// Test-only structural fixture: never a production qualification authority.
function syntheticQualifiedAssetRun() {
  const snapshot = fixture();
  const result = projectGenericEvidenceToRunResult(
    "synthetic-contract-qualified-output",
    {
      ...intent,
      economicBoundary: {
        availability: "available",
        source: "user_declared",
        minimumReceivedAtomic: "1",
      },
    },
    snapshot.evidence,
  );
  const output = result.evidence.find(
    (item) => item.kind === "simulated_token_out",
  );
  if (output?.kind !== "simulated_token_out")
    throw new Error("Missing snapshot fixture output");
  const asset = assetFixture();
  result.evidence = result.evidence.filter(
    (item) => !asset.items.some((input) => input.key === item.key),
  );
  result.evidence.push(...asset.items);
  const snapshotRef = output.inputEvidenceRefs[0];
  output.derivation = "asset_change";
  output.derivationVersion = "synthetic-qualified-net/v1";
  output.inputEvidenceRefs = asset.items.map((item) => ({
    ...snapshotRef,
    key: item.key,
  }));
  return result;
}

describe("explicit normalized simulated-output proof (synthetic unit fixtures, not live qualification)", () => {
  it.each(["transactionFingerprint", "blockHash", "amountInAtomic"])(
    "rejects missing snapshot execution binding %s",
    (property) => {
      const f = fixture();
      delete f.outcome[property];
      expect(
        extractSimulatedOutput(intent, f.evidence, f.items),
      ).toBeUndefined();
    },
  );
  it("does not use another transaction's snapshot at the same pinned block", () => {
    const f = fixture();
    f.outcome.transactionFingerprint = `sha256:${"9".repeat(64)}`;
    const result = projectGenericEvidenceToRunResult(
      "snapshot-other-execution",
      {
        ...intent,
        economicBoundary: {
          availability: "available",
          source: "user_declared",
          minimumReceivedAtomic: "1",
        },
      },
      f.evidence,
    );
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001"),
    ).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "SIMULATED_OUTPUT_UNAVAILABLE",
    });
  });
  it.each(["amountIn", "tokenIn", "tokenOut"])(
    "rejects a snapshot whose provider intent %s contradicts its checked binding",
    (property) => {
      const f = fixture();
      Object.assign(f.evidence.intent, {
        [property]: property === "amountIn" ? "2" : pool,
      });
      expect(
        extractSimulatedOutput(intent, f.evidence, f.items),
      ).toBeUndefined();
    },
  );
  it("does not turn internally consistent provider self-attestation into qualified public output", () => {
    const f = assetFixture();
    f.evidence.quote = field({ estimatedAmountOut: "10" });
    const result = projectGenericEvidenceToRunResult(
      "qualified-asset-output",
      {
        ...intent,
        economicBoundary: {
          availability: "available",
          source: "user_declared",
          minimumReceivedAtomic: "1",
        },
      },
      f.evidence,
    );
    expect(
      result.evidence.find((item) => item.kind === "simulated_token_out"),
    ).toBeUndefined();
    expect(
      result.evidence.some((item) => item.key === key("token-qualification")),
    ).toBe(false);
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001")
        ?.status,
    ).toBe("UNKNOWN");
  });
  it("returns truthful UNKNOWN rather than throwing when a snapshot includes incompatible coverage references", () => {
    const f = fixture();
    f.evidence.quote = field({ estimatedAmountOut: "10" });
    f.outcome.inputEvidenceKeys = [key("outcome"), key("simulation-coverage")];
    const result = projectGenericEvidenceToRunResult(
      "snapshot-invalid-input",
      {
        ...intent,
        economicBoundary: {
          availability: "available",
          source: "user_declared",
          minimumReceivedAtomic: "1",
        },
      },
      f.evidence,
    );
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001"),
    ).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "SIMULATED_OUTPUT_UNAVAILABLE",
    });
    expect(
      result.evidence.some((item) => item.kind === "simulated_token_out"),
    ).toBe(false);
  });
  it.each(["missing", "wrong-token", "partial", "wrong-input"])(
    "public projection keeps %s qualification fail-closed",
    (scenario) => {
      const f = assetFixture();
      if (scenario === "missing") delete f.outcome.tokenQualification;
      if (scenario === "wrong-token") {
        (f.outcome.tokenQualification as Record<string, JsonValue>).tokenOut =
          pool;
      }
      if (scenario === "partial" && f.evidence.simulation.value !== null)
        f.evidence.simulation.value.complete = false;
      if (scenario === "wrong-input") f.evidence.intent.amountIn = "2";
      const result = projectGenericEvidenceToRunResult(
        "invalid-qualified-output",
        {
          ...intent,
          economicBoundary: {
            availability: "available",
            source: "user_declared",
            minimumReceivedAtomic: "1",
          },
        },
        f.evidence,
      );
      expect(
        result.evidence.some((item) => item.kind === "simulated_token_out"),
      ).toBe(false);
      expect(
        result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001")
          ?.status,
      ).toBe("UNKNOWN");
    },
  );
  it.each([
    "unpaired",
    "extra",
    "snapshot",
    "untrusted",
    "quote-source",
    "other-block",
  ])("RunResult rejects %s role-less qualification input", (scenario) => {
    const result = syntheticQualifiedAssetRun();
    expect(runResultSchema.safeParse(result).success).toBe(true);
    const output = result.evidence.find(
      (item) => item.kind === "simulated_token_out",
    );
    if (output?.kind !== "simulated_token_out")
      throw new Error("Missing output");
    const qualification = result.evidence.find(
      (item) => item.key === key("token-qualification"),
    );
    if (qualification === undefined) throw new Error("Missing qualification");
    if (scenario === "snapshot") output.derivation = "recipient_balance_delta";
    if (scenario === "untrusted") qualification.status = "unknown";
    if (scenario === "quote-source") {
      qualification.source = "quote";
      output.inputEvidenceRefs[1].source = "quote";
    }
    if (scenario === "other-block") {
      qualification.blockNumber = "2";
      output.inputEvidenceRefs[1].blockNumber = "2";
    }
    if (scenario === "unpaired") {
      const movements = result.evidence.find(
        (item) => item.key === key("asset-changes"),
      );
      if (movements?.kind === "generic")
        movements.simulationInputRole = "SIMULATION_RECEIPT";
    }
    if (scenario === "extra") {
      const extra = { ...qualification, key: key("unrelated-attestation") };
      result.evidence.push(extra);
      output.inputEvidenceRefs.push({
        ...output.inputEvidenceRefs[1],
        key: extra.key,
      });
    }
    expect(runResultSchema.safeParse(result).success).toBe(false);
  });
  it.each([
    ["tokenOut", pool],
    ["tokenCodeHash", `sha256:${"7".repeat(64)}`],
    ["transactionFingerprint", `sha256:${"8".repeat(64)}`],
    ["blockHash", `0x${"9".repeat(64)}`],
    ["blockNumber", "2"],
    ["chainId", 143],
    ["protocol", "kuru"],
    ["recipient", pool],
    ["sender", pool],
    ["amountInAtomic", "2"],
    ["completeLogSet", false],
    ["completeAssetChanges", false],
    ["semantics", "unqualified"],
  ])(
    "rejects qualification whose %s is not bound to the checked execution",
    (property, value) => {
      const f = assetFixture();
      const proof = f.outcome.tokenQualification as Record<string, JsonValue>;
      proof[property as string] = value;
      expect(
        extractSimulatedOutput(intent, f.evidence, f.items),
      ).toBeUndefined();
    },
  );
  it("rejects a qualification name without a typed token/execution proof", () => {
    const f = assetFixture();
    delete f.outcome.tokenQualification;
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it.each(["unsupported", "", "Transfer"])(
    "rejects unrecognized derivation %s",
    (derivation) => {
      const f = fixture();
      f.outcome.derivation = derivation;
      expect(
        extractSimulatedOutput(intent, f.evidence, f.items),
      ).toBeUndefined();
    },
  );
  it("rejects missing, duplicate or stale input references", () => {
    const f = fixture();
    f.outcome.inputEvidenceKeys = [key("outcome"), key("outcome")];
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
    f.outcome.inputEvidenceKeys = [key("outcome"), key("absent")];
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
    f.outcome.inputEvidenceKeys = [key("outcome")];
    f.items[0].reproducibility = "UNKNOWN";
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it("does not accept quote-only or replayed simulation sources", () => {
    const f = fixture();
    f.evidence.outcome.source = "quote";
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
    f.evidence.outcome.source = "moss";
    f.evidence.provenance.mode = "RECORDED_REPLAY";
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it("rejects inconsistent simulation coverage and chain binding", () => {
    const f = fixture();
    if (f.evidence.simulation.value) f.evidence.simulation.value.halted = true;
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
    if (f.evidence.simulation.value) f.evidence.simulation.value.halted = false;
    f.evidence.intent.chainId = 143;
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it("accounts for mint and burn, rather than ignoring their net contribution", () => {
    const f = assetFixture();
    f.evidence.assetChanges.value = [
      {
        kind: "assetChange",
        token,
        from: `0x${"0".repeat(40)}`,
        to: recipient,
        amountAtomic: "12",
      },
      {
        kind: "assetChange",
        token,
        from: recipient,
        to: `0x${"0".repeat(40)}`,
        amountAtomic: "2",
      },
    ];
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toMatchObject({
      amountReceivedAtomic: "10",
    });
  });
  it("preserves explicit snapshot derivation, algorithm version and source keys", () => {
    const f = fixture();
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toEqual({
      amountReceivedAtomic: "10",
      derivation: "recipient_balance_delta",
      derivationVersion: "snapshot/v1",
      inputEvidenceKeys: [key("outcome")],
    });
  });

  it.each([
    "derivation",
    "derivationVersion",
    "inputEvidenceKeys",
    "balanceBeforeAtomic",
    "balanceAfterAtomic",
    "recipient",
    "tokenOut",
  ])("fails closed without %s", (property) => {
    const f = fixture();
    delete f.outcome[property];
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it.each(["01", "-1", "1.5", (1n << 256n).toString(), "9".repeat(1000)])(
    "rejects invalid atomic amount %s",
    (amount) => {
      const f = fixture();
      f.outcome.amountReceivedAtomic = amount;
      expect(
        extractSimulatedOutput(intent, f.evidence, f.items),
      ).toBeUndefined();
    },
  );
  it.each(["snapshot", "asset"])(
    "preserves proven zero %s output without inventing production qualification",
    (kind) => {
      const f = kind === "asset" ? assetFixture() : fixture();
      f.outcome.amountReceivedAtomic = "0";
      if (kind === "snapshot") f.outcome.balanceAfterAtomic = "5";
      else f.evidence.assetChanges.value = [];
      if (kind === "asset") {
        // The extractor seam receives explicit synthetic qualification evidence.
        // Production projection must not manufacture it from the outcome.
        expect(
          extractSimulatedOutput(intent, f.evidence, f.items),
        ).toMatchObject({ amountReceivedAtomic: "0" });
      }
      const result = projectGenericEvidenceToRunResult(
        "zero-output",
        {
          ...intent,
          economicBoundary: {
            availability: "available",
            source: "user_declared",
            minimumReceivedAtomic: "1",
          },
        },
        f.evidence,
      );
      expect(
        result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001"),
      ).toMatchObject(
        kind === "snapshot"
          ? { status: "FAIL", reasonCode: "OUTPUT_BELOW_BOUNDARY" }
          : { status: "UNKNOWN", reasonCode: "SIMULATED_OUTPUT_UNAVAILABLE" },
      );
    },
  );
  it.each([0, 2])(
    "rejects coverage of %s transactions for a single bound execution",
    (count) => {
      const f = fixture();
      if (f.evidence.simulation.value) {
        f.evidence.simulation.value.expectedTransactions = count;
        f.evidence.simulation.value.observedResults = count;
      }
      expect(
        extractSimulatedOutput(intent, f.evidence, f.items),
      ).toBeUndefined();
    },
  );
  it.each([
    "replay",
    "partial",
    "provider-unknown",
    "coverage-source",
    "coverage-reproducibility",
    "coverage-block",
  ])(
    "does not publish confirmed qualification from %s evidence",
    (scenario) => {
      const f = assetFixture();
      if (scenario === "coverage-source")
        f.evidence.simulation.source = "unknown";
      if (scenario === "coverage-reproducibility")
        f.evidence.simulation.reproducibility = "UNKNOWN";
      if (scenario === "coverage-block")
        f.evidence.simulation.blockNumber = "2";
      if (scenario === "replay") f.evidence.provenance.mode = "RECORDED_REPLAY";
      if (scenario === "partial" && f.evidence.simulation.value)
        f.evidence.simulation.value.complete = false;
      if (scenario === "provider-unknown")
        f.evidence.provider.status = "UNKNOWN";
      const result = projectGenericEvidenceToRunResult(
        "ineligible-qualification",
        {
          ...intent,
          economicBoundary: {
            availability: "available",
            source: "user_declared",
            minimumReceivedAtomic: "1",
          },
        },
        f.evidence,
      );
      expect(
        result.evidence.some((item) => item.key === key("token-qualification")),
      ).toBe(false);
    },
  );
  it("rejects an amount inconsistent with the bound before/after snapshot", () => {
    const f = fixture();
    f.outcome.balanceAfterAtomic = "20";
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it.each([
    "blockNumber",
    "simulatorPinnedBlock",
    "runtimeRevision",
    "runtimeVersion",
  ])("rejects mismatched source %s", (property) => {
    const f = fixture();
    Object.assign(f.items[0], { [property]: "2" });
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it.each(["missing", "receipt"])(
    "cannot substitute %s evidence for a snapshot",
    (suffix) => {
      const f = fixture();
      f.outcome.inputEvidenceKeys = [key(suffix)];
      f.items.push(f.item("receipt"));
      expect(
        extractSimulatedOutput(intent, f.evidence, f.items),
      ).toBeUndefined();
    },
  );
  it.each(["UNKNOWN", "FAILED", "STALE"] as const)(
    "does not upgrade Provider %s",
    (status) => {
      const f = fixture();
      f.evidence.provider.status = status;
      expect(
        extractSimulatedOutput(intent, f.evidence, f.items),
      ).toBeUndefined();
    },
  );
  it("requires the complete net rather than the first incoming movement", () => {
    const f = assetFixture();
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toMatchObject({
      amountReceivedAtomic: "10",
      derivation: "asset_change",
    });
    f.outcome.amountReceivedAtomic = "20";
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it("requires independent confirmed token qualification", () => {
    const f = assetFixture();
    f.items.pop();
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
    f.items.push({ ...f.item("token-qualification"), status: "unknown" });
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it("does not relabel generic coverage as token qualification", () => {
    const f = assetFixture();
    f.outcome.qualificationEvidenceKey = key("simulation-coverage");
    f.outcome.inputEvidenceKeys = [
      key("asset-changes"),
      key("simulation-coverage"),
    ];
    f.items.push(f.item("simulation-coverage"));
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
  it("rejects unexplained or malformed movement sets and legacy event payloads", () => {
    const f = assetFixture();
    f.evidence.assetChangeAssessment = "UNKNOWN";
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
    f.evidence.assetChangeAssessment = "EXPLAINED";
    f.evidence.assetChanges.value?.push({ kind: "event", amount: "10" });
    expect(extractSimulatedOutput(intent, f.evidence, f.items)).toBeUndefined();
  });
});
