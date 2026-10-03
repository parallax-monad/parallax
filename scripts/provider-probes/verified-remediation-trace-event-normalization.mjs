const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function topicAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    return null;
  return ("0x" + value.slice(-40)).toLowerCase();
}

function parseAmount(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
function childFrames(frame, path, malformed) {
  if (frame.calls === undefined) return [];
  if (!Array.isArray(frame.calls)) {
    malformed.push(path + ".calls");
    return [];
  }
  return frame.calls;
}

function frameLogs(frame, path, malformed) {
  if (frame.logs === undefined) return [];
  if (!Array.isArray(frame.logs)) {
    malformed.push(path + ".logs");
    return [];
  }
  return frame.logs;
}

export function normalizeRecipientTokenOutTransfers({
  trace,
  tokenOut,
  recipient,
}) {
  const normalizedTokenOut = normalizeAddress(tokenOut);
  const normalizedRecipient = normalizeAddress(recipient);
  if (!trace || typeof trace !== "object" || Array.isArray(trace))
    throw new Error("trace must be an object");
  if (!normalizedTokenOut) throw new Error("tokenOut must be a valid address");
  if (!normalizedRecipient)
    throw new Error("recipient must be a valid address");

  const malformed = [];
  const events = [];
  let totalTraceLogCount = 0;
  let anyErroredAncestorForRelevantLog = false;

  function walk(frame, path = "0", ancestorErrored = false) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      malformed.push(path);
      return;
    }

    const errored =
      ancestorErrored || Boolean(frame.error) || Boolean(frame.revertReason);
    const logs = frameLogs(frame, path, malformed);
    totalTraceLogCount += logs.length;

    for (let index = 0; index < logs.length; index++) {
      const log = logs[index];
      if (!log || typeof log !== "object" || Array.isArray(log)) {
        malformed.push(path + ".log" + index);
        continue;
      }

      const address = normalizeAddress(log.address);
      if (address !== normalizedTokenOut) continue;
      if (!Array.isArray(log.topics)) {
        malformed.push(path + ".log" + index + ".topics");
        continue;
      }
      const topic0 =
        typeof log.topics[0] === "string" ? log.topics[0].toLowerCase() : "";
      if (topic0 !== TRANSFER_TOPIC) continue;

      const from = topicAddress(log.topics[1]);
      const to = topicAddress(log.topics[2]);
      const amount = parseAmount(log.data);
      const malformedTransfer =
        log.topics.length !== 3 ||
        from === null ||
        to === null ||
        amount === null;
      if (malformedTransfer) {
        malformed.push(path + ".log" + index + ".transfer");
        continue;
      }

      if (errored) anyErroredAncestorForRelevantLog = true;
      events.push({
        path: path + ".log" + index,
        from,
        to,
        amount: amount.toString(),
        successfulAncestry: !errored,
        mint: from === ZERO_ADDRESS,
        burn: to === ZERO_ADDRESS,
        selfTransfer: from === to,
      });
    }

    const calls = childFrames(frame, path, malformed);
    for (let index = 0; index < calls.length; index++)
      walk(calls[index], path + "." + index, errored);
  }

  walk(trace);
  const topLevelSucceeded = !trace.error && !trace.revertReason;
  const successfulEvents = events.filter((event) => event.successfulAncestry);
  let incoming = 0n;
  let outgoing = 0n;

  for (const event of successfulEvents) {
    const amount = BigInt(event.amount);
    if (event.to === normalizedRecipient && event.from !== normalizedRecipient)
      incoming += amount;
    if (event.from === normalizedRecipient && event.to !== normalizedRecipient)
      outgoing += amount;
  }

  const failClosedReasons = [];
  if (!topLevelSucceeded) failClosedReasons.push("TOP_LEVEL_REVERTED");
  if (anyErroredAncestorForRelevantLog)
    failClosedReasons.push("RELEVANT_TRANSFER_REVERTED_ANCESTRY");
  if (malformed.length > 0) failClosedReasons.push("MALFORMED_TRACE_STRUCTURE");

  return {
    topLevelSucceeded,
    totalTraceLogCount,
    relevantTokenOutTransferCount: events.length,
    anyErroredAncestorForRelevantLog,
    malformedPaths: malformed,
    qualificationUsable: failClosedReasons.length === 0,
    failClosedReasons,
    normalized: {
      recipient: normalizedRecipient,
      tokenOut: normalizedTokenOut,
      incomingAtomic: incoming.toString(),
      outgoingAtomic: outgoing.toString(),
      netAtomic: (incoming - outgoing).toString(),
      events,
    },
  };
}

