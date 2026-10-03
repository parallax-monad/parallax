import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  assetRouteConfigSchema,
  CAMELOT_V3_PROTOCOL_ID,
  p0ConfigSchema,
  type TrustedTokenRegistry,
} from "@parallax/contracts";
import { Hono } from "hono";
import { CAMELOT_V3_WETH_ADDRESS } from "../backend/camelot-v3-binding.js";
import { CAMELOT_SEPOLIA_USDC } from "../backend/camelot-v3-protocol-adapter.js";
import { createJsonResponse } from "../json-http.js";
import { resolveTokenMetadata } from "../token-metadata.js";
import { registerApiFallbacks } from "./api-fallbacks.js";

/** Read-only P0 configuration, independent of quote, balance and RPC availability. */
export function createP0ConfigApp(
  registry: TrustedTokenRegistry,
  routeConfigured: boolean,
  reverseRouteConfigured = false,
): Hono {
  const app = new Hono();
  app.get("/api/p0-config", (context) => {
    const pair = context.req.query("pair") ?? "eth-usdc";
    const reverse = pair === "usdc-weth";
    const configured = reverse
      ? reverseRouteConfigured
      : pair === "eth-usdc" && routeConfigured;
    let result: unknown = {
      status: "UNAVAILABLE",
      reason: "ROUTE_NOT_CONFIGURED",
    };
    if (configured) {
      try {
        result = {
          status: "AVAILABLE",
          chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
          protocol: CAMELOT_V3_PROTOCOL_ID,
          tokenMetadata: resolveTokenMetadata(registry, {
            chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
            tokenIn: reverse
              ? { kind: "erc20", address: CAMELOT_SEPOLIA_USDC }
              : { kind: "native" },
            tokenOut: {
              kind: "erc20",
              address: reverse ? CAMELOT_V3_WETH_ADDRESS : CAMELOT_SEPOLIA_USDC,
            },
          }),
        };
      } catch {
        result = {
          status: "UNAVAILABLE",
          reason: "TOKEN_METADATA_UNAVAILABLE",
        };
      }
    }
    const schema = reverse ? assetRouteConfigSchema : p0ConfigSchema;
    return createJsonResponse(schema.parse(result), 200, {
      "cache-control": "no-store",
    });
  });
  registerApiFallbacks(app, {
    methodNotAllowed: [
      {
        path: "/api/p0-config",
        method: "GET",
        message: "Only GET is supported for /api/p0-config",
      },
    ],
    internalErrorMessage: "The P0 configuration could not be loaded",
    cacheControl: "no-store",
  });
  return app;
}
