import { describe, expect, it } from "vitest";
import {
  classifyLiveError,
  normalizeMossError,
  StageTimeoutError,
  structuredError,
} from "../src/index.js";

describe("error semantics", () => {
  it("keeps a warning separate from a failure", () => {
    const warning = { code: "RECEIPT_FAILED", message: "receipt not parsed" };
    expect(warning).not.toHaveProperty("integrationStatus");
    expect(warning).not.toHaveProperty("code", "INTEGRATION_ERROR");
  });

  it("maps a confirmed QUOTE no-route to OK/NO_ROUTE", () => {
    const error = normalizeMossError(
      "no verified Kuru market path for this token pair",
      { stage: "QUOTE" },
    );
    expect(error.code).toBe("NO_ROUTE");
    expect(error.integrationStatus).toBe("OK");
    expect(error.normalization).toBe("DERIVED");
    expect(error.retryable).toBe(false);
  });

  it("does not derive NO_ROUTE from a stage-less route-like message", () => {
    const error = normalizeMossError(
      "no verified Kuru market path for this token pair",
    );
    expect(error.code).toBe("INTEGRATION_ERROR");
    expect(error.integrationStatus).toBe("INTEGRATION_ERROR");
  });

  it("keeps a structured Integration Error authoritative over route wording", () => {
    const error = classifyLiveError(
      {
        code: "INTEGRATION_ERROR",
        integrationStatus: "INTEGRATION_ERROR",
        message: "integration failure: no route available",
      },
      { stage: "QUOTE" },
    );
    expect(error.code).toBe("INTEGRATION_ERROR");
    expect(error.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(error.normalization).toBe("PRESERVED");
  });

  it("does not derive REVERTED from a QUOTE error message", () => {
    const error = normalizeMossError("execution reverted in quote", {
      stage: "QUOTE",
    });
    expect(error.code).toBe("INTEGRATION_ERROR");
    expect(error.integrationStatus).toBe("INTEGRATION_ERROR");
  });

  it("preserves a structured SIMULATE revert as OK/REVERTED", () => {
    const error = classifyLiveError(
      {
        code: "REVERTED",
        integrationStatus: "OK",
        message: "execution reverted",
        source: "rpc",
      },
      { stage: "SIMULATE" },
    );
    expect(error.code).toBe("REVERTED");
    expect(error.integrationStatus).toBe("OK");
    expect(error.normalization).toBe("PRESERVED");
  });

  it("maps simulator unavailability to UNAVAILABLE", () => {
    const error = normalizeMossError("debug_traceCall is not supported");
    expect(error.code).toBe("UNAVAILABLE");
    expect(error.integrationStatus).toBe("UNAVAILABLE");
  });

  it("maps timeouts to TIMEOUT and marks them retryable", () => {
    const error = normalizeMossError("request timed out after 10s");
    expect(error.code).toBe("TIMEOUT");
    expect(error.integrationStatus).toBe("TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("maps a revert to OK/REVERTED with no balance claim", () => {
    const error = normalizeMossError("execution reverted", {
      stage: "SIMULATE",
    });
    expect(error.code).toBe("REVERTED");
    expect(error.integrationStatus).toBe("OK");
    expect(error.stage).toBe("SIMULATE");
    expect(error.message).not.toMatch(/insufficient balance/);
  });

  it("falls back to INTEGRATION_ERROR and stays separate from a verdict", () => {
    const error = normalizeMossError("transport failed");
    expect(error.code).toBe("INTEGRATION_ERROR");
    expect(error.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(error.retryable).toBe(true);
  });

  it("recognizes structured SimulatorUnavailableError as PRESERVED", () => {
    const error = new Error("RPC does not expose debug_traceCall");
    error.name = "SimulatorUnavailableError";
    const normalized = classifyLiveError(error, { stage: "SIMULATE" });
    expect(normalized.code).toBe("UNAVAILABLE");
    expect(normalized.integrationStatus).toBe("UNAVAILABLE");
    expect(normalized.normalization).toBe("PRESERVED");
    expect(normalized.source).toBe("rpc");
  });

  it("recognizes structured ReceiptCoverageError as UNKNOWN with OK integration", () => {
    const error = new Error("receipt does not cover all changes");
    error.name = "ReceiptCoverageError";
    const normalized = classifyLiveError(error, { stage: "SIMULATE" });
    expect(normalized.code).toBe("UNKNOWN");
    expect(normalized.integrationStatus).toBe("OK");
    expect(normalized.normalization).toBe("PRESERVED");
  });

  it("builds a fully structured error", () => {
    const error = structuredError({
      stage: "QUOTE",
      code: "NO_ROUTE",
      message: "no verified market",
      integrationStatus: "OK",
      source: "quote",
      retryable: false,
    });
    expect(error).toEqual({
      stage: "QUOTE",
      code: "NO_ROUTE",
      message: "no verified market",
      integrationStatus: "OK",
      source: "quote",
      normalization: "PRESERVED",
      retryable: false,
    });
  });

  it("never manufactures STOP from a timeout", () => {
    const error = normalizeMossError("timeout");
    expect(error.code).toBe("TIMEOUT");
    expect(error.integrationStatus).toBe("TIMEOUT");
  });

  it("maps a structured StageTimeoutError to PRESERVED TIMEOUT", () => {
    const normalized = classifyLiveError(
      new StageTimeoutError("QUOTE", 30_000),
      { source: "rpc" },
    );
    expect(normalized.code).toBe("TIMEOUT");
    expect(normalized.integrationStatus).toBe("TIMEOUT");
    expect(normalized.normalization).toBe("PRESERVED");
    expect(normalized.retryable).toBe(true);
    expect(normalized.message).toContain("timed out after 30000ms");
  });
});
