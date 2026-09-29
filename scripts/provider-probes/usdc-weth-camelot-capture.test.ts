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
    expect(capture.provenance.manifest).toEqual({
      "scripts/provider-probes/usdc-weth-camelot-feasibility.ts":
        "sha256:24533a176ced4f3e1f0b7782be00dc53d351b324175dc540f9d0a528613f5fab",
      "apps/api/src/backend/camelot-v3-protocol-adapter.ts":
        "sha256:af5375017d047eedb2d2b81010afac0dc34b2a670e40932e05c3d73430d6b037",
      "apps/api/src/backend/camelot-v3-binding.ts":
        "sha256:af62ee09c21cfef9abb361265736bd022da7fa7da3af46f6d6af7c24c28a2fe5",
      "apps/api/src/backend/native-rpc-client.ts":
        "sha256:a223781a34a7c1e40cae244575aa71aebe588a24e4e31799492047b04228f2b1",
      "apps/api/src/trusted-token-registry.ts":
        "sha256:c114dcd651d0bf6406a5c19c7595489dd407f266ef9102cf09289bb9a2f34802",
      "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json":
        "sha256:85147b852e1e4b514af64241fede641f6a2b6db4f2056f0ab44d04164125cf23",
    });
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
