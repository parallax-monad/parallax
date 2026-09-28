import { describe, expect, it } from "vitest";
import { fingerprintPreparedTransaction } from "./prepared-transaction-fingerprint.js";

describe("fingerprintPreparedTransaction", () => {
  it("matches the canonical unsigned Evidence Portability binding", () => {
    const payload = {
      from: `0x${"11".repeat(20)}`,
      to: `0x${"22".repeat(20)}`,
      data: "0x1234",
      value: "0x0",
    };

    // Golden value from SHA-256(JSON.stringify({ kind: "unsigned", payload })).
    expect(fingerprintPreparedTransaction(payload)).toBe(
      "sha256:548a16b7d763585ca0d5e7544ead0b229931491d8bbc7e349d496b2e0025854b",
    );
  });

  it("preserves the canonical serializer's omission of undefined fields", () => {
    const payload = {
      from: `0x${"11".repeat(20)}`,
      to: `0x${"22".repeat(20)}`,
      data: "0x1234",
      value: "0x0",
      gas: undefined,
    };

    expect(fingerprintPreparedTransaction(payload)).toBe(
      "sha256:548a16b7d763585ca0d5e7544ead0b229931491d8bbc7e349d496b2e0025854b",
    );
  });
});
