import type { NormalizedSwapIntent, RunResult } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryRunStore } from "./store.js";

describe("InMemoryRunStore", () => {
  const intent = {
    chainId: 143,
    protocol: "kuru",
    sender: "0x1111111111111111111111111111111111111111",
    recipient: "0x1111111111111111111111111111111111111111",
    recipientSource: "defaulted_from_sender",
    tokenIn: { kind: "native" },
    tokenOut: {
      kind: "erc20",
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    },
    amountInAtomic: "1",
    economicBoundary: {
      availability: "unavailable",
      source: "unavailable",
    },
  } as NormalizedSwapIntent;

  it("moves a run from started to completed", async () => {
    const store = new InMemoryRunStore();
    const result = { runId: "run-1", intent } as RunResult;

    await store.start("run-1", intent);
    expect(store.get("run-1")).toMatchObject({ status: "started", intent });
    await store.complete(result);

    expect(store.get("run-1")).toMatchObject({
      status: "completed",
      result,
    });
    expect(store.get("missing")).toBeUndefined();
  });

  it("records failures and rejects duplicate or terminal transitions", async () => {
    const store = new InMemoryRunStore();
    await store.start("run-1", intent);

    await expect(store.start("run-1", intent)).rejects.toThrow(
      "already exists",
    );
    await store.fail("run-1", "AGENT_FLOW_ERROR");

    expect(store.get("run-1")).toMatchObject({
      status: "failed",
      failure: "AGENT_FLOW_ERROR",
    });
    await expect(
      store.fail("run-1", "INVALID_AGENT_FLOW_RESPONSE"),
    ).rejects.toThrow("not in the started state");
  });

  it("does not expose mutable references to stored records", async () => {
    const store = new InMemoryRunStore();
    await store.start("run-1", intent);
    const first = store.get("run-1");
    if (first === undefined) throw new Error("missing test record");

    first.intent.amountInAtomic = "999";

    expect(store.get("run-1")?.intent.amountInAtomic).toBe("1");
  });
});
