import { describe, expect, it } from "vitest";

import {
  normalizeRecipientTokenOutTransfers,
  TRANSFER_TOPIC,
  ZERO_ADDRESS,
} from "./verified-remediation-trace-event-normalization.mjs";

const TOKEN = "0xb893e3334d4bd6c5ba8277fd559e99ed683a9fc7";
const RECIPIENT = "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396";
const OTHER = "0x3965361ea4f9000ae3cf995f553115b2832d0e2d";

function topic(address) {
  return "0x" + address.slice(2).padStart(64, "0");
}

function transfer(from, to, amount) {
  return {
    address: TOKEN,
    topics: [TRANSFER_TOPIC, topic(from), topic(to)],
    data: "0x" + BigInt(amount).toString(16),
  };
}

function normalize(trace) {
  return normalizeRecipientTokenOutTransfers({
    trace,
    tokenOut: TOKEN,
    recipient: RECIPIENT,
  });
}
describe("BE-107 trace event net normalization", () => {
  it("aggregates all successful recipient inflows and outflows", () => {
    const result = normalize({
      logs: [transfer(OTHER, RECIPIENT, 10n), transfer(OTHER, RECIPIENT, 5n)],
      calls: [{ logs: [transfer(RECIPIENT, OTHER, 3n)] }],
    });

    expect(result).toMatchObject({
      qualificationUsable: true,
      failClosedReasons: [],
      normalized: {
        incomingAtomic: "15",
        outgoingAtomic: "3",
        netAtomic: "12",
      },
    });
  });

  it("treats recipient self-transfer as net zero", () => {
    const result = normalize({
      logs: [transfer(RECIPIENT, RECIPIENT, 99n)],
    });

    expect(result.qualificationUsable).toBe(true);
    expect(result.normalized).toMatchObject({
      incomingAtomic: "0",
      outgoingAtomic: "0",
      netAtomic: "0",
    });
    expect(result.normalized.events[0]).toMatchObject({ selfTransfer: true });
  });

  it("counts mint to recipient as incoming", () => {
    const result = normalize({
      logs: [transfer(ZERO_ADDRESS, RECIPIENT, 7n)],
    });

    expect(result.normalized.netAtomic).toBe("7");
    expect(result.normalized.events[0]).toMatchObject({ mint: true });
  });

  it("counts burn from recipient as outgoing", () => {
    const result = normalize({
      logs: [transfer(RECIPIENT, ZERO_ADDRESS, 4n)],
    });

    expect(result.normalized).toMatchObject({
      incomingAtomic: "0",
      outgoingAtomic: "4",
      netAtomic: "-4",
    });
    expect(result.normalized.events[0]).toMatchObject({ burn: true });
  });

  it("fails closed when a relevant Transfer is under reverted ancestry", () => {
    const result = normalize({
      calls: [
        {
          error: "execution reverted",
          logs: [transfer(OTHER, RECIPIENT, 10n)],
        },
      ],
    });

    expect(result.qualificationUsable).toBe(false);
    expect(result.failClosedReasons).toContain(
      "RELEVANT_TRANSFER_REVERTED_ANCESTRY",
    );
    expect(result.normalized.netAtomic).toBe("0");
    expect(result.normalized.events[0]).toMatchObject({
      successfulAncestry: false,
    });
  });

  it("fails closed when the top-level trace reverted", () => {
    const result = normalize({
      error: "execution reverted",
      logs: [],
    });

    expect(result.qualificationUsable).toBe(false);
    expect(result.failClosedReasons).toContain("TOP_LEVEL_REVERTED");
  });

  it("fails closed on malformed relevant Transfer topics", () => {
    const result = normalize({
      logs: [
        {
          address: TOKEN,
          topics: [TRANSFER_TOPIC, topic(OTHER)],
          data: "0x1",
        },
      ],
    });

    expect(result.qualificationUsable).toBe(false);
    expect(result.failClosedReasons).toContain("MALFORMED_TRACE_STRUCTURE");
    expect(result.malformedPaths).toEqual(["0.log0.transfer"]);
  });

  it("fails closed on malformed relevant Transfer amount", () => {
    const result = normalize({
      logs: [
        {
          address: TOKEN,
          topics: [TRANSFER_TOPIC, topic(OTHER), topic(RECIPIENT)],
          data: "not-hex",
        },
      ],
    });

    expect(result.qualificationUsable).toBe(false);
    expect(result.failClosedReasons).toContain("MALFORMED_TRACE_STRUCTURE");
  });
  it("does not mistake another token's Transfer for tokenOut evidence", () => {
    const otherToken = {
      ...transfer(OTHER, RECIPIENT, 10n),
      address: "0x1111111111111111111111111111111111111111",
    };
    const result = normalize({ logs: [otherToken] });

    expect(result.qualificationUsable).toBe(true);
    expect(result.relevantTokenOutTransferCount).toBe(0);
    expect(result.normalized.netAtomic).toBe("0");
  });

  it("preserves identical-payload transfers as distinct events by path", () => {
    const identical = transfer(OTHER, RECIPIENT, 5n);
    const result = normalize({
      logs: [identical],
      calls: [{ logs: [{ ...identical }] }],
    });

    expect(result.normalized.netAtomic).toBe("10");
    expect(result.normalized.events.map((event) => event.path)).toEqual([
      "0.log0",
      "0.0.log0",
    ]);
  });

  it("fails closed when trace structure is malformed", () => {
    const result = normalize({
      logs: [],
      calls: { not: "an array" },
    });

    expect(result.qualificationUsable).toBe(false);
    expect(result.failClosedReasons).toContain("MALFORMED_TRACE_STRUCTURE");
    expect(result.malformedPaths).toEqual(["0.calls"]);
  });
});

