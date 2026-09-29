import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AccountStateCard } from "@/components/analyze/AccountStateCard";
import { DEFAULT_SENDER, fetchAccountState } from "@/lib/analyze/service";
import type {
  AccountAllowance,
  AccountStateState,
  AccountStateView,
} from "@/lib/analyze/types";

const blockHash = `0x${"a".repeat(64)}`;
const observedAt = "2026-10-01T00:00:03.000Z";
const spender = "0x3333333333333333333333333333333333333333";
const qualifiedSpender = {
  status: "QUALIFIED" as const,
  address: spender,
  qualificationRef: "camelot-v3-qualified-spender",
};

const baseView: AccountStateView = {
  status: "AVAILABLE",
  decimalsBySymbol: { USDC: 18, WETH: 18 },
  inputToken: {
    status: "AVAILABLE",
    symbol: "USDC",
    decimals: 18,
    decimalsSource: "onchain_verified",
    amountAtomic: "2500000000000000000",
  },
  outputToken: {
    status: "AVAILABLE",
    symbol: "WETH",
    decimals: 18,
    decimalsSource: "onchain_verified",
    amountAtomic: "0",
  },
  allowance: {
    status: "SUFFICIENT",
    allowanceAtomic: "5000000000000000000",
    requiredAmountAtomic: "10000000000000000",
    spender: qualifiedSpender,
    blockNumber: "313622358",
  },
  block: {
    status: "VERIFIED",
    chainId: 421614,
    blockNumber: "313622358",
    blockHash,
    observedAt,
  },
};

const render = (state: AccountStateState) =>
  renderToStaticMarkup(<AccountStateCard accountState={state} language="en" />);

const withAllowance = (allowance: AccountAllowance): AccountStateState => ({
  status: "available",
  view: { ...baseView, allowance },
});

describe("AccountStateCard allowance states", () => {
  test("renders a qualified SUFFICIENT allowance with the spender and block binding", () => {
    const html = render({ status: "available", view: baseView });

    expect(html).toContain("SUFFICIENT");
    expect(html).toContain("Sufficient");
    // Trusted 18 decimals: 2.5e18 is 2.5, not a 6-decimal mis-scale.
    expect(html).toContain("2.5 USDC");
    expect(html).toContain(spender);
    expect(html).toContain("313622358");
    expect(html).toContain(blockHash);
    expect(html).toContain(observedAt);
    expect(html).toContain("AVAILABLE");
  });

  test("renders a qualified INSUFFICIENT allowance", () => {
    const html = render(
      withAllowance({
        status: "INSUFFICIENT",
        allowanceAtomic: "0",
        requiredAmountAtomic: "10000000000000000",
        spender: qualifiedSpender,
        blockNumber: "313622358",
      }),
    );

    expect(html).toContain("INSUFFICIENT");
    expect(html).toContain("Insufficient");
    expect(html).toContain(spender);
  });

  test("renders an UNAVAILABLE allowance with its reason and no invented number", () => {
    const html = render(
      withAllowance({
        status: "UNAVAILABLE",
        reason: "RPC_UNAVAILABLE",
        requiredAmountAtomic: "10000000000000000",
        spender: { status: "UNAVAILABLE", reason: "SPENDER_NOT_QUALIFIED" },
      }),
    );

    expect(html).toContain("UNAVAILABLE");
    expect(html).toContain("Unavailable");
    expect(html).toContain("The chain read was unavailable.");
    expect(html).not.toContain("Sufficient");
  });

  test("renders NOT_APPLICABLE for a native input without a spender", () => {
    const html = render(
      withAllowance({ status: "NOT_APPLICABLE", reason: "NATIVE_INPUT" }),
    );

    expect(html).toContain("NOT_APPLICABLE");
    expect(html).toContain("Not applicable");
    expect(html).not.toContain(spender);
  });

  test("fails closed when the account-state read is unavailable", () => {
    const html = render({
      status: "unavailable",
      reason: "SNAPSHOT_UNAVAILABLE",
    });

    expect(html).toContain("unavailable");
    // No fabricated balance or scale is shown for an unknown snapshot.
    expect(html).not.toContain("USDC");
    expect(html).not.toContain("Sufficient");
  });
});

describe("AccountStateCard provider payload guard", () => {
  test("never renders a raw Provider payload copied into the snapshot", async () => {
    const snapshot = {
      snapshotId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      status: "AVAILABLE",
      context: {
        chainId: 421614,
        protocol: "camelot-v3",
        sender: DEFAULT_SENDER,
        recipient: DEFAULT_SENDER,
        tokenIn: { kind: "erc20", address: "0xb893" },
        tokenOut: { kind: "erc20", address: "0x980b" },
        amountInAtomic: "10000000000000000",
      },
      block: baseView.block,
      balances: {
        inputToken: {
          status: "AVAILABLE",
          account: DEFAULT_SENDER,
          asset: { kind: "erc20", address: "0xb893" },
          metadata: {
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified",
            verifiedAtBlock: "313622300",
          },
          explorerUrls: {},
          amountAtomic: "2500000000000000000",
        },
        outputToken: {
          status: "AVAILABLE",
          account: DEFAULT_SENDER,
          asset: { kind: "erc20", address: "0x980b" },
          metadata: {
            symbol: "WETH",
            decimals: 18,
            decimalsSource: "onchain_verified",
            verifiedAtBlock: "313622300",
          },
          explorerUrls: {},
          amountAtomic: "0",
        },
        native: {
          status: "AVAILABLE",
          account: DEFAULT_SENDER,
          asset: { kind: "native" },
          metadata: {
            symbol: "ETH",
            decimals: 18,
            decimalsSource: "chain_config",
          },
          explorerUrls: {},
          amountAtomic: "0",
        },
      },
      allowance: baseView.allowance,
      providerEvidence: {
        providerData: { rawPayload: "DO_NOT_RENDER_RAW_RPC" },
      },
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const state = await fetchAccountState(
      {
        protocol: "camelot-v3",
        tokenIn: "USDC",
        tokenOut: "WETH",
        amountIn: "0.01",
      },
      { fetch: request },
    );
    const html = render(state);

    expect(state.status).toBe("available");
    expect(JSON.stringify(state)).not.toContain("DO_NOT_RENDER_RAW_RPC");
    expect(html).not.toContain("DO_NOT_RENDER_RAW_RPC");
    expect(html).toContain("SUFFICIENT");
  });
});
