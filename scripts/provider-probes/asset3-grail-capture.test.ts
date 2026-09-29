import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const path =
  "fixtures/provider-registry/be-109/grail-usdc-2026-09-29T13-31-53-975Z/capture.json";
const bytes = readFileSync(resolve(root, path));
const capture = JSON.parse(bytes.toString("utf8"));
const sha = (data: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;

describe("#109 bounded GRAIL feasibility capture", () => {
  it("binds the source, immutable capture, and manifest", () => {
    expect(sha(bytes)).toBe(
      "sha256:450fdb8d6adf4ed0c49b351cc8ab75614e589edb96bca01b7933ed3f8c4728d7",
    );
    expect(capture.sourceHead).toBe("fab582d3ebdc33fc171a40bc79e0ec506162a855");
    for (const [file, digest] of Object.entries(capture.provenance.manifest)) {
      expect(sha(readFileSync(resolve(root, file)))).toBe(digest);
    }
  });

  it("records discovery before one selected real route", () => {
    expect(capture.status).toBe("QUALIFIED_REAL_FEASIBILITY");
    expect(capture.productionSupport).toBe(false);
    expect(capture.discovery.candidates).toHaveLength(2);
    expect(capture.discovery.rejected).toHaveLength(1);
    expect(capture.discovery.rejected[0].symbol).toBe("xGRAIL");
    expect(capture.discovery.selected).toBe("GRAIL");
    expect(capture.token.decimals).toBe(18);
    expect(capture.route.pool).toBe(capture.discovery.candidates[0].usdcPool);
    expect(BigInt(capture.route.activeLiquidity)).toBeGreaterThan(0n);
    expect(BigInt(capture.route.poolGrailBalanceAtomic)).toBeGreaterThan(0n);
    expect(BigInt(capture.route.poolUsdcBalanceAtomic)).toBeGreaterThan(0n);
  });

  it("binds calldata, account state, quote, and read-only execution", () => {
    const tx = capture.prepared.unsignedTransaction;
    const intent = capture.prepared.intent;
    const words = Array.from({ length: 7 }, (_, index) =>
      tx.data.slice(10 + index * 64, 10 + (index + 1) * 64),
    );
    expect(tx.data.slice(0, 10)).toBe("0xbc651188");
    expect(tx.from.toLowerCase()).toBe(intent.sender.toLowerCase());
    expect(tx.to.toLowerCase()).toBe(capture.sender.spender.toLowerCase());
    expect(tx.value).toBe("0x0");
    expect(`0x${words[0].slice(-40)}`).toBe(
      intent.tokenIn.address.toLowerCase(),
    );
    expect(`0x${words[1].slice(-40)}`).toBe(
      intent.tokenOut.address.toLowerCase(),
    );
    expect(`0x${words[2].slice(-40)}`).toBe(intent.recipient.toLowerCase());
    expect(BigInt(`0x${words[4]}`).toString()).toBe(intent.amountInAtomic);
    expect(BigInt(`0x${words[5]}`).toString()).toBe(
      ((BigInt(capture.quote.amountOutAtomic) * 99n) / 100n).toString(),
    );
    expect(BigInt(capture.sender.usdcBalanceAtomic)).toBeGreaterThanOrEqual(
      BigInt(intent.amountInAtomic),
    );
    expect(BigInt(capture.sender.allowanceAtomic)).toBeGreaterThanOrEqual(
      BigInt(intent.amountInAtomic),
    );
    expect(BigInt(capture.sender.nativeBalanceWei)).toBeGreaterThan(
      BigInt(capture.evaluation.ethEstimateGas.gasUnits) *
        BigInt(capture.sender.observedGasPriceWei),
    );
    expect(capture.evaluation.ethCall).toEqual({
      status: "success",
      amountOutAtomic: capture.quote.amountOutAtomic,
    });
    expect(capture.evaluation.ethEstimateGas.status).toBe("success");
    expect(capture.chain.blockHashRechecked).toBe(true);
    expect(capture.quote.blockNumber).toBe(capture.chain.blockNumber);
    expect(capture.noStateOverride).toBe(true);
    expect(capture.noWriteRpc).toBe(true);
  });

  it("keeps current trace limits and endpoint redaction explicit", () => {
    expect(capture.evaluation.debugTraceCall.status).toBe("unavailable");
    expect(capture.sender.spenderBinding).toMatch(
      /^prior_qualified_USDC_router_trace:/,
    );
    expect(bytes.toString("utf8")).not.toMatch(
      /sepolia-rollup\.arbitrum\.io|quicknode|api[_-]?key|private[_-]?key|bearer/i,
    );
  });
});
