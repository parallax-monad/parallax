import { describe, expect, it, vi } from "vitest";
import { createBackendCheckFlow } from "./pipeline.js";

describe("createBackendCheckFlow public boundary", () => {
  it("does not let execution providerData override the redacted projection", async () => {
    const pipeline = {
      executeNormalized: vi.fn(async () => ({
        providerEvidence: {
          providerStatus: "success",
          providerData: { callReturnData: "0xraw-rpc-payload" },
        },
      })),
    } as never;

    const flow = createBackendCheckFlow({
      pipeline,
      project: () => ({
        status: "completed",
        providerEvidence: {
          providerStatus: "success",
          providerData: {},
        },
      }),
    });

    const result = await flow.check({
      runId: "run-1",
      intent: { chainId: 421614, protocol: "camelot-v3" },
    } as never);

    expect(result).toEqual({
      status: "completed",
      providerEvidence: {
        providerStatus: "success",
        providerData: {},
      },
    });
    expect(JSON.stringify(result)).not.toContain("callReturnData");
  });
});