describe("BE-107 returned-trace movement inventory", () => {
  it("records native call-value edges and transfer-topic movements", async () => {
    const { inventoryReturnedTraceMovements } = await import(
      "./verified-remediation-trace-event-normalization.mjs"
    );
    const result = inventoryReturnedTraceMovements({
      trace: {
        from: RECIPIENT,
        to: OTHER,
        value: "0x10",
        logs: [transfer(OTHER, RECIPIENT, 5n)],
        calls: [
          {
            from: OTHER,
            to: TOKEN,
            value: "0x0",
            logs: [transfer(RECIPIENT, OTHER, 2n)],
          },
        ],
      },
    });

    expect(result.returnedTraceInventoryUsable).toBe(true);
    expect(result.nativeValueMovements).toHaveLength(1);
    expect(result.nativeValueMovements[0]).toMatchObject({
      from: RECIPIENT,
      to: OTHER,
      amountAtomic: "16",
      successfulAncestry: true,
    });
    expect(result.transferTopicMovements).toHaveLength(2);
    expect(result.observedTransferTokenAddresses).toEqual([TOKEN]);
  });

  it("preserves reverted movements but marks their ancestry", async () => {
    const { inventoryReturnedTraceMovements } = await import(
      "./verified-remediation-trace-event-normalization.mjs"
    );
    const result = inventoryReturnedTraceMovements({
      trace: {
        calls: [
          {
            from: OTHER,
            to: TOKEN,
            value: "0x1",
            error: "execution reverted",
            logs: [transfer(OTHER, RECIPIENT, 4n)],
          },
        ],
      },
    });

    expect(result.returnedTraceInventoryUsable).toBe(true);
    expect(result.nativeValueMovements[0].successfulAncestry).toBe(false);
    expect(result.transferTopicMovements[0].successfulAncestry).toBe(false);
  });

  it("fails closed on malformed value-bearing movement", async () => {
    const { inventoryReturnedTraceMovements } = await import(
      "./verified-remediation-trace-event-normalization.mjs"
    );
    const result = inventoryReturnedTraceMovements({
      trace: {
        from: RECIPIENT,
        to: "not-an-address",
        value: "0x10",
      },
    });

    expect(result.returnedTraceInventoryUsable).toBe(false);
    expect(result.failClosedReasons).toContain("MALFORMED_TRACE_STRUCTURE");
    expect(result.malformedPaths).toContain("0.nativeValueAddress");
  });
});
