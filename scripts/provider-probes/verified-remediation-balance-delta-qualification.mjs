import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_CAPTURE =
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
const BALANCE_OF_SELECTOR = "0x70a08231";

function validAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function validQuantity(value) {
  return (
    typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  );
}

function validWord(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function balanceOfCalldata(address) {
  if (!validAddress(address)) throw new Error("invalid balanceOf address");
  return BALANCE_OF_SELECTOR + address.slice(2).padStart(64, "0");
}
export function buildStateOverrides(post) {
  if (!post || typeof post !== "object" || Array.isArray(post))
    throw new Error("prestateTracer post must be an object");

  const overrides = {};
  for (const [address, rawEntry] of Object.entries(post)) {
    if (!validAddress(address)) throw new Error("invalid post-state address");
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry))
      throw new Error("invalid post-state entry");

    const entry = rawEntry;
    const allowed = new Set(["storage", "balance", "nonce", "code"]);
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key))
        throw new Error("unsupported post-state field: " + key);
    }

    const override = {};
    if (entry.storage !== undefined) {
      if (
        !entry.storage ||
        typeof entry.storage !== "object" ||
        Array.isArray(entry.storage)
      )
        throw new Error("invalid post-state storage");
      const stateDiff = {};
      for (const [slot, value] of Object.entries(entry.storage)) {
        if (!validWord(slot) || !validWord(value))
          throw new Error("invalid post-state storage slot/value");
        stateDiff[slot.toLowerCase()] = value.toLowerCase();
      }
      override.stateDiff = stateDiff;
    }

    if (entry.balance !== undefined) {
      if (!validQuantity(entry.balance))
        throw new Error("invalid post-state balance");
      override.balance = entry.balance.toLowerCase();
    }
    if (entry.nonce !== undefined) {
      if (!validQuantity(entry.nonce))
        throw new Error("invalid post-state nonce");
      override.nonce = entry.nonce.toLowerCase();
    }
    if (entry.code !== undefined) {
      if (
        typeof entry.code !== "string" ||
        !/^0x(?:[0-9a-fA-F]{2})*$/.test(entry.code)
      )
        throw new Error("invalid post-state code");
      override.code = entry.code.toLowerCase();
    }

    if (Object.keys(override).length === 0)
      throw new Error("empty post-state override entry");
    overrides[address.toLowerCase()] = override;
  }

  if (Object.keys(overrides).length === 0)
    throw new Error("empty post-state diff");
  return overrides;
}

function sha(value) {
  return (
    "sha256:" +
    createHash("sha256")
      .update(typeof value === "string" ? value : JSON.stringify(value))
      .digest("hex")
  );
}

async function rpc(url, requestId, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    }),
  });
  const body = await response.json();
  if (body.error)
    throw new Error(method + " failed: " + JSON.stringify(body.error));
  return body.result;
}

function exactPreparedContext() {
  const capture = JSON.parse(readFileSync(SOURCE_CAPTURE, "utf8"));
  const prepared = capture.observations.preparedSwap;
  const tx = prepared.tx;
  const blockHex =
    capture.observations.pinnedBlock?.number ??
    capture.observations.observedHead;
  const blockTag = blockHex.startsWith("0x")
    ? blockHex
    : "0x" + BigInt(blockHex).toString(16);
  return {
    prepared,
    tx,
    blockTag,
    blockNumber: BigInt(blockTag).toString(),
    tokenOut: prepared.route.tokenOut.toLowerCase(),
    recipient: tx.from.toLowerCase(),
    chainId: 421614,
  };
}

