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
});
