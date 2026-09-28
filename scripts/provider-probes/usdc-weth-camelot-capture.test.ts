import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const capturePath =
  "fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-28T11-39-14-324Z/capture.json";
const bytes = readFileSync(resolve(root, capturePath));
const capture = JSON.parse(bytes.toString("utf8"));
const digest = (data: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;

describe("#103 real USDC -> WETH blocked-account capture", () => {
  it("binds the exact committed source manifest and capture digest", () => {
    expect(digest(bytes)).toBe(
      "sha256:44c665475d8ca88feefb91ed810fedafb7592c021b4534f7b12f973e85dd9c4e",
    );
    expect(capture.sourceHead).toBe("35f6ddfd3f6c5c4f8b503c5725a05ce9c337073b");
    for (const [path, hash] of Object.entries(
      capture.provenance.manifest as Record<string, string>,
    )) {
      expect(digest(readFileSync(resolve(root, path)))).toBe(hash);
    }
  });

  it("records real route, token precision, quote and a pinned block", () => {
    expect(capture.real).toBe(true);
    expect(capture.readOnly).toBe(true);
    expect(capture.chain.chainId).toBe(421614);
    expect(capture.chain.blockHashRechecked).toBe(true);
    expect(capture.quote.blockNumber).toBe(capture.chain.blockNumber);
    expect(capture.tokenMetadata).toMatchObject({
      usdcDecimals: 18,
      wethDecimals: 18,
      source: "onchain_verified_at_pinned_block",
      trustedRegistryResolved: true,
    });
    expect(capture.route.factoryPool.toLowerCase()).toBe(
      capture.addresses.pool.toLowerCase(),
    );
    expect(BigInt(capture.route.activeLiquidity)).toBeGreaterThan(0n);
    expect(BigInt(capture.quote.amountOutAtomic)).toBeGreaterThan(0n);
  });

  it("preserves the exact ERC-20 transaction and actual spender binding", () => {
    const tx = capture.prepared.unsignedTransaction;
    const intent = capture.prepared.intent;
    const encoded = tx.data.slice(2);
    const words = Array.from({ length: 7 }, (_, index) =>
      encoded.slice(8 + index * 64, 8 + (index + 1) * 64),
    );
    expect(tx.from.toLowerCase()).toBe(intent.sender.toLowerCase());
    expect(tx.to.toLowerCase()).toBe(capture.addresses.router.toLowerCase());
    expect(tx.value).toBe("0x0");
    expect(encoded.slice(0, 8)).toBe("bc651188");
    expect(`0x${words[0].slice(-40)}`).toBe(
      capture.addresses.usdc.toLowerCase(),
    );
    expect(`0x${words[1].slice(-40)}`).toBe(
      capture.addresses.weth.toLowerCase(),
    );
    expect(`0x${words[2].slice(-40)}`).toBe(intent.recipient.toLowerCase());
    expect(BigInt(`0x${words[4]}`).toString()).toBe(intent.amountInAtomic);
    expect(BigInt(`0x${words[5]}`).toString()).toBe(
      ((BigInt(capture.quote.amountOutAtomic) * 99n) / 100n).toString(),
    );
    expect(capture.evaluation.callTrace).toMatchObject({
      status: "success",
      erc20TransferFromObserved: true,
      actualSpender: capture.addresses.router,
    });
  });

  it("keeps account and execution blockers separate from construction", () => {
    const selected = capture.candidates.find(
      (candidate: { sender: string }) =>
        candidate.sender === capture.selectedSender,
    );
    expect(selected).toMatchObject({
      usdcBalanceAtomic: "0",
      routerAllowanceAtomic: "0",
      balanceSufficient: false,
      allowanceSufficient: false,
    });
    expect(capture.prepared.binding.amountInAtomic).toBe(
      capture.prepared.intent.amountInAtomic,
    );
    expect(capture.evaluation.ethCall.status).toBe("failed");
    expect(capture.evaluation.ethEstimateGas.status).toBe("failed");
    expect(capture.status).toBe("BLOCKED_ACCOUNT_STATE");
    expect(capture.assetCoverage).toBe("NOT_COMPLETE");
  });

  it("does not persist an endpoint, raw provider payload, or RPC error text", () => {
    const serialized = bytes.toString("utf8");
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/rpcUrl|apiKey|authorization|privateKey/i);
    expect(capture.evaluation.ethCall).toEqual({
      status: "failed",
      kind: "RPC_ERROR",
      rpcCode: 3,
    });
    expect(capture.evaluation.ethEstimateGas).toEqual({
      status: "failed",
      kind: "RPC_ERROR",
      rpcCode: 3,
    });
  });
});