async function main() {
  const url = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  if (!url) throw new Error("ARBITRUM_SEPOLIA_RPC_URL is required");
  const sourceHead = process.env.SOURCE_HEAD;
  if (!/^[0-9a-f]{40}$/.test(sourceHead ?? ""))
    throw new Error("SOURCE_HEAD required");

  const context = exactPreparedContext();
  const { prepared, tx, blockTag, blockNumber, tokenOut, recipient, chainId } =
    context;
  const block = await rpc(url, 1, "eth_getBlockByNumber", [blockTag, false]);
  if (!block?.hash) throw new Error("pinned block hash unavailable");

  const balanceData = balanceOfCalldata(recipient);
  const preBalanceRaw = await rpc(url, 2, "eth_call", [
    { to: tokenOut, data: balanceData },
    blockTag,
  ]);
  const preBalance = BigInt(preBalanceRaw);

  async function replay(idBase) {
    const diff = await rpc(url, idBase, "debug_traceCall", [
      { from: tx.from, to: tx.to, data: tx.data, value: tx.value },
      blockTag,
      { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
    ]);
    if (!diff?.post) throw new Error("prestateTracer post diff unavailable");
    const overrides = buildStateOverrides(diff.post);

    const tokenOverride = overrides[tokenOut];
    if (!tokenOverride?.stateDiff)
      throw new Error("tokenOut post storage diff unavailable");

    const postBalanceRaw = await rpc(url, idBase + 1, "eth_call", [
      { to: tokenOut, data: balanceData },
      blockTag,
      overrides,
    ]);
    const postBalance = BigInt(postBalanceRaw);
    const delta = postBalance - preBalance;

    return {
      capturedAt: new Date().toISOString(),
      prestateDiffFingerprint: sha(diff),
      stateOverridesFingerprint: sha(overrides),
      changedAddressCount: Object.keys(overrides).length,
      tokenOutChangedStorageSlotCount: Object.keys(tokenOverride.stateDiff)
        .length,
      preBalanceAtomic: preBalance.toString(),
      postBalanceAtomic: postBalance.toString(),
      deltaAtomic: delta.toString(),
    };
  }

  const first = await replay(10);
  const second = await replay(20);
  const unsigned = {
    kind: "unsigned",
    payload: {
      from: tx.from,
      to: tx.to,
      data: tx.data,
      value: tx.value,
    },
  };
  const output = {
    schemaVersion: "be-107-recipient-balance-delta-qualification-v1",
    classification:
      "SUPPLEMENTARY_EVENT_DERIVATION_CANDIDATE_NOT_VERIFIED_GATE",
    candidateDerivation: "recipient_balance_delta",
    real: true,
    readOnly: true,
    sourceHead,
    chainId,
    pinnedBlock: {
      number: blockNumber,
      hash: block.hash.toLowerCase(),
    },
    identity: {
      tokenOut,
      recipient,
      preparedUnsignedTransactionFingerprint: sha(JSON.stringify(unsigned)),
    },
    method: {
      preBalance: "eth_call balanceOf at pinned pre-state",
      executionDiff: "debug_traceCall prestateTracer(diffMode=true)",
      postBalance:
        "eth_call balanceOf at pinned state with full returned post-state diff as state overrides",
    },
    expectedQuoteAmountOutAtomic: String(prepared.quoteAmountOutAtomic),
    replays: [first, second],
    replayComparison: {
      prestateDiffFingerprintStable:
        first.prestateDiffFingerprint === second.prestateDiffFingerprint,
      stateOverridesFingerprintStable:
        first.stateOverridesFingerprint === second.stateOverridesFingerprint,
      postBalanceStable: first.postBalanceAtomic === second.postBalanceAtomic,
      deltaStable: first.deltaAtomic === second.deltaAtomic,
    },
    crossChecks: {
      deltaMatchesQuote:
        first.deltaAtomic === String(prepared.quoteAmountOutAtomic),
      secondDeltaMatchesQuote:
        second.deltaAtomic === String(prepared.quoteAmountOutAtomic),
    },
    limitations: [
      "The balance delta is reconstructed from the same Provider's prestateTracer post-state diff; this does not independently establish Provider completeness or Provider SUCCESS.",
      "This qualification capture is not production Backend integration and does not create canonical Evidence by itself.",
      "This capture does not establish simulation.complete, receipt completeness, warnings completeness, Risk PROCEED, or VERIFIED remediation.",
      "Raw Provider payload, RPC URL, and credentials are not persisted.",
    ],
  };

  writeFileSync(process.argv[2], JSON.stringify(output, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output: process.argv[2],
        candidateDerivation: output.candidateDerivation,
        replayComparison: output.replayComparison,
        deltaAtomic: first.deltaAtomic,
        expectedQuoteAmountOutAtomic: output.expectedQuoteAmountOutAtomic,
        deltaMatchesQuote: output.crossChecks.deltaMatchesQuote,
        changedAddressCount: first.changedAddressCount,
        tokenOutChangedStorageSlotCount: first.tokenOutChangedStorageSlotCount,
      },
      null,
      2,
    ),
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "unknown balance-delta failure",
    );
    process.exitCode = 1;
  });
}
