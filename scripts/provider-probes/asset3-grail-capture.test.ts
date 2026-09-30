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
  it("binds the historical source, immutable capture, and manifest", () => {
    expect(sha(bytes)).toBe(
      "sha256:450fdb8d6adf4ed0c49b351cc8ab75614e589edb96bca01b7933ed3f8c4728d7",
    );
    expect(capture.sourceHead).toBe("fab582d3ebdc33fc171a40bc79e0ec506162a855");
    // This immutable capture describes sourceHead, not whatever code is current today.
    expect(capture.provenance.manifest).toEqual({
      "scripts/provider-probes/asset3-grail-feasibility.ts":
        "sha256:0125f6bc267cdfd28a5d30c2aefe7aad82df2b1f3bb85b018faddabf56983f9a",
      "apps/api/src/backend/camelot-v3-protocol-adapter.ts":
        "sha256:0c509324edb0759bc269b846198a1cc39ff8b129e79c0003a33748ea476e6b0c",
      "apps/api/src/backend/camelot-v3-binding.ts":
        "sha256:2dfc23a0269d0c834b4143a038762f2304727d7a6083e7b367309307d43d282a",
      "apps/api/src/backend/native-rpc-client.ts":
        "sha256:a223781a34a7c1e40cae244575aa71aebe588a24e4e31799492047b04228f2b1",
      "apps/api/src/trusted-token-registry.ts":
        "sha256:c114dcd651d0bf6406a5c19c7595489dd407f266ef9102cf09289bb9a2f34802",
      "fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-29T10-09-52-993Z/capture.json":
        "sha256:5a7ed69ca2dcf0413f79ddd29749e6f0ae652da91493814fece00cb0963b7b20",
    });
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