export { TRANSFER_TOPIC, ZERO_ADDRESS };

function parseQuantity(value) {
  if (value === undefined || value === null) return 0n;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function inventoryReturnedTraceMovements({ trace }) {
  if (!trace || typeof trace !== "object" || Array.isArray(trace))
    throw new Error("trace must be an object");

  const malformed = [];
  const nativeValueMovements = [];
  const transferTopicMovements = [];
  let totalTraceLogCount = 0;

  function walk(frame, path = "0", ancestorErrored = false) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      malformed.push(path);
      return;
    }
    const errored =
      ancestorErrored || Boolean(frame.error) || Boolean(frame.revertReason);
    const from = normalizeAddress(frame.from);
    const to = normalizeAddress(frame.to);
    const value = parseQuantity(frame.value);

    if (value === null) malformed.push(path + ".value");
    if (value !== null && value > 0n) {
      if (!from || !to) malformed.push(path + ".nativeValueAddress");
      else {
        nativeValueMovements.push({
          path,
          from,
          to,
          amountAtomic: value.toString(),
          successfulAncestry: !errored,
          callType: typeof frame.type === "string" ? frame.type : null,
        });
      }
    }

    const logs = frameLogs(frame, path, malformed);
    totalTraceLogCount += logs.length;
    for (let index = 0; index < logs.length; index++) {
      const log = logs[index];
      if (!log || typeof log !== "object" || Array.isArray(log)) {
        malformed.push(path + ".log" + index);
        continue;
      }
      if (!Array.isArray(log.topics)) continue;
      const topic0 =
        typeof log.topics[0] === "string" ? log.topics[0].toLowerCase() : "";
      if (topic0 !== TRANSFER_TOPIC) continue;

      const token = normalizeAddress(log.address);
      const transferFrom = topicAddress(log.topics[1]);
      const transferTo = topicAddress(log.topics[2]);
      const amount = parseAmount(log.data);
      if (
        log.topics.length !== 3 ||
        token === null ||
        transferFrom === null ||
        transferTo === null ||
        amount === null
      ) {
        malformed.push(path + ".log" + index + ".transfer");
        continue;
      }
      transferTopicMovements.push({
        path: path + ".log" + index,
        token,
        from: transferFrom,
        to: transferTo,
        amountAtomic: amount.toString(),
        successfulAncestry: !errored,
        mint: transferFrom === ZERO_ADDRESS,
        burn: transferTo === ZERO_ADDRESS,
        selfTransfer: transferFrom === transferTo,
      });
    }

    const calls = childFrames(frame, path, malformed);
    for (let index = 0; index < calls.length; index++)
      walk(calls[index], path + "." + index, errored);
  }

  walk(trace);

  const topLevelSucceeded = !trace.error && !trace.revertReason;
  const failClosedReasons = [];
  if (!topLevelSucceeded) failClosedReasons.push("TOP_LEVEL_REVERTED");
  if (malformed.length > 0) failClosedReasons.push("MALFORMED_TRACE_STRUCTURE");
  return {
    topLevelSucceeded,
    returnedTraceInventoryUsable: failClosedReasons.length === 0,
    failClosedReasons,
    malformedPaths: malformed,
    totalTraceLogCount,
    nativeValueMovements,
    transferTopicMovements,
    observedTransferTokenAddresses: [
      ...new Set(transferTopicMovements.map((item) => item.token)),
    ].sort(),
  };
}
