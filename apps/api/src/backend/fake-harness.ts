import { isDeepStrictEqual } from "node:util";
import type {
  BlockContext,
  ChainAdapter,
  ChainOperationOptions,
  FinalityStatus,
  GasEstimate,
} from "./chain-adapter.js";
import type {
  ProtocolAdapter,
  UnsignedTransaction,
} from "./protocol-adapter.js";
import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderEvaluationInput,
  type ProviderSupportQuery,
} from "./provider-adapter.js";
import type {
  ProvisionalCandidateFieldInput,
  ProvisionalProviderResultInput,
} from "./provider-result-boundary.js";

export type FakeChainFixture = {
  readonly chainId: number;
  readonly blockNumber: string;
  readonly blockHash?: string;
  readonly observedAt?: string;
  readonly gasUnits: string;
  readonly finality: FinalityStatus;
};

export type FakeChainCall<Transaction> =
  | { readonly operation: "connect"; readonly options?: ChainOperationOptions }
  | {
      readonly operation: "getBlockContext";
      readonly options?: ChainOperationOptions;
    }
  | {
      readonly operation: "estimateGas";
      readonly transaction: Transaction;
      readonly options?: ChainOperationOptions;
    }
  | {
      readonly operation: "getFinality";
      readonly blockContext: BlockContext;
      readonly options?: ChainOperationOptions;
    };

export type FakeChainAdapter<Transaction = unknown> =
  ChainAdapter<Transaction> & {
    readonly calls: FakeChainCall<Transaction>[];
  };

/** Creates a deterministic, offline Chain adapter from a fixture. */
export function createFakeChainAdapter<Transaction = unknown>(
  fixture: FakeChainFixture = defaultChainFixture,
): FakeChainAdapter<Transaction> {
  const calls: FakeChainCall<Transaction>[] = [];
  return {
    chainId: fixture.chainId,
    calls,
    async connect(options?: ChainOperationOptions): Promise<void> {
      calls.push({ operation: "connect", options });
    },
    async getBlockContext(
      options?: ChainOperationOptions,
    ): Promise<BlockContext> {
      calls.push({ operation: "getBlockContext", options });
      return {
        blockNumber: fixture.blockNumber,
        blockHash: fixture.blockHash,
        observedAt: fixture.observedAt,
      };
    },
    async estimateGas(
      transaction: Transaction,
      options?: ChainOperationOptions,
    ): Promise<GasEstimate> {
      calls.push({ operation: "estimateGas", transaction, options });
      return { gasUnits: fixture.gasUnits };
    },
    async getFinality(
      blockContext: BlockContext,
      options?: ChainOperationOptions,
    ): Promise<FinalityStatus> {
      calls.push({ operation: "getFinality", blockContext, options });
      return fixture.finality;
    },
  };
}

export type FakeProtocolFixture<Quote = unknown, Transaction = unknown> = {
  readonly id: string;
  readonly quote: Quote;
  readonly transaction: Transaction;
};

export type FakeProtocolCall<Intent> = {
  readonly operation: "quote" | "buildTransaction";
  readonly intent: Intent;
};

export type FakeProtocolAdapter<
  Intent = unknown,
  Quote = unknown,
  Transaction = unknown,
> = ProtocolAdapter<Intent, Quote, Transaction> & {
  readonly calls: FakeProtocolCall<Intent>[];
};

/** Creates a deterministic Protocol adapter with opaque quote/transaction data. */
export function createFakeProtocolAdapter<
  Intent = unknown,
  Quote = unknown,
  Transaction = unknown,
>(
  fixture: FakeProtocolFixture<
    Quote,
    Transaction
  > = defaultProtocolFixture as FakeProtocolFixture<Quote, Transaction>,
): FakeProtocolAdapter<Intent, Quote, Transaction> {
  const calls: FakeProtocolCall<Intent>[] = [];
  return {
    calls,
    async quote(intent: Intent): Promise<Quote> {
      calls.push({ operation: "quote", intent });
      return fixture.quote;
    },
    async buildTransaction(
      intent: Intent,
    ): Promise<UnsignedTransaction<Transaction>> {
      calls.push({ operation: "buildTransaction", intent });
      return { kind: "unsigned", payload: fixture.transaction };
    },
  };
}

export type FakeProviderIntent = {
  readonly kind: "swap";
  readonly chainId: number;
  readonly protocol: string;
};

