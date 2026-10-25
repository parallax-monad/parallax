import { createHash } from "node:crypto";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import type { ArbitrumOneTransactionPayload } from "./arbitrum-one-transaction.js";

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RPC_QUANTITY_PATTERN = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const STORAGE_WORD_PATTERN = /^0x[0-9a-f]{64}$/i;
const DATA_PATTERN = /^0x(?:[0-9a-f]{2})*$/i;
const BALANCE_OF_SELECTOR = "0x70a08231";
const MAX_STATE_DUMP_BYTES = 16 * 1024 * 1024;
const MAX_UINT256 = (1n << 256n) - 1n;

const UNKNOWN_STATE_REVISION = Object.freeze({
  status: "UNKNOWN",
  reason: "NO_QUALIFIED_ANVIL_STATE_REVISION_TOKEN",
} as const);

export type AnvilStateRevision =
  | {
      readonly status: "AVAILABLE";
      readonly method: "ANVIL_DUMP_STATE";
      readonly fingerprint: string;
    }
  | typeof UNKNOWN_STATE_REVISION;

export type StateDiffAmountReceived =
  | {
      readonly status: "AVAILABLE";
      readonly amountReceivedAtomic: string;
      readonly source: "VALIDATED_STATE_DIFF";
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: "STATE_DIFF_NOT_QUALIFIED";
    };

export interface AnvilStateRevisionContext {
  readonly forkInstanceId: string;
  readonly chainId: number;
  readonly blockNumber: string;
  readonly blockHash: string;
}

/**
 * Build the non-signing RPC call object for the prepared unsigned transaction.
 * The Arbitrum chainId is verified, then omitted because the local Anvil runs
 * on 31337 and rejects chainId=42161 on eth_call/trace RPC parameters. The EVM
 * execution fields are preserved byte-for-byte; this helper never signs or
 * submits a transaction.
 */
export function createArbitrumOneExecutionCall(
  transaction: ArbitrumOneTransactionPayload,
): Omit<ArbitrumOneTransactionPayload, "chainId"> {
  if (
    Object.keys(transaction).sort().join(",") !==
      "chainId,data,from,to,value" ||
    transaction.chainId.toLowerCase() !== "0xa4b1" ||
    !ADDRESS_PATTERN.test(transaction.from) ||
    !ADDRESS_PATTERN.test(transaction.to) ||
    !DATA_PATTERN.test(transaction.data) ||
    typeof transaction.value !== "string" ||
    !RPC_QUANTITY_PATTERN.test(transaction.value)
  ) {
    throw new Error("Prepared transaction is not a valid Arbitrum One call");
  }

  return Object.freeze({
    from: transaction.from,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  });
}

/**
 * Hash Foundry's complete Anvil state buffer and bind it to the verified local
 * fork identity and pinned base block. The raw dump is deliberately discarded.
 */
export function fingerprintAnvilStateDump(
  dump: unknown,
  context: AnvilStateRevisionContext,
): AnvilStateRevision {
  if (
    typeof dump !== "string" ||
    !/^0x(?:[0-9a-f]{2})*$/i.test(dump) ||
    (dump.length - 2) / 2 > MAX_STATE_DUMP_BYTES ||
    !UUID_V4_PATTERN.test(context.forkInstanceId) ||
    context.chainId !== 31_337 ||
    !/^(0|[1-9][0-9]*)$/.test(context.blockNumber) ||
    !HASH_PATTERN.test(context.blockHash)
  ) {
    return UNKNOWN_STATE_REVISION;
  }

  const dumpFingerprint = createHash("sha256")
    .update(Buffer.from(dump.slice(2), "hex"))
    .digest("hex");
  const revisionBinding = JSON.stringify({
    schemaVersion: 1,
    forkInstanceId: context.forkInstanceId.toLowerCase(),
    chainId: context.chainId,
    blockNumber: context.blockNumber,
    blockHash: context.blockHash.toLowerCase(),
    dumpFingerprint,
  });
  const fingerprint = createHash("sha256")
    .update("parallax-anvil-state-revision-v1\0")
    .update(revisionBinding)
    .digest("hex");

  return {
    status: "AVAILABLE",
    method: "ANVIL_DUMP_STATE",
    fingerprint: `sha256:${fingerprint}`,
  };
}

export async function readAnvilStateRevision(
  rpc: ArbitrumRpcClient,
  context: AnvilStateRevisionContext,
): Promise<AnvilStateRevision> {
  try {
    return fingerprintAnvilStateDump(
      await rpc.request("anvil_dumpState", []),
      context,
    );
  } catch {
    return UNKNOWN_STATE_REVISION;
  }
}

/**
 * Turn an Anvil prestateTracer diff into a recipient balance delta only when a
 * single changed USDC slot is proven to be this recipient's balanceOf slot by
 * direct storage reads and two non-persistent state-override balanceOf calls.
 */
