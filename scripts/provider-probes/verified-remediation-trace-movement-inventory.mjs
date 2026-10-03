import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  inventoryReturnedTraceMovements,
  normalizeRecipientTokenOutTransfers,
} from "./verified-remediation-trace-event-normalization.mjs";

const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL;
if (!RPC) throw new Error("ARBITRUM_SEPOLIA_RPC_URL is required");
const sourceHead = process.env.SOURCE_HEAD;
if (!/^[0-9a-f]{40}$/.test(sourceHead ?? ""))
  throw new Error("SOURCE_HEAD required");

const capture = JSON.parse(
  readFileSync(
    "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json",
    "utf8",
  ),
);
const prepared = capture.observations.preparedSwap;
const tx = prepared.tx;
const chainId = 421614;
const blockHex =
  capture.observations.pinnedBlock?.number ?? capture.observations.observedHead;
const blockTag = blockHex.startsWith("0x")
  ? blockHex
  : "0x" + BigInt(blockHex).toString(16);
const blockNumber = BigInt(blockTag).toString();
const sender = tx.from.toLowerCase();
const recipient = sender;
const router = tx.to.toLowerCase();
const tokenIn = prepared.route.tokenIn.toLowerCase();
const tokenOut = prepared.route.tokenOut.toLowerCase();
const pool = prepared.route.pool.toLowerCase();

const unsigned = {
  kind: "unsigned",
  payload: { from: tx.from, to: tx.to, data: tx.data, value: tx.value },
};
const sha = (value) =>
  "sha256:" +
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const txFingerprint = sha(JSON.stringify(unsigned));

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(method + " failed: " + body.error.code);
  return body.result;
}

const block = await rpc("eth_getBlockByNumber", [blockTag, false]);
if (!block?.hash) throw new Error("block hash unavailable");

async function replay() {
  const capturedAt = new Date().toISOString();
  const trace = await rpc("debug_traceCall", [
    { from: tx.from, to: tx.to, data: tx.data, value: tx.value },
    blockTag,
    { tracer: "callTracer", tracerConfig: { withLog: true } },
  ]);
  const eventNet = normalizeRecipientTokenOutTransfers({
    trace,
    tokenOut,
    recipient,
  });
  const inventory = inventoryReturnedTraceMovements({ trace });
  if (!eventNet.qualificationUsable)
    throw new Error(
      "tokenOut normalization failed closed: " +
        eventNet.failClosedReasons.join(","),
    );
  if (!inventory.returnedTraceInventoryUsable)
    throw new Error(
      "movement inventory failed closed: " +
        inventory.failClosedReasons.join(","),
    );

  return {
    capturedAt,
    resultFingerprint: sha(trace),
    tokenOutNet: {
      recipient,
      tokenOut,
      incomingAtomic: eventNet.normalized.incomingAtomic,
      outgoingAtomic: eventNet.normalized.outgoingAtomic,
      netAtomic: eventNet.normalized.netAtomic,
      relevantTransferCount: eventNet.relevantTokenOutTransferCount,
    },
    movementInventory: {
      nativeValueMovements: inventory.nativeValueMovements,
      transferTopicMovements: inventory.transferTopicMovements,
      observedTransferTokenAddresses: inventory.observedTransferTokenAddresses,
      totalTraceLogCount: inventory.totalTraceLogCount,
      fingerprint: sha({
        nativeValueMovements: inventory.nativeValueMovements,
        transferTopicMovements: inventory.transferTopicMovements,
      }),
    },
  };
}
const first = await replay();
const second = await replay();
const output = {
  schemaVersion: "be-107-trace-movement-inventory-v1",
  classification: "SUPPLEMENTARY_EVENT_DERIVATION_CANDIDATE_NOT_VERIFIED_GATE",
  real: true,
  sourceHead,
  chainId,
  pinnedBlock: {
    number: blockNumber,
    hash: block.hash.toLowerCase(),
  },
  identity: {
    sender,
    recipient,
    router,
    preparedUnsignedTransactionFingerprint: txFingerprint,
  },
  routeFacts: {
    tokenIn,
    tokenOut,
    pool,
  },
  tracer: {
    method: "debug_traceCall",
    name: "callTracer",
    config: { withLog: true },
    stateOverrideUsed: false,
  },
  replays: [first, second],
  replayComparison: {
    resultFingerprintStable:
      first.resultFingerprint === second.resultFingerprint,
    movementInventoryFingerprintStable:
      first.movementInventory.fingerprint ===
      second.movementInventory.fingerprint,
    tokenOutNetStable:
      JSON.stringify(first.tokenOutNet) === JSON.stringify(second.tokenOutNet),
  },
  limitations: [
    "Inventory covers movements returned by callTracer(withLog=true); it is not independent proof that the Provider returned a complete, untruncated log set.",
    "Transfer-topic movements are supplementary observations, not canonical assetChanges.",
    "Observed route movements do not establish assetChangeAssessment=EXPLAINED.",
    "This capture does not establish simulation.complete, receipt completeness, warnings completeness, Provider SUCCESS, Risk PROCEED, or VERIFIED remediation.",
    "Raw Provider payload, RPC URL, and credentials are not persisted.",
  ],
};

writeFileSync(process.argv[2], JSON.stringify(output, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output: process.argv[2],
      classification: output.classification,
      replayComparison: output.replayComparison,
      observedTransferTokenAddresses:
        first.movementInventory.observedTransferTokenAddresses,
      nativeValueMovementCount:
        first.movementInventory.nativeValueMovements.length,
      transferTopicMovementCount:
        first.movementInventory.transferTopicMovements.length,
      tokenOutNetAtomic: first.tokenOutNet.netAtomic,
    },
    null,
    2,
  ),
);