export type FakeProviderFixture<Intent = FakeProviderIntent> = {
  readonly providerId: string;
  readonly intent: Intent;
  readonly chainId: number;
  readonly protocol: string;
  readonly capabilities?: readonly string[];
  readonly observedAt?: string;
  readonly candidateFields?: readonly ProvisionalCandidateFieldInput[];
  readonly result?: ProvisionalProviderResultInput;
  readonly supports?: (query: ProviderSupportQuery<Intent>) => boolean;
};

export type FakeProviderAdapterHarness<Intent, Input> = {
  readonly adapter: ProviderAdapter<Intent, Input>;
  readonly evaluations: ProviderEvaluationInput<Intent, Input>[];
};

function buildFakeProviderAdapter<Intent, Input>(
  fixture: FakeProviderFixture<Intent>,
): FakeProviderAdapterHarness<Intent, Input> {
  const evaluations: ProviderEvaluationInput<Intent, Input>[] = [];
  const adapter = createProviderAdapter<Intent, Input>({
    providerId: fixture.providerId,
    capabilities: fixture.capabilities,
    supports: (query) =>
      fixture.supports?.(query) ??
      (isDeepStrictEqual(query.intent, fixture.intent) &&
        query.chainId === fixture.chainId &&
        query.protocol === fixture.protocol),
    evaluateRaw: async (input) => {
      evaluations.push(input);
      if (fixture.result !== undefined) {
        return { ...fixture.result, capabilities: fixture.capabilities };
      }
      return {
        provider: {
          providerId: fixture.providerId,
          observedAt: fixture.observedAt ?? "2026-09-01T00:00:00.000Z",
        },
        status: "success",
        responseEvidence: {
          kind: "reference",
          reference: `fixture://${fixture.providerId}/${input.runId}`,
        },
        candidateFields: fixture.candidateFields ?? [],
        capabilities: fixture.capabilities,
      };
    },
  });
  return { adapter, evaluations };
}

/**
 * Creates a Provider fake through the production factory. The returned public
 * adapter contains no raw implementation or evaluation method.
 */
export function createFakeProviderAdapter<
  Intent = FakeProviderIntent,
  Input = unknown,
>(
  fixture: FakeProviderFixture<Intent> = defaultProviderFixture as unknown as FakeProviderFixture<Intent>,
): ProviderAdapter<Intent, Input> {
  return buildFakeProviderAdapter(fixture).adapter;
}

/** Creates a Provider fake plus an inspection handle for deterministic tests. */
export function createFakeProviderAdapterHarness<
  Intent = FakeProviderIntent,
  Input = unknown,
>(
  fixture: FakeProviderFixture<Intent> = defaultProviderFixture as unknown as FakeProviderFixture<Intent>,
): FakeProviderAdapterHarness<Intent, Input> {
  return buildFakeProviderAdapter(fixture);
}

export type FakeBackendFixture = {
  readonly chain: FakeChainFixture;
  readonly protocol: FakeProtocolFixture<
    { readonly amountOut: string },
    { readonly data: string }
  >;
  readonly provider: FakeProviderFixture;
};

/** Returns a fresh, offline fixture set for composition and contract tests. */
export function fakeBackendFixture(): FakeBackendFixture {
  return {
    chain: {
      ...defaultChainFixture,
      finality: { ...defaultChainFixture.finality },
    },
    protocol: {
      id: "kuru",
      quote: { amountOut: "42" },
      transaction: { data: "0xfixture" },
    },
    provider: {
      providerId: "fixture-provider",
      intent: { kind: "swap", chainId: 901, protocol: "kuru" },
      chainId: 901,
      protocol: "kuru",
      capabilities: ["simulate"],
    },
  };
}

const defaultChainFixture: FakeChainFixture = {
  chainId: 901,
  blockNumber: "42",
  observedAt: "2026-09-01T00:00:00.000Z",
  gasUnits: "21000",
  finality: { status: "finalized" },
};

const defaultProtocolFixture: FakeProtocolFixture<
  { readonly amountOut: string },
  { readonly data: string }
> = {
  id: "kuru",
  quote: { amountOut: "42" },
  transaction: { data: "0xfixture" },
};

const defaultProviderFixture: FakeProviderFixture = {
  providerId: "fixture-provider",
  intent: { kind: "swap", chainId: 901, protocol: "kuru" },
  chainId: 901,
  protocol: "kuru",
  capabilities: ["simulate"],
};
