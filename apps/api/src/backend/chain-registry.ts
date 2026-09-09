import type { ChainAdapter } from "./chain-adapter.js";
import { AdapterRegistry } from "./registry-core.js";
import { ChainRegistryError } from "./registry-errors.js";

export type {
  BlockContext,
  ChainAdapter,
  ChainAdapterErrorInput,
  ChainErrorCode,
  ChainOperation,
  ChainOperationOptions,
  FinalityStatus,
  GasEstimate,
} from "./chain-adapter.js";

export {
  ChainRegistryError,
  type ChainRegistryErrorCode,
  type ChainRegistryErrorInput,
  isChainRegistryError,
} from "./registry-errors.js";

/** In-memory lookup of replaceable chain adapters by their chain ID. */
export class ChainRegistry<Adapter extends ChainAdapter = ChainAdapter> {
  private readonly adapters = new AdapterRegistry<number, Adapter>();

  public constructor(adapters: Iterable<Adapter> = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  public get size(): number {
    return this.adapters.size;
  }

  public has(chainId: number): boolean {
    if (!isChainId(chainId)) return false;
    return this.adapters.has(chainId);
  }

  /** Registers an adapter once; duplicate IDs fail closed rather than replace. */
  public register(adapter: Adapter): this {
    const chainId = readChainId(adapter);
    if (this.adapters.has(chainId)) {
      throw new ChainRegistryError({
        chainId,
        code: "DUPLICATE_CHAIN",
        message: `chain ${chainId} is already registered`,
      });
    }
    this.adapters.set(chainId, adapter);
    return this;
  }

  /** Resolves exactly the requested chain ID; no default chain is selected. */
  public resolve(chainId: number): Adapter {
    assertChainId(chainId);
    const adapter = this.adapters.get(chainId);
    if (adapter === undefined) {
      throw new ChainRegistryError({
        chainId,
        code: "UNSUPPORTED_CHAIN",
        message: `chain ${chainId} is not registered`,
      });
    }
    return adapter;
  }
}

function readChainId(adapter: ChainAdapter): number {
  if (typeof adapter !== "object" || adapter === null) {
    throw new TypeError("chain adapter must be an object");
  }
  assertChainId(adapter.chainId);
  return adapter.chainId;
}

function assertChainId(value: unknown): asserts value is number {
  if (!isChainId(value)) {
    throw new TypeError("chainId must be a non-negative safe integer");
  }
}

function isChainId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
