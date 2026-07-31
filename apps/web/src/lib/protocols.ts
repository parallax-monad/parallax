import type { ProtocolProfile } from "./types";

const mon = {
  address: "0x0000000000000000000000000000000000000001",
  symbol: "MON",
  decimals: 18,
};
const usdc = {
  address: "0x0000000000000000000000000000000000000002",
  symbol: "USDC",
  decimals: 6,
};

const swapOperation = {
  id: "swap-mon-usdc",
  action: "swap" as const,
  label: "Swap MON → USDC",
  tokenIn: mon,
  tokenOut: usdc,
  defaultAmount: "100",
  slippageToleranceBps: 50,
};

export const PROTOCOL_PROFILES: ProtocolProfile[] = [
  {
    id: "kuru",
    name: "Kuru",
    category: "Orderbook DEX",
    maturity: "established",
    contracts: [
      { label: "Router", address: "0x00000000000000000000000000000000000000a1" },
    ],
    operations: [swapOperation],
    auditCount: 2,
    topAuditor: true,
    daysLive: 420,
    upgradeable: false,
    timelockHours: 0,
    adminControl: "5/8 multisig",
    oracleProvider: "Market orderbook",
    oracleRedundancy: 2,
    pastExploitLossUsd: 0,
    openSourceVerified: true,
    notes: "Demo profile; replace with verified research before production.",
  },
  {
    id: "pancakeswap",
    name: "PancakeSwap",
    category: "AMM DEX",
    maturity: "established",
    contracts: [
      { label: "Router", address: "0x00000000000000000000000000000000000000b2" },
    ],
    operations: [swapOperation],
    auditCount: 4,
    topAuditor: true,
    daysLive: 1800,
    upgradeable: true,
    timelockHours: 48,
    adminControl: "4/7 multisig",
    oracleProvider: "Pool TWAP",
    oracleRedundancy: 2,
    pastExploitLossUsd: 0,
    openSourceVerified: true,
    notes: "Demo profile; replace with verified research before production.",
  },
];

export function findProfile(id: string) {
  return PROTOCOL_PROFILES.find((profile) => profile.id === id);
}

export function findOperation(profile: ProtocolProfile, action: string) {
  return profile.operations.find((operation) => operation.action === action);
}
