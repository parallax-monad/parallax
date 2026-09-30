import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectArbitrumOneSourceManifest } from "./arbitrum-one-feasibility.js";

const root = resolve(import.meta.dirname, "../..");
const bytes = readFileSync(
  resolve(
    root,
    "fixtures/provider-registry/be-090/one-eth-usdc-2026-09-29T14-26-10-520Z/capture.json",
  ),
);
const capture = JSON.parse(bytes.toString("utf8"));
const sha = (data: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;

describe("#90 historical Arbitrum One capture static integrity", () => {
  it("preserves immutable historical capture bytes and source identities", () => {
    expect(sha(bytes)).toBe(
      "sha256:da79405cbf55d49d71df568371ba6af222e3d82669e172ea526e867f1560760c",
    );
    expect(capture.sourceHead).toBe("f4bacf2d509e2b9f9de0365a7ee8ecedd799e609");
    expect(
      capture.provenance.manifest[
        "scripts/provider-probes/arbitrum-one-feasibility.ts"
      ],
    ).toBe(
      "sha256:2f35988c768b9c10ed376261b940c1b28ddb574396ab5b38aa2690514bb7de1e",
    );
    // Manifest entries describe the historical source head. Later main
    // may legitimately edit or remove them; capture integrity must not demand
    // that a historical Backend/Frontend/SDK snapshot remain the live runtime.
    for (const path of ["apps/api/src/backend/native-rpc-client.ts"]) {
      expect(sha(readFileSync(resolve(root, path))), path).toBe(
        capture.provenance.manifest[path],
      );
    }
  });

  it("collects a current manifest without removed Backend or SDK dependencies", () => {
    const manifest = collectArbitrumOneSourceManifest(root);
    expect(
      Object.hasOwn(
        manifest,
        "apps/api/src/backend/camelot-v3-qualified-spender.ts",
      ),
    ).toBe(false);
    expect(Object.hasOwn(manifest, "packages/sdk/src/client.ts")).toBe(false);
    expect(Object.keys(manifest)).toHaveLength(17);
    for (const [path, digest] of Object.entries(manifest)) {
      expect(sha(readFileSync(resolve(root, path))), path).toBe(digest);
    }
  });

  it("binds One-only protocol, pool, and on-chain token identities", () => {
    expect(capture.status).toBe("ARBITRUM_ONE_FEASIBILITY_QUALIFIED");
    expect(capture.target.chainId).toBe(42161);
    expect(capture.target.amountInWei).toBe("1000000000000000");
    expect(capture.pinnedBlock).toMatchObject({
      number: "510054964",
      hash: "0x10244031ec7f830bfb8d81cc0310a8b60bb13919f73e1e000cfe2a690467b26d",
      timestamp: "1790691959",
    });
    expect(capture.quote.blockNumber).toBe(capture.pinnedBlock.number);
    expect(capture.contracts.factory).toBe(
      "0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B",
    );
    expect(capture.contracts.router).toBe(
      "0x1F721E2E82F6676FCE4eA07A5958cF098D339e18",
    );
    expect(capture.contracts.quoter).toBe(
      "0x0Fc73040b26E9bC8514fA028D998E73A254Fa76E",
    );
    expect(capture.tokens.weth.decimals).toBe(18);
    expect(capture.contracts.weth).toBe(
      "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    );
    expect(capture.contracts.usdc).toBe(
      "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    );
    expect(capture.tokens.weth.address).toBe(capture.contracts.weth);
    expect(capture.tokens.output.address).toBe(capture.contracts.usdc);
    expect(capture.tokens.output.decimals).toBe(6);
    expect(capture.tokens.output.decimalsSource).toBe(
      "onchain_at_pinned_block",
    );
    expect(capture.route.pool).toBe(
      "0xb1026b8e7276e7ac75410f1fcbbe21796e8f7526",
    );
    expect(capture.route.token0).toBe(capture.contracts.weth.toLowerCase());
    expect(capture.route.token1).toBe(capture.contracts.usdc.toLowerCase());
    expect(BigInt(capture.route.activeLiquidity)).toBeGreaterThan(0n);
    expect(BigInt(capture.route.poolWethBalanceAtomic)).toBeGreaterThan(0n);
    expect(BigInt(capture.route.poolUsdcBalanceAtomic)).toBeGreaterThan(0n);
    expect(capture.pinnedBlock.blockHashRechecked).toBe(true);
    expect(capture.pinnedBlock.chainIdRechecked).toBe(true);
  });

  it("checks the exact native unsigned transaction and recorded historical result", () => {
    const tx = capture.prepared.unsignedTransaction;
    const decoded = capture.prepared.decoded;
    const words = Array.from({ length: 7 }, (_, index) =>
      tx.data.slice(10 + 64 * index, 10 + 64 * (index + 1)),
    );
    expect(tx.data.slice(0, 10)).toBe("0xbc651188");
    expect(tx.data.length).toBe(2 + 8 + 7 * 64);
    expect(tx.chainId).toBe("0xa4b1");
    expect(tx.from).toBe(capture.sender.address);
    expect(tx.to).toBe(capture.contracts.router);
    expect(BigInt(tx.value).toString()).toBe(capture.quote.inputAtomic);
    expect(`0x${words[0].slice(-40)}`).toBe(decoded.tokenIn);
    expect(`0x${words[1].slice(-40)}`).toBe(decoded.tokenOut);
    expect(`0x${words[2].slice(-40)}`).toBe(decoded.recipient);
    expect(decoded.tokenIn).toBe(capture.contracts.weth.toLowerCase());
    expect(decoded.tokenOut).toBe(capture.contracts.usdc.toLowerCase());
    expect(decoded.recipient).toBe(tx.from);
    expect(BigInt(`0x${words[3]}`).toString()).toBe(decoded.deadline);
    expect(BigInt(decoded.deadline)).toBe(
      BigInt(capture.pinnedBlock.timestamp) + 3600n,
    );
    expect(BigInt(`0x${words[6]}`).toString()).toBe("0");
    expect(decoded.sqrtPriceLimitX96).toBe("0");
    expect(BigInt(`0x${words[4]}`).toString()).toBe(decoded.amountInAtomic);
    expect(BigInt(`0x${words[5]}`).toString()).toBe(
      decoded.amountOutMinimumAtomic,
    );
    expect(BigInt(decoded.amountOutMinimumAtomic)).toBe(
      (BigInt(capture.quote.outputAtomic) * 99n) / 100n,
    );
    expect(capture.quote.outputAtomic).toBe("2716115");
    expect(decoded.amountInAtomic).toBe(capture.quote.inputAtomic);
    expect(decoded.amountOutMinimumAtomic).toBe("2688953");
    expect(capture.prepared.transactionFingerprint).toBe(
      sha(JSON.stringify(tx)),
    );
    expect(capture.prepared.binding).toEqual({
      chainId: capture.target.chainId,
      protocol: "camelot-v3",
      factory: capture.contracts.factory,
      pool: capture.route.pool,
      router: tx.to,
      quoter: capture.quote.quoter,
      nativeInputWrappedAs: capture.contracts.weth,
      tokenOut: capture.contracts.usdc,
      inputAtomic: decoded.amountInAtomic,
      quoteOutputAtomic: capture.quote.outputAtomic,
      amountOutMinimumAtomic: decoded.amountOutMinimumAtomic,
      protectionPolicy: "99_percent_of_pinned_quote_floor",
      recipient: decoded.recipient,
      txValue: tx.value,
    });
    expect(BigInt(capture.sender.nativeBalanceWei)).toBeGreaterThanOrEqual(
      BigInt(tx.value) +
        BigInt(capture.evaluation.ethEstimateGas.gasUnits) *
          BigInt(capture.sender.observedGasPriceWei),
    );
    expect(capture.sender.allowance).toBe("NOT_APPLICABLE");
    expect(capture.sender.spender).toBe("NOT_APPLICABLE");
    expect(capture.sender.nativeBalanceCoversInputAndObservedGas).toBe(true);
    expect(capture.evaluation.ethCall).toEqual({
      status: "success",
      amountOutAtomic: capture.quote.outputAtomic,
    });
    expect(capture.evaluation.ethEstimateGas.status).toBe("success");
    expect(capture.evaluation.ethEstimateGas.gasUnits).toBe("365025");
    expect(BigInt(capture.evaluation.ethEstimateGas.gasUnits)).toBeGreaterThan(
      0n,
    );
  });

  it("retains only bounded feasibility and secret-safe normalized evidence", () => {
    expect(capture.productionSupport).toBe(false);
    expect(capture.productAccepted).toBe(false);
    expect(capture.readOnly).toBe(true);
    expect(capture.noStateOverride).toBe(true);
    expect(capture.noWriteRpc).toBe(true);
    expect(capture.secretScan).toMatchObject({
      status: "PASS",
      credentialPatternHits: 0,
      endpointRecorded: false,
    });
    expect(capture.evaluation.debugTraceCall.status).toBe("unavailable");
    expect(capture.abstractionAssessment.classification).toBe(
      "BACKEND_ARCH_CHANGE",
    );
    expect(capture.abstractionAssessment.configOnly).toBe(false);
    const serialized = bytes.toString("utf8");
    expect(serialized).not.toMatch(
      /arb1\.arbitrum\.io|rpcUrl|apiKey|authorization|privateKey|mnemonic|"secret"/i,
    );
  });
});
