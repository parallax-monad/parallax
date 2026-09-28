import type { NormalizedSwapIntent } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { AccountStateApplicationService } from "./account-state-application.js";
import type {
  AccountStateObservation,
  AccountStateReader,
} from "./account-state-model.js";
import { InMemoryRunStore } from "./store.js";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const sender = "0x1111111111111111111111111111111111111111";
const otherSender = "0x3333333333333333333333333333333333333333";
const usdc = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const snapshotIdUpper = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const snapshotIdLower = snapshotIdUpper.toLowerCase();

const tokenRegistry = createTrustedTokenRegistry({
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: usdc,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified",
      verifiedAtBlock: "100",
    },
  ],
});

function observationForIntent(
  intent: NormalizedSwapIntent,
  senderOverride = intent.sender,
): AccountStateObservation {
  const nativeBalance = {
    account: senderOverride,
    asset: { kind: "native" as const },
    metadata: {
      symbol: "ETH",
      decimals: 18,
      decimalsSource: "chain_config" as const,
    },
    explorerUrls: {},
    status: "AVAILABLE" as const,
    amountAtomic: "0",
  };
  const outputBalance = {
    account: intent.recipient,
    asset: intent.tokenOut,
    metadata: {
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "100",
    },
    explorerUrls: {},
    status: "AVAILABLE" as const,
    amountAtomic: "0",
  };

  return {
    context: {
      chainId: intent.chainId,
      protocol: intent.protocol,
      sender: senderOverride,
      recipient: intent.recipient,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountInAtomic: intent.amountInAtomic,
    },
    block: {
      status: "VERIFIED",
      chainId: intent.chainId,
      blockNumber: "100",
      blockHash: `0x${"a".repeat(64)}`,
      observedAt: "2026-09-28T10:00:00.000Z",
    },
    balances: {
      inputToken: nativeBalance,
      outputToken: outputBalance,
      native: nativeBalance,
    },
    allowance: {
      status: "NOT_APPLICABLE",
      owner: senderOverride,
      spender: { status: "NOT_APPLICABLE" },
      reason: "NATIVE_INPUT",
      blockNumber: "100",
    },
  };
}

const request = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender,
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: usdc },
  amountIn: "0.01",
};

describe("AccountStateApplicationService", () => {
  it("persists and returns the same snapshot without re-reading RPC, canonicalizing UUIDs", async () => {
    let readCount = 0;
    const reader: AccountStateReader = {
      async readAccountState({ intent }) {
        readCount += 1;
        return observationForIntent(intent);
      },
    };
    const store = new InMemoryRunStore();
    const service = new AccountStateApplicationService({
      tokenRegistry,
      reader,
      store,
      createSnapshotId: () => snapshotIdUpper,
    });

    const created = await service.query(request);
    expect(created.status).toBe(200);
    if (created.status !== 200) throw new Error("Expected account snapshot");
    expect(created.body.snapshotId).toBe(snapshotIdLower);
    expect(created.body.status).toBe("AVAILABLE");

    const fetched = await service.getSnapshot(snapshotIdUpper);
    expect(fetched).toEqual(created);
    expect(readCount).toBe(1);
    await expect(store.getAccountState(snapshotIdUpper)).resolves.toEqual(
      created.body,
    );
  });

  it("rejects a reader response bound to a different sender before persisting it", async () => {
    const reader: AccountStateReader = {
      async readAccountState({ intent }) {
        return observationForIntent(intent, otherSender);
      },
    };
    const store = new InMemoryRunStore();
    const service = new AccountStateApplicationService({
      tokenRegistry,
      reader,
      store,
      createSnapshotId: () => snapshotIdUpper,
    });

    const response = await service.query(request);

    expect(response).toMatchObject({
      status: 503,
      body: { error: { code: "ACCOUNT_STATE_READ_ERROR" } },
    });
    await expect(
      store.getAccountState(snapshotIdLower),
    ).resolves.toBeUndefined();
  });

  it("rejects reader metadata that conflicts with the trusted token registry", async () => {
    const reader: AccountStateReader = {
      async readAccountState({ intent }) {
        const observation = observationForIntent(intent);
        return {
          ...observation,
          balances: {
            ...observation.balances,
            outputToken: {
              ...observation.balances.outputToken,
              metadata: {
                ...observation.balances.outputToken.metadata,
                decimals: 18,
              },
            },
          },
        };
      },
    };
    const store = new InMemoryRunStore();
    const service = new AccountStateApplicationService({
      tokenRegistry,
      reader,
      store,
      createSnapshotId: () => snapshotIdUpper,
    });

    const response = await service.query(request);

    expect(response).toMatchObject({
      status: 503,
      body: { error: { code: "ACCOUNT_STATE_READ_ERROR" } },
    });
    await expect(
      store.getAccountState(snapshotIdLower),
    ).resolves.toBeUndefined();
  });
});
