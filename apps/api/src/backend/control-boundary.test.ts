import { describe, expect, it } from "vitest";
import {
  BackendControlError,
  type BackendControlFailureStatus,
  isBackendControlError,
  isBackendControlStatus,
} from "./control-boundary.js";

const failureStatuses: BackendControlFailureStatus[] = [
  "unsupported",
  "failed",
  "timeout",
  "unknown",
  "stale",
  "invalid",
];

describe("Backend control boundary", () => {
  it("reuses the provisional status vocabulary without treating control as a verdict", () => {
    expect(failureStatuses.every(isBackendControlStatus)).toBe(true);
    expect(isBackendControlStatus("success")).toBe(true);
    expect(isBackendControlStatus("PROCEED")).toBe(false);
  });

  it.each(failureStatuses)(
    "preserves the %s control status and diagnostics",
    (status) => {
      const cause = { code: "provider-native", stage: "SIMULATE" };
      const error = new BackendControlError({
        status,
        providerId: "fixture-provider",
        code: `PROVIDER_${status.toUpperCase()}`,
        message: `${status} provider result`,
        retryable: status === "timeout",
        cause,
      });

      expect(isBackendControlError(error)).toBe(true);
      expect(error.status).toBe(status);
      expect(error.providerId).toBe("fixture-provider");
      expect(error.code).toBe(`PROVIDER_${status.toUpperCase()}`);
      expect(error.retryable).toBe(status === "timeout");
      expect(error.cause).toBe(cause);
      expect((error as { verdict?: unknown }).verdict).toBeUndefined();
      expect((error as { evidence?: unknown }).evidence).toBeUndefined();
    },
  );

  it("rejects success as an error status", () => {
    expect(
      () =>
        new BackendControlError({
          status: "success" as never,
          code: "SUCCESS",
          message: "not a failure",
          retryable: false,
        }),
    ).toThrow("control error status must be a failure status");
  });

  it("rejects structurally incomplete control errors", () => {
    expect(
      isBackendControlError({
        name: "BackendControlError",
        status: "failed",
        code: "FAILED",
        message: "failed",
        retryable: "false",
      }),
    ).toBe(false);
  });

  it("recognizes a structurally valid adapter control error across a runtime boundary", () => {
    expect(
      isBackendControlError({
        name: "ProviderAdapterError",
        status: "stale",
        providerId: "fixture-provider",
        code: "STALE",
        message: "provider evidence is stale",
        retryable: false,
      }),
    ).toBe(true);
  });
});
