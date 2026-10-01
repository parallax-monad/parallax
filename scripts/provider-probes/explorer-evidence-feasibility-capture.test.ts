import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const root = new URL("../../", import.meta.url);
const capturePath =
  "fixtures/provider-registry/be-108/explorer-feasibility-2026-09-28T13-42-15-552Z/capture.json";
const archivePath =
  "fixtures/provider-registry/be-108/historical-source-9d992d9/";
const bytes = (path: string) => readFileSync(new URL(path, root));
const canonicalGitTextBytes = (value: Uint8Array) =>
  Buffer.from(
    Buffer.from(value).toString("utf8").replace(/\r\n/g, "\n"),
    "utf8",
  );
const hash = (value: string | Uint8Array) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonicalGitTextBytes(value))
    .digest("hex");
const capture = JSON.parse(bytes(capturePath).toString());
const archive = JSON.parse(bytes(`${archivePath}manifest.json`).toString());
const originalCommit = "9d992d9533dc035d9fe6becc4abcc44f089e6400";
const originalFiles = [
  {
    path: "scripts/provider-probes/explorer-evidence-feasibility.ts",
    file: "explorer-evidence-feasibility.ts.txt",
    blob: "636d78c0f5d0f5156075acf72f67d414c61b4b9d",
    sha: "da94430818626e02fc5e9ae7838578fa15d01712239a15451348267b5a587f17",
  },
  {
    path: "apps/api/src/backend/explorer-evidence-source.ts",
    file: "explorer-evidence-source.ts.txt",
    blob: "b1192f442728527b34da944e4f2a23fe3e9603b4",
    sha: "feaca2fdd581a194bc35d4e54f8f32647bf457e5e7e32228f763e280ebb7b439",
  },
  {
    path: "apps/api/src/backend/explorer-evidence-source.test.ts",
    file: "explorer-evidence-source.test.ts.txt",
    blob: "65dc50f1bb4c836bf13281e8c80a5628945c5c4f",
    sha: "32d30183f6affd12954e4808bcd1cdf5c0b35355f492c593509b96bc8172b464",
  },
];

describe("HISTORICAL_SOURCE_VERIFICATION (static integrity, not chain replay)", () => {
  it("preserves the exact capture bytes and original runner hash", () => {
    expect(hash(bytes(capturePath))).toBe(
      "58c6118145b9df36de039ac9cfadaf401d72aded745a68ea094e06a199ccbf70",
    );
    expect(capture.runner.sha256).toBe(originalFiles[0].sha);
  });

  it("canonicalizes CRLF checkouts to the historical Git LF bytes", () => {
    const lf = bytes(capturePath);
    const crlf = Buffer.from(
      lf.toString("utf8").replace(/(?<!\r)\n/g, "\r\n"),
      "utf8",
    );
    expect(hash(crlf)).toBe(hash(lf));
  });

  it("retains the 59-entry manifest and dirty capture-time state", () => {
    const provenance = capture.sourceProvenance;
    expect(provenance.files).toHaveLength(59);
    expect(hash(JSON.stringify(provenance.files))).toBe(
      "9d6ea554296fffff6c5dc570e95cf5ae921989e1c3dc46825527026300c02b17",
    );
    expect(provenance.manifestSha256).toBe(archive.historicalManifestSha256);
    expect(provenance.repositoryHead).toBe(
      "f8cc7beb4f899e0b8283e1e30a67814a4989c73e",
    );
    expect(provenance.worktreeDirty).toBe(true);
    expect(archive.recordedCaptureHead).toBe(provenance.repositoryHead);
    expect(archive.worktreeDirtyAtCapture).toBe(true);
    expect(archive.sourceVerification).toEqual({
      historicalCommitMatches: 59,
      recordedCaptureHeadMatches: 58,
      dirtySourcePath: originalFiles[1].path,
    });
    expect(provenance.files).toContainEqual({
      path: originalFiles[1].path,
      sha256: originalFiles[1].sha,
    });
  });

  it.each(originalFiles)(
    "preserves $file SHA256 and Git blob identity",
    (original) => {
      const content = canonicalGitTextBytes(
        bytes(`${archivePath}${original.file}`),
      );
      expect(hash(content)).toBe(original.sha);
      // Git blob identity is portable: no fetch or deep CI checkout required.
      expect(
        createHash("sha1")
          .update(`blob ${content.length}\0`)
          .update(content)
          .digest("hex"),
      ).toBe(original.blob);
      expect(archive.files).toContainEqual({
        originalPath: original.path,
        originalCommit,
        gitBlobId: original.blob,
        sha256: original.sha,
        bytes: content.length,
        archiveFile: original.file,
        purpose: expect.any(String),
      });
      expect(
        fileURLToPath(new URL(`${archivePath}${original.file}`, root)),
      ).toMatch(/\.ts\.txt$/);
    },
  );

  it("retains the historical timing gap rather than inventing a duration", () => {
    expect(capture.capturedAt).toBe("2026-09-28T13:42:15.552Z");
    for (const field of ["startedAt", "finishedAt", "elapsedMs"]) {
      expect(capture).not.toHaveProperty(field);
    }
    expect(archive.limitations.join(" ")).toContain("MOCK tests are not LIVE");
    expect(archive.limitations.join(" ")).toContain("duration is UNVERIFIABLE");
  });
});

