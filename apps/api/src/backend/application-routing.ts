import type { AgentFlowPort, QuoteAgentFlowPort } from "../ports.js";
import type { RunStore } from "../store.js";
import type { BackendOperationResult } from "./composition.js";

/**
 * One chain-owned application path. The route keeps normalization, execution,
 * and quote behavior together so a request cannot accidentally use Arbitrum
 * normalization with the Monad Agent Flow (or the reverse).
 */
export type BackendApplicationRoute = {
  readonly chainId: number;
  readonly composition: {
    readonly runStore: RunStore;
    normalize(input: unknown): BackendOperationResult<unknown>;
  };
  readonly agentFlow: AgentFlowPort;
  readonly quoteFlow: QuoteAgentFlowPort;
};

export function validateBackendApplicationRoutes(
  routes: readonly BackendApplicationRoute[] | undefined,
  store: RunStore,
): void {
  if (routes === undefined) return;
  const chainIds = new Set<number>();
  for (const route of routes) {
    if (!Number.isSafeInteger(route.chainId) || route.chainId <= 0) {
      throw new TypeError("Backend application route chainId must be positive");
    }
    if (chainIds.has(route.chainId)) {
      throw new Error(
        `Backend application route for chain ${route.chainId} is duplicated`,
      );
    }
    chainIds.add(route.chainId);
    if (route.composition.runStore !== store) {
      throw new Error(
        "Backend application route must use the Backend RunStore",
      );
    }
    if (typeof route.agentFlow.check !== "function") {
      throw new TypeError(
        "Backend application route agentFlow.check is required",
      );
    }
    if (typeof route.quoteFlow.quote !== "function") {
      throw new TypeError(
        "Backend application route quoteFlow.quote is required",
      );
    }
  }
}

export function findBackendApplicationRoute(
  routes: readonly BackendApplicationRoute[] | undefined,
  chainId: number,
): BackendApplicationRoute | undefined {
  return routes?.find((route) => route.chainId === chainId);
}
