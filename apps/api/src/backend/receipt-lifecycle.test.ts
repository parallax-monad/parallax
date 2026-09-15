import { describe, expect, it } from "vitest";
import { InMemoryRunStore } from "../store.js";
import { ChainRegistry } from "./chain-registry.js";
import { createBackendComposition } from "./composition.js";
import {
  createFakeChainAdapter,
  createFakeProtocolAdapter,
  createFakeProviderAdapterHarness,
  createFakeReceiptAnchorer,
  createFakeReceiptSigner,
  createNoopReceiptAnchorer,
  createNoopReceiptSigner,
  fakeBackendFixture,
} from "./fake-harness.js";
import { BackendPipeline } from "./pipeline.js";
import { ProtocolRegistry } from "./protocol-registry.js";
import { ProviderRegistry } from "./provider-registry.js";
import {
  createReceiptLifecycle,
  type ReceiptLifecycleSnapshot,
} from "./receipt-ports.js";

describe("Receipt lifecycle", () => {
  it("returns an observable not-configured state without invoking a builder", async () => {
    let buildCount = 0;
    const lifecycle = createReceiptLifecycle({
      buildReceipt: () => {
        buildCount += 1;
        return "must-not-build";
      },
    });

    expect(lifecycle.status).toBe("not_configured");
    await expect(lifecycle.completion).resolves.toMatchObject({
      status: "not_configured",
      signing: { status: "not_configured" },
      anchoring: { status: "not_configured" },
    });
    expect(buildCount).toBe(0);
  });

  it("supports deterministic no-op adapters without requiring receipt outputs", async () => {
    const lifecycle = createReceiptLifecycle({
      receipt: { decision: "UNKNOWN" },
      signer: createNoopReceiptSigner<Record<string, string>>(),
      anchorer: createNoopReceiptAnchorer<Record<string, string>>(),
    });

    await expect(lifecycle.completion).resolves.toMatchObject({
      status: "anchored",
      signing: { status: "succeeded" },
      anchoring: { status: "succeeded" },
    });
  });

  it("signs before anchoring and exposes successful outputs", async () => {
    const calls: string[] = [];
    const signer = createFakeReceiptSigner<{ decision: string }, string>(
      (receipt) => {
        calls.push(`sign:${receipt.decision}`);
        return "signature";
      },
    );
    const anchorer = createFakeReceiptAnchorer<{ decision: string }, string>(
      (receipt) => {
        calls.push(`anchor:${receipt.decision}`);
        return "anchor";
      },
    );

    const lifecycle = createReceiptLifecycle({
      receipt: { decision: "PROCEED" },
      signer,
      anchorer,
    });

    const result = await lifecycle.completion;

    expect(calls).toEqual(["sign:PROCEED", "anchor:PROCEED"]);
    expect(result).toMatchObject({
      status: "anchored",
      signing: { status: "succeeded", value: "signature" },
      anchoring: { status: "succeeded", value: "anchor" },
    });
    expect(signer.calls).toHaveLength(1);
    expect(anchorer.calls).toHaveLength(1);
  });

  it("observes signer failures and does not anchor an unattested receipt", async () => {
    const failure = new Error("sign failed");
    const anchorer = createFakeReceiptAnchorer(() => "must-not-run");
    const lifecycle = createReceiptLifecycle({
      receipt: "opaque-receipt",
      signer: createFakeReceiptSigner(() => {
        throw failure;
      }),
      anchorer,
    });

    await expect(lifecycle.completion).resolves.toMatchObject({
      status: "failed",
      error: failure,
      signing: { status: "failed", error: failure },
      anchoring: { status: "skipped" },
    });
    expect(anchorer.calls).toHaveLength(0);
  });

  it("observes anchorer failures after a successful signature", async () => {
    const failure = new Error("anchor failed");
    const lifecycle = createReceiptLifecycle({
      receipt: "opaque-receipt",
      signer: createFakeReceiptSigner("signature"),
      anchorer: createFakeReceiptAnchorer(() => {
        throw failure;
      }),
    });

    await expect(lifecycle.completion).resolves.toMatchObject({
      status: "failed",
      error: failure,
      signing: { status: "succeeded", value: "signature" },
      anchoring: { status: "failed", error: failure },
    });
  });

  it("times out a stalled adapter without blocking decision completion", async () => {
    const lifecycle = createReceiptLifecycle({
      receipt: "opaque-receipt",
      signer: createFakeReceiptSigner(
        () => new Promise<string>(() => undefined),
      ),
      timeoutMs: 5,
    });

    expect(lifecycle.status).toBe("pending");
    await expect(lifecycle.completion).resolves.toSatisfy(
      (result: ReceiptLifecycleSnapshot) =>
        result.status === "timed_out" &&
        result.signing.status === "timed_out" &&
        result.anchoring.status === "skipped" &&
        result.error instanceof Error &&
        result.error.name === "ReceiptTimeoutError",
    );
  });

  it("times out anchoring after signing succeeds", async () => {
    const lifecycle = createReceiptLifecycle({
      receipt: "opaque-receipt",
      signer: createFakeReceiptSigner("signature"),
      anchorer: createFakeReceiptAnchorer(
        () => new Promise<string>(() => undefined),
      ),
      timeoutMs: 5,
    });

    await expect(lifecycle.completion).resolves.toSatisfy(
      (result: ReceiptLifecycleSnapshot) =>
        result.status === "timed_out" &&
        result.signing.status === "succeeded" &&
        result.anchoring.status === "timed_out" &&
        result.error instanceof Error &&
        result.error.name === "ReceiptTimeoutError",
    );
  });

  it("exposes the lifecycle handle on BackendPipeline after Decision returns", async () => {
    const fixture = fakeBackendFixture();
    const chain = createFakeChainAdapter(fixture.chain);
    const protocol = createFakeProtocolAdapter(fixture.protocol);
    const provider = createFakeProviderAdapterHarness({
      ...fixture.provider,
      supports: (query) =>
        query.chainId === fixture.chain.chainId &&
        query.protocol === fixture.protocol.id,
    });
    const decisionEvents: string[] = [];
    const runtime = createBackendComposition({
      chainRegistry: new ChainRegistry([chain]),
      protocolRegistry: new ProtocolRegistry([
        {
          chainId: fixture.chain.chainId,
          protocol: fixture.protocol.id,
          adapter: protocol,
        },
      ]),
      providerRegistry: new ProviderRegistry([provider.adapter]),
      normalization: { normalize: () => fixture.provider.intent },
      core: { evaluate: async () => "core" },
      decision: {
        decide: async () => {
          decisionEvents.push("decision");
          return "decision";
        },
      },
      runStore: new InMemoryRunStore(),
      receiptSigner: createFakeReceiptSigner(() => {
        decisionEvents.push("sign");
        return "signature";
      }),
      receiptAnchorer: createFakeReceiptAnchorer(() => {
        decisionEvents.push("anchor");
        return "anchor";
      }),
    });
    const pipeline = new BackendPipeline({
      runtime,
      receiptTimeoutMs: 50,
      buildReceipt: ({ decisionOutput }) => decisionOutput,
    });

    const execution = await pipeline.execute({
      rawInput: {},
      runId: "receipt-pipeline-run",
      chainId: fixture.chain.chainId,
      protocol: fixture.protocol.id,
    });

    expect(execution.decisionOutput).toBe("decision");
    expect(execution.receiptLifecycle.status).toBe("pending");
    expect(decisionEvents[0]).toBe("decision");
    await expect(execution.receiptLifecycle.completion).resolves.toMatchObject({
      status: "anchored",
    });
    expect(decisionEvents).toEqual(["decision", "sign", "anchor"]);
  });
});
