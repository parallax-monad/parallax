/** #108 research templates only. No transport, Backend interface or qualification. */
export const EXPLORER_CAPABILITY_DESCRIPTORS = [
  {
    capability: "contract-verification",
    request: { module: "contract", action: "getsourcecode" },
  },
  {
    capability: "contract-abi",
    request: { module: "contract", action: "getabi" },
  },
  {
    capability: "deployment",
    request: { module: "contract", action: "getcontractcreation" },
  },
  // getToken is the historical Blockscout-compatible template, not V2 tokeninfo.
  {
    capability: "token-metadata",
    request: { module: "token", action: "getToken" },
  },
  {
    capability: "transaction",
    request: { module: "proxy", action: "eth_getTransactionByHash" },
  },
  {
    capability: "receipt",
    request: { module: "proxy", action: "eth_getTransactionReceipt" },
  },
  { capability: "logs", request: { module: "logs", action: "getLogs" } },
  {
    capability: "token-transfers",
    request: { module: "account", action: "tokentx" },
  },
  {
    capability: "provenance",
    request: { module: "block", action: "getblocknobytime" },
  },
] as const;

export type ExplorerProbeCapability =
  (typeof EXPLORER_CAPABILITY_DESCRIPTORS)[number]["capability"];

/** Excluded from this feasibility scope; no claim about every Explorer product. */
export const EXPLORER_UNSUPPORTED_CAPABILITIES = [
  "simulation",
  "trace",
  "state-diff",
] as const;