export async function qualifyArbitrumOneRecipientBalanceDelta(input: {
  readonly rpc: ArbitrumRpcClient;
  readonly trace: unknown;
  readonly tokenAddress: string;
  readonly recipient: string;
  readonly balanceBeforeAtomic: string;
}): Promise<StateDiffAmountReceived> {
  const unavailable: StateDiffAmountReceived = {
    status: "UNAVAILABLE",
    reason: "STATE_DIFF_NOT_QUALIFIED",
  };
  if (
    !ADDRESS_PATTERN.test(input.tokenAddress) ||
    !ADDRESS_PATTERN.test(input.recipient) ||
    !/^(0|[1-9][0-9]*)$/.test(input.balanceBeforeAtomic)
  ) {
    return unavailable;
  }

  const trace = asRecord(input.trace);
  if (
    trace === undefined ||
    Object.keys(trace).sort().join(",") !== "post,pre"
  ) {
    return unavailable;
  }
  const preAccounts = asRecord(trace.pre);
  const postAccounts = asRecord(trace.post);
  if (preAccounts === undefined || postAccounts === undefined) {
    return unavailable;
  }
  const pre = findAccount(preAccounts, input.tokenAddress);
  const post = findAccount(postAccounts, input.tokenAddress);
  if (pre === undefined || post === undefined) return unavailable;

  const preStorage = asRecord(pre.storage);
  const postStorage = asRecord(post.storage);
  if (
    preStorage === undefined ||
    postStorage === undefined ||
    !tokenAccountMetadataIsStable(pre, post)
  ) {
    return unavailable;
  }
  const beforeBalance = BigInt(input.balanceBeforeAtomic);
  if (beforeBalance >= MAX_UINT256) return unavailable;

  const preSlots = parseStorage(preStorage);
  const postSlots = parseStorage(postStorage);
  if (preSlots === undefined || postSlots === undefined) return unavailable;
  const slotKeys = new Set([...preSlots.keys(), ...postSlots.keys()]);
  const candidates: bigint[] = [];

  for (const slot of slotKeys) {
    const before = preSlots.get(slot) ?? 0n;
    const after = postSlots.get(slot) ?? 0n;
    if (before === after) continue;

    let observedBefore: unknown;
    try {
      observedBefore = await input.rpc.request("eth_getStorageAt", [
        input.tokenAddress,
        slot,
        "latest",
      ]);
    } catch {
      return unavailable;
    }
    const observedBeforeValue = parseStorageWord(observedBefore);
    if (observedBeforeValue === undefined || observedBeforeValue !== before) {
      return unavailable;
    }

    let incrementedBalance: bigint | undefined;
    try {
      incrementedBalance = await readBalanceWithSlotOverride(
        input.rpc,
        input.tokenAddress,
        input.recipient,
        slot,
        before + 1n,
      );
    } catch {
      return unavailable;
    }
    if (
      incrementedBalance !== beforeBalance + 1n ||
      before !== beforeBalance ||
      after <= before
    ) {
      continue;
    }

    let postBalance: bigint | undefined;
    try {
      postBalance = await readBalanceWithSlotOverride(
        input.rpc,
        input.tokenAddress,
        input.recipient,
        slot,
        after,
      );
    } catch {
      return unavailable;
    }
    if (postBalance !== after) return unavailable;
    candidates.push(after - before);
  }

  if (candidates.length !== 1 || candidates[0] === undefined) {
    return unavailable;
  }
  return {
    status: "AVAILABLE",
    amountReceivedAtomic: candidates[0].toString(),
    source: "VALIDATED_STATE_DIFF",
  };
}

async function readBalanceWithSlotOverride(
  rpc: ArbitrumRpcClient,
  tokenAddress: string,
  recipient: string,
  slot: string,
  value: bigint,
): Promise<bigint | undefined> {
  const addressWord = recipient.slice(2).toLowerCase().padStart(64, "0");
  const result = await rpc.request("eth_call", [
    {
      to: tokenAddress,
      data: `${BALANCE_OF_SELECTOR}${addressWord}`,
    },
    "latest",
    {
      [tokenAddress]: {
        stateDiff: {
          [slot]: toStorageWord(value),
        },
      },
    },
  ]);
  return parseStorageWord(result);
}

function tokenAccountMetadataIsStable(
  pre: Record<string, unknown>,
  post: Record<string, unknown>,
): boolean {
  const allowedKeys = new Set(["balance", "code", "nonce", "storage"]);
  if (
    !Object.keys(pre).every((key) => allowedKeys.has(key)) ||
    !Object.keys(post).every((key) => allowedKeys.has(key))
  ) {
    return false;
  }
  if (typeof pre.code !== "string" || !DATA_PATTERN.test(pre.code)) {
    return false;
  }
  if (pre.code === "0x") return false;
  for (const key of ["balance", "code", "nonce"] as const) {
    if (post[key] !== undefined && !sameAccountValue(pre[key], post[key])) {
      return false;
    }
  }
  return true;
}

function sameAccountValue(first: unknown, second: unknown): boolean {
  if (typeof first === "string" && typeof second === "string") {
    return first.toLowerCase() === second.toLowerCase();
  }
  return first === second;
}

function findAccount(
  accounts: Record<string, unknown>,
  target: string,
): Record<string, unknown> | undefined {
  let match: Record<string, unknown> | undefined;
  const seen = new Set<string>();
  for (const [address, value] of Object.entries(accounts)) {
    if (!ADDRESS_PATTERN.test(address)) return undefined;
    const normalized = address.toLowerCase();
    if (seen.has(normalized)) return undefined;
    seen.add(normalized);
    if (normalized !== target.toLowerCase()) continue;
    match = asRecord(value);
    if (match === undefined) return undefined;
  }
  return match;
}

function parseStorage(
  storage: Record<string, unknown>,
): Map<string, bigint> | undefined {
  const result = new Map<string, bigint>();
  for (const [slot, value] of Object.entries(storage)) {
    if (!STORAGE_WORD_PATTERN.test(slot)) return undefined;
    const normalizedSlot = slot.toLowerCase();
    if (result.has(normalizedSlot)) return undefined;
    const parsedValue = parseStorageWord(value);
    if (parsedValue === undefined) return undefined;
    result.set(normalizedSlot, parsedValue);
  }
  return result;
}

function parseStorageWord(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !STORAGE_WORD_PATTERN.test(value)) {
    return undefined;
  }
  return BigInt(value);
}

function toStorageWord(value: bigint): string {
  if (value < 0n || value > MAX_UINT256) {
    throw new RangeError("Anvil state override value is outside uint256");
  }
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
