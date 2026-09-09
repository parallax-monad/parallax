import type { ProtocolAdapter } from "./protocol-adapter.js";
import { AdapterRegistry } from "./registry-core.js";
import { ProtocolRegistryError } from "./registry-errors.js";

export type {
  ProtocolAdapter,
  ProtocolAdapterErrorCode,
  ProtocolAdapterErrorInput,
  UnsignedTransaction,
} from "./protocol-adapter.js";

export {
  isProtocolRegistryError,
  ProtocolRegistryError,
  type ProtocolRegistryErrorCode,
  type ProtocolRegistryErrorInput,
} from "./registry-errors.js";

export type ProtocolRegistration<
  Adapter extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
> = {
  readonly chainId: number;
  readonly protocol: string;
  readonly adapter: Adapter;
};

/** In-memory lookup of replaceable protocol adapters within an exact chain. */
export class ProtocolRegistry<
  Adapter extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
> {
  private readonly adapters = new AdapterRegistry<
    number,
    Map<string, Adapter>
  >();
  private readonly chainsByProtocol = new Map<string, Set<number>>();
  private registrationCount = 0;

  public constructor(
    registrations: Iterable<ProtocolRegistration<Adapter>> = [],
  ) {
    for (const registration of registrations) {
      this.register(registration);
    }
  }

  public get size(): number {
    return this.registrationCount;
  }

  public has(chainId: number, protocol: string): boolean {
    if (!isChainId(chainId)) return false;
    const normalizedProtocol = normalizeProtocol(protocol);
    return this.adapters.get(chainId)?.has(normalizedProtocol) ?? false;
  }

  public register(registration: ProtocolRegistration<Adapter>): this;
  public register(chainId: number, protocol: string, adapter: Adapter): this;
  public register(
    registrationOrChainId: ProtocolRegistration<Adapter> | number,
    protocol?: string,
    adapter?: Adapter,
  ): this {
    let chainId: number;
    let protocolId: string;
    let registeredAdapter: Adapter;

    if (typeof registrationOrChainId === "number") {
      if (typeof protocol !== "string" || adapter === undefined) {
        throw new TypeError(
          "register requires a chainId, protocol, and adapter",
        );
      }
      chainId = registrationOrChainId;
      protocolId = protocol;
      registeredAdapter = adapter;
    } else {
      chainId = registrationOrChainId.chainId;
      protocolId = registrationOrChainId.protocol;
      registeredAdapter = registrationOrChainId.adapter;
    }

    assertChainId(chainId);
    const normalizedProtocol = normalizeProtocol(protocolId);
    assertProtocolAdapter(registeredAdapter);

    const byProtocol = this.adapters.get(chainId);
    if (byProtocol?.has(normalizedProtocol)) {
      throw new ProtocolRegistryError({
        chainId,
        protocol: normalizedProtocol,
        code: "DUPLICATE_PROTOCOL",
        message: `protocol ${normalizedProtocol} is already registered for chain ${chainId}`,
      });
    }

    const nextByProtocol = byProtocol ?? new Map<string, Adapter>();
    nextByProtocol.set(normalizedProtocol, registeredAdapter);
    if (byProtocol === undefined) {
      this.adapters.set(chainId, nextByProtocol);
    }

    const chains =
      this.chainsByProtocol.get(normalizedProtocol) ?? new Set<number>();
    chains.add(chainId);
    this.chainsByProtocol.set(normalizedProtocol, chains);
    this.registrationCount += 1;
    return this;
  }

  /** Resolves only the exact chain/protocol pair; it never falls back. */
  public resolve(chainId: number, protocol: string): Adapter {
    assertChainId(chainId);
    const normalizedProtocol = normalizeProtocol(protocol);
    const byProtocol = this.adapters.get(chainId);
    if (byProtocol === undefined) {
      throw new ProtocolRegistryError({
        chainId,
        protocol: normalizedProtocol,
        code: "UNSUPPORTED_CHAIN",
        message: `chain ${chainId} is not registered`,
      });
    }

    const adapter = byProtocol.get(normalizedProtocol);
    if (adapter !== undefined) return adapter;

    if (this.chainsByProtocol.get(normalizedProtocol)?.size) {
      throw new ProtocolRegistryError({
        chainId,
        protocol: normalizedProtocol,
        code: "CHAIN_PROTOCOL_MISMATCH",
        message: `protocol ${normalizedProtocol} is not registered for chain ${chainId}`,
      });
    }

    throw new ProtocolRegistryError({
      chainId,
      protocol: normalizedProtocol,
      code: "UNSUPPORTED_PROTOCOL",
      message: `protocol ${normalizedProtocol} is not registered`,
    });
  }
}

function assertChainId(value: unknown): asserts value is number {
  if (!isChainId(value)) {
    throw new TypeError("chainId must be a non-negative safe integer");
  }
}

function isChainId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeProtocol(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("protocol must be a non-empty string");
  }
  return value.trim();
}

function assertProtocolAdapter(
  value: unknown,
): asserts value is ProtocolAdapter {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("protocol adapter must be an object");
  }
}
