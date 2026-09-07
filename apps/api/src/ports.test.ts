import { describe, expect, it } from "vitest";
import { isBackendControlError } from "./backend/control-boundary.js";
import {
  isUnsupportedAgentFlowError,
  UnsupportedAgentFlowError,
} from "./ports.js";

describe("Agent Flow control errors", () => {
  it("represents unavailable live flow as an explicit unsupported control state", () => {
    const error = new UnsupportedAgentFlowError();

    expect(isUnsupportedAgentFlowError(error)).toBe(true);
    expect(isBackendControlError(error)).toBe(true);
    expect(error.status).toBe("unsupported");
    expect(error.code).toBe("UNSUPPORTED");
    expect(error.retryable).toBe(false);
    expect((error as { verdict?: unknown }).verdict).toBeUndefined();
    expect((error as { evidence?: unknown }).evidence).toBeUndefined();
  });

  it("does not classify a bare or mismatched unsupported code as Agent Flow control", () => {
    expect(isUnsupportedAgentFlowError({ code: "UNSUPPORTED" })).toBe(false);
    expect(
      isUnsupportedAgentFlowError({
        name: "UnsupportedAgentFlowError",
        status: "failed",
        code: "UNSUPPORTED",
        message: "not an unsupported control state",
        retryable: false,
      }),
    ).toBe(false);
  });
});
