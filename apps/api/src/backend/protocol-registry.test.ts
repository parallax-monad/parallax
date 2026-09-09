import { describe, expect, it } from "vitest";
import { isBackendControlError } from "./control-boundary.js";
import {
  isProtocolRegistryError,
  type ProtocolAdapter,
  ProtocolRegistry,
  ProtocolRegistryError,
} from "./protocol-registry.js";

type FakeIntent = { readonly request: string };
type FakeQuote = { readonly amountOut: string };
type FakeTransaction = { readonly data: string };

function fakeProtocolAdapter(): ProtocolAdapter<
  FakeIntent,
  FakeQuote,
  FakeTransaction
> {
  return {
    async quote(_intent: FakeIntent): Promise<FakeQuote> {
      return { amountOut: "42" };
    },
    async buildTransaction(
      _intent: FakeIntent,
    ): Promise<{ kind: "unsigned"; payload: FakeTransaction }> {
      return { kind: "unsigned", payload: { data: "0xcalldata" } };
    },
  };
}

describe("ProtocolRegistry", () => {
  it("registers and resolves an injected fake adapter by chain and protocol", () => {
    const adapter = fakeProtocolAdapter();
    const registry = new ProtocolRegistry([
      { chainId: 901, protocol: "kuru", adapter },
    ]);

    expect(registry.has(901, "kuru")).toBe(true);
    expect(registry.resolve(901, "kuru")).toBe(adapter);
  });

  it("fails explicitly with an unsupported control error for an unknown protocol", () => {
    const registry = new ProtocolRegistry([
      { chainId: 901, protocol: "kuru", adapter: fakeProtocolAdapter() },
    ]);
    const error = (() => {
      try {
        registry.resolve(901, "unknown-protocol");
      } catch (received) {
        return received;
      }
      throw new Error("expected unknown protocol resolution to fail");
    })();

    expect(error).toBeInstanceOf(ProtocolRegistryError);
    expect(isProtocolRegistryError(error)).toBe(true);
    expect(isBackendControlError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "UNSUPPORTED_PROTOCOL",
      chainId: 901,
      protocol: "unknown-protocol",
      status: "unsupported",
      retryable: false,
    });
  });

  it("fails explicitly when the requested chain is not registered", () => {
    const registry = new ProtocolRegistry([
      { chainId: 901, protocol: "kuru", adapter: fakeProtocolAdapter() },
    ]);

    expect(() => registry.resolve(902, "kuru")).toThrowError(
      expect.objectContaining({
        code: "UNSUPPORTED_CHAIN",
        chainId: 902,
        protocol: "kuru",
        status: "unsupported",
      }),
    );
  });

  it("fails explicitly when a protocol is registered on another chain", () => {
    const adapter = fakeProtocolAdapter();
    const registry = new ProtocolRegistry([
      { chainId: 901, protocol: "kuru", adapter },
      {
        chainId: 902,
        protocol: "camelot",
        adapter: fakeProtocolAdapter(),
      },
    ]);

    expect(() => registry.resolve(901, "camelot")).toThrowError(
      "protocol camelot is not registered for chain 901",
    );
    expect(() => registry.resolve(901, "camelot")).toThrowError(
      expect.objectContaining({
        code: "CHAIN_PROTOCOL_MISMATCH",
        status: "invalid",
      }),
    );
    expect(registry.resolve(901, "kuru")).toBe(adapter);
  });

  it("rejects duplicate chain and protocol registration without fallback", () => {
    const first = fakeProtocolAdapter();
    const second = fakeProtocolAdapter();
    const registry = new ProtocolRegistry([
      { chainId: 901, protocol: "kuru", adapter: first },
    ]);

    expect(() => registry.register(901, "kuru", second)).toThrowError(
      "protocol kuru is already registered for chain 901",
    );
    expect(registry.resolve(901, "kuru")).toBe(first);
  });

  it("rejects malformed structural registry errors across a runtime boundary", () => {
    expect(
      isProtocolRegistryError({
        name: "ProtocolRegistryError",
        code: "UNSUPPORTED_PROTOCOL",
        message: "protocol is not registered",
        chainId: 901,
        protocol: "kuru",
        retryable: false,
        status: "failed",
      }),
    ).toBe(false);
  });
});
