import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const capturePath =
  "fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-29T10-09-52-993Z/capture.json";
const bytes = readFileSync(resolve(root, capturePath));
const capture = JSON.parse(bytes.toString("utf8"));
const digest = (data: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;

describe("#103 real USDC -> WETH qualified capture", () => {
  it("binds the clean committed source and immutable capture digest", () => {
    expect(digest(bytes)).toBe(
      "sha256:5a7ed69ca2dcf0413f79ddd29749e6f0ae652da91493814fece00cb0963b7b20",
    );
    expect(capture.sourceHead).toBe("69011893029f546149563ee1b933c6b8aaec31fa");
    expect(capture.provenance.manifest).toEqual({
      "scripts/provider-probes/usdc-weth-camelot-feasibility.ts":
        "sha256:ff7816fbf8c87a3f38c0ef1cb93ab0a674e325bd4633acfad4d3413a586264ee",
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

  it("records bounded candidate discovery and one qualifying real EOA", () => {
    expect(capture.status).toBe("QUALIFIED_REAL");
    expect(capture.assetCoverage).toBe("FEASIBILITY_QUALIFIED_ONLY");
    expect(capture.candidateDiscovery).toMatchObject({
      fromBlock: "0",
      transferLogsObserved: 3649,
      uniqueAccountsObserved: 210,
      positiveHoldersObserved: 165,
      qualifyingAccountsObserved: 3,
    });
    const selected = capture.candidates.find(
      (candidate: { sender: string }) =>
        candidate.sender.toLowerCase() === capture.selectedSender.toLowerCase(),
    );
    expect(selected.balanceSufficient).toBe(true);
    expect(selected.allowanceSufficient).toBe(true);
    expect(BigInt(selected.nativeBalanceWei)).toBeGreaterThan(0n);
  });

  it("binds the exact ERC-20 transaction and actual spender", () => {
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
    expect(capture.evaluation.callTrace).toMatchObject({
      status: "success",
      erc20TransferFromObserved: true,
      actualSpender: capture.addresses.router,
    });
  });

  it("requires both real read-only execution checks to succeed", () => {
    expect(capture.evaluation.ethCall.status).toBe("success");
    expect(BigInt(capture.evaluation.ethCall.amountOutAtomic)).toBeGreaterThan(
      0n,
    );
    expect(capture.evaluation.ethEstimateGas.status).toBe("success");
    expect(BigInt(capture.evaluation.ethEstimateGas.gasUnits)).toBeGreaterThan(
      0n,
    );
    expect(capture.chain.blockHashRechecked).toBe(true);
    expect(capture.quote.blockNumber).toBe(capture.chain.blockNumber);
  });

  it("remains endpoint- and secret-safe", () => {
    const serialized = bytes.toString("utf8");
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(
      /rpcUrl|apiKey|authorization|privateKey|mnemonic|secret/i,
    );
  });
});
