import { describe, expect, it } from "vitest";
import { evidencePresentationSchema } from "./evidence-presentation.js";

const capability = {
  key: "native-rpc.eth_call",
  summary: "Pinned transaction call",
  stage: "SIMULATE",
  sourceCategory: "native_rpc",
  status: "checked",
};

describe("Evidence presentation transport schema", () => {
  it("accepts a small additive display view without requiring provider runtime metadata", () => {
    expect(
      evidencePresentationSchema.parse({
        version: 1,
        items: [],
        capabilities: [capability],
      }).version,
    ).toBe(1);
  });
  it.each([
    { ...capability, endpoint: "private" },
    { ...capability, raw: {} },
    { ...capability, status: "VERIFIED" },
    { ...capability, reason: "timeout" },
    { ...capability, status: "unknown" },
    {
      ...capability,
      status: "unavailable",
      reason: "upstream private diagnostic",
    },
    {
      ...capability,
      blockContext: { blockNumber: "42", status: "observed", raw: {} },
    },
  ])(
    "rejects raw extras, unnormalized reasons and inconsistent capability states",
    (item) => {
      expect(
        evidencePresentationSchema.safeParse({
          version: 1,
          items: [],
          capabilities: [item],
        }).success,
      ).toBe(false);
    },
  );
});