type HistoricalRow = {
  capability: string;
  liveCompatibleSurface: Record<string, unknown> | null;
  liveRestSurface: Record<string, unknown> | null;
};
const rows = capture.capabilityMatrix as HistoricalRow[];
const compatible = rows
  .filter((row) => row.liveCompatibleSurface !== null)
  .map((row) => ({
    capability: row.capability,
    request: capture.capabilityMatrix.find(
      (entry: HistoricalRow) => entry.capability === row.capability,
    ).request,
    envelope: row.liveCompatibleSurface,
  }));
const rest = rows
  .map((row) => row.liveRestSurface)
  .filter((row): row is Record<string, unknown> => row !== null);
const target = {
  blockNumber: "310131879",
  blockHash:
    "0x715bfaca417a25ed4d317748ecf0cfbd0ad38d4e14c2e1c0fb42ac0c8e60feff",
  transactionHash:
    "0xb116ef6ce279668d555498e0e5a836f8ef35f997667e87a75757ec47332a644a",
};

describe("CURRENT_IMPLEMENTATION_VERIFICATION (offline interpretation only)", () => {
  async function implementation() {
    const fetch = vi.fn(() => {
      throw new Error("Network forbidden in static verification");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const probe = await import("./explorer-evidence-feasibility.js");
      const descriptors = await import(
        "./explorer-feasibility-capabilities.js"
      );
      expect(fetch).not.toHaveBeenCalled();
      return { ...probe, descriptors };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("imports without network, Backend dependency or automatic live qualification", async () => {
    const { descriptors } = await implementation();
    expect(descriptors.EXPLORER_CAPABILITY_DESCRIPTORS).toHaveLength(9);
    expect(descriptors.EXPLORER_UNSUPPORTED_CAPABILITIES).toEqual([
      "simulation",
      "trace",
      "state-diff",
    ]);
    for (const descriptor of descriptors.EXPLORER_CAPABILITY_DESCRIPTORS) {
      expect(descriptor).not.toHaveProperty("verification");
      expect(descriptor).not.toHaveProperty("verifiedOn");
    }
    const module = bytes(
      "scripts/provider-probes/explorer-feasibility-capabilities.ts",
    ).toString();
    expect(module).not.toMatch(
      /\b(?:fetch|createExplorerEvidenceSource|ExplorerEvidenceSource)\b/,
    );
    const runner = bytes(
      "scripts/provider-probes/explorer-evidence-feasibility.ts",
    ).toString();
    expect(runner).not.toContain("apps/api/src/backend");
    expect(runner).not.toContain("historical-source-9d992d9");
    expect(runner).not.toContain("live_verified");
    expect(runner).not.toContain("normalizedFactsFor");
    expect(runner).toContain("descriptorSha256");
    expect(hash(Buffer.from(runner))).not.toBe(capture.runner.sha256);
    for (const original of originalFiles.slice(1)) {
      expect(existsSync(new URL(original.path, root))).toBe(false);
    }
  });

  it("derives scoped observations from eight 429 summaries and seven REST resources", async () => {
    const { buildExplorerCapabilityMatrix } = await implementation();
    expect(compatible).toHaveLength(8);
    expect(rest).toHaveLength(7);
    expect(compatible.every((row) => row.envelope?.http === 429)).toBe(true);
    expect(rest.every((row) => row.http === 200)).toBe(true);
    const matrix = buildExplorerCapabilityMatrix(compatible, rest, target);
    expect(matrix.map((row) => [row.capability, row.verification])).toEqual([
      ["contract-verification", "OBSERVED"],
      ["contract-abi", "PARTIAL"],
      ["deployment", "OBSERVED"],
      ["token-metadata", "OBSERVED"],
      ["transaction", "OBSERVED"],
      ["receipt", "PARTIAL"],
      ["logs", "OBSERVED"],
      ["token-transfers", "PARTIAL"],
      ["provenance", "OBSERVED"],
    ]);
    for (const row of matrix) {
      expect(row.observedOn).toBe("blockscout-rest-v2");
      expect(row.credentialedEtherscanV2).toBe("BLOCKED_MISSING_API_KEY");
      expect(row.requestTemplate.status).toBe("DOCUMENTED");
      if (row.compatibleObservation.response !== null) {
        expect(row.compatibleObservation.status).toBe("BLOCKED");
        expect(row.compatibleObservation.reason).toBe(
          "RATE_LIMITED_NOT_UNSUPPORTED",
        );
      }
    }
    expect(
      buildExplorerCapabilityMatrix([], [], target).every(
        (row) => row.verification === "UNVERIFIED" && row.observedOn === null,
      ),
    ).toBe(true);
  });

  it("preserves missing and malformed raw is_verified as unknown, not false", async () => {
    const { restFacts, buildExplorerCapabilityMatrix } = await implementation();
    const rawCases = [undefined, null, "true", "false", 0, 1, {}, []];
    for (const value of rawCases) {
      const input: Record<string, unknown> = {
        compiler_version: "test-compiler",
      };
      if (value !== undefined) input.is_verified = value;
      const normalized = restFacts("contract-verification", input);
      expect(normalized.isVerified).toBeNull();
      const altered = structuredClone(rest);
      const contract = altered.find(
        (entry) => entry.capability === "contract-verification",
      );
      if (!contract) throw new Error("Expected contract fixture");
      contract.facts = normalized;
      expect(
        buildExplorerCapabilityMatrix(compatible, altered, target)[0]
          .verification,
      ).toBe("UNVERIFIED");
    }
    for (const [rawFlag, summary] of [
      [true, "true"],
      [false, "false"],
    ] as const) {
      const normalized = restFacts("contract-verification", {
        compiler_version: "test-compiler",
        is_verified: rawFlag,
      });
      expect(normalized.isVerified).toBe(summary);
      const altered = structuredClone(rest);
      const contract = altered.find(
        (entry) => entry.capability === "contract-verification",
      );
      if (!contract) throw new Error("Expected contract fixture");
      contract.facts = normalized;
      expect(
        buildExplorerCapabilityMatrix(compatible, altered, target)[0]
          .verification,
      ).toBe("OBSERVED");
    }
  });

  it("keeps ABI count distinct from a missing independent fingerprint", async () => {
    const { buildExplorerCapabilityMatrix } = await implementation();
    expect(capture.capabilityMatrix[1].normalizedFacts).toEqual({
      abiFingerprint: null,
      abiEntryCount: null,
    });
    const abi = buildExplorerCapabilityMatrix(compatible, rest, target)[1];
    expect(abi.verification).toBe("PARTIAL");
    expect(abi.abiFingerprint).toBeNull();
    expect(abi.restObservation).toMatchObject({
      capability: "contract-verification",
      facts: { abiEntries: 21 },
    });
    expect(abi.restObservation).not.toHaveProperty("abiFingerprint");
  });

  it("reports receipt-equivalent fields without any receipt execution-status inference", async () => {
    const { buildExplorerCapabilityMatrix } = await implementation();
    const receipt = buildExplorerCapabilityMatrix(compatible, rest, target)[5];
    expect(receipt.verification).toBe("PARTIAL");
    expect(receipt.restObservation).toMatchObject({
      transaction: { facts: { status: "ok", gasUsed: "384021" } },
      logs: { facts: { logCount: 4 } },
    });
    expect(JSON.stringify(receipt)).not.toContain("executionStatus");
    expect(receipt.limitations.join(" ")).toContain("no complete receipt");
    expect(
      buildExplorerCapabilityMatrix(compatible, [], target)[5].verification,
    ).toBe("UNVERIFIED");
  });

  it("never infers complete transfer pagination, range or target binding from 50 items", async () => {
    const { buildExplorerCapabilityMatrix } = await implementation();
    const transfers = buildExplorerCapabilityMatrix(
      compatible,
      rest,
      target,
    )[7];
    expect(transfers.verification).toBe("PARTIAL");
    expect(transfers.restObservation).toMatchObject({ facts: { items: 50 } });
    expect(transfers.paginationComplete).toBe("UNVERIFIED");
    expect(transfers.reachesTargetBlock).toBe("UNVERIFIED");
    expect(transfers.perItemTargetBinding).toBe("UNVERIFIED");
    const originalRunner = bytes(
      `${archivePath}explorer-evidence-feasibility.ts.txt`,
    ).toString();
    expect(originalRunner).toMatch(
      /startblock: 0,\s*endblock: 99999999,\s*sort: "asc"/,
    );
    const originalPrototype = bytes(
      `${archivePath}explorer-evidence-source.ts.txt`,
    ).toString();
    expect(originalPrototype).toMatch(
      /endblock: 99_999_999,\s*sort: "desc",\s*page: 1,\s*offset: 100/,
    );
    expect(99_999_999).toBeLessThan(Number(target.blockNumber));
  });

  it.each(["missing", "height", "hash", "http", "fingerprint"])(
    "does not grant provenance for a %s response (synthetic negative case)",
    async (fault) => {
      const { buildExplorerCapabilityMatrix } = await implementation();
      const altered = structuredClone(rest);
      const block = altered.find((row) => row.capability === "provenance");
      if (!block) throw new Error("Fixture has no block response");
      const blockFacts = block.facts as Record<string, unknown>;
      if (fault === "missing") altered.splice(altered.indexOf(block), 1);
      if (fault === "height") blockFacts.height = 99_999_999;
      if (fault === "hash") blockFacts.blockHash = `0x${"0".repeat(64)}`;
      if (fault === "http") block.http = 429;
      if (fault === "fingerprint") block.responseSha256 = "";
      const provenance = buildExplorerCapabilityMatrix(
        compatible,
        altered,
        target,
      )[8];
      expect(provenance.verification).toBe("UNVERIFIED");
      expect(provenance.observedOn).toBeNull();
    },
  );

  it("keeps the single no-key V2 failure separate from the successful chainlist", async () => {
    const { buildExplorerCapabilityMatrix } = await implementation();
    expect(capture.etherscanV2.keylessObserved).toMatchObject({
      http: 200,
      status: "0",
      resultText: "Missing/Invalid API Key",
    });
    expect(capture.chainSupport.http).toBe(200);
    expect(capture.chainSupport.totalcount).toBe(63);
    expect(capture.chainSupport.arbitrumChains).toHaveLength(2);
    expect(
      buildExplorerCapabilityMatrix(compatible, rest, target).every(
        (row) => row.credentialedEtherscanV2 === "BLOCKED_MISSING_API_KEY",
      ),
    ).toBe(true);
  });

  it("retains the index and documents evidence gaps without claiming historical duration", () => {
    const note = bytes(
      "docs/research/be-108-explorer-evidence-feasibility.md",
    ).toString();
    expect(bytes("docs/README.md").toString()).toContain(
      "./research/be-108-explorer-evidence-feasibility.md",
    );
    for (const expected of [
      "HISTORICAL_DURATION=UNVERIFIABLE",
      "CREDENTIALED_ETHERSCAN_V2=BLOCKED_MISSING_API_KEY",
      "PRODUCTION_SUPPORT=NO",
      "worktreeDirty=true",
      "58 match",
      "Eight capability requests returned HTTP 429",
      "Seven resource requests returned HTTP 200",
      "no dedicated ABI request or retained ABI body",
      "one address-resource request returned 50 items",
      "no complete receipt",
      "makes no Explorer request",
      "Archival does not",
      "MOCK normalization/classifier tests do not prove LIVE qualification",
      "secondary static audit",
      "No claim is made that the",
      capture.runner.sha256,
    ])
      expect(note).toContain(expected);
    expect(note).not.toContain("with no, empty, and placeholder keys");
    expect(note).not.toContain("21 ABI entries for the router, fingerprinted");
    expect(note).not.toContain("a key holder runs the same runner");
  });
});
