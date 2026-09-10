import type {
  ProviderAdapter,
  ProviderCapability,
  ProviderSupportQuery,
} from "./provider-adapter.js";
import { AdapterRegistry } from "./registry-core.js";
import { ProviderRegistryError } from "./registry-errors.js";

export type {
  ProviderAdapter,
  ProviderAdapterErrorCode,
  ProviderAdapterErrorInput,
  ProviderCapability,
  ProviderEvaluationInput,
  ProviderEvaluationResult,
  ProviderSupportQuery,
} from "./provider-adapter.js";

export {
  isProviderRegistryError,
  ProviderRegistryError,
  type ProviderRegistryErrorCode,
  type ProviderRegistryErrorInput,
} from "./registry-errors.js";

export type ProviderOverrideEnvironment = "development" | "demo";
export type ProviderEnvironment = ProviderOverrideEnvironment | "production";

/** Explicit configuration-only provider override. */
export type ProviderOverride = {
  readonly providerId: string;
  readonly environment: ProviderEnvironment;
};

export type ProviderOverrideConfig = ProviderOverride;

export type ProviderSelectionQuery<Intent = unknown> =
  ProviderSupportQuery<Intent>;

export type ProviderSelectionOptions = {
  readonly override?: ProviderOverride;
  readonly providerOverride?: ProviderOverride;
};

/**
 * Backend-only provider selection registry.
 *
 * The adapter's side-effect-free `supports` method is the only normal selection
 * predicate. A selection must have exactly one match; this registry never
 * chooses a default provider and never evaluates a provider while selecting.
 */
export class ProviderRegistry<Intent = unknown> {
  private readonly adapters = new AdapterRegistry<
    string,
    ProviderAdapter<Intent, unknown>
  >();

  public constructor(
    adapters: Iterable<ProviderAdapter<Intent, unknown>> = [],
  ) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  public get size(): number {
    return this.adapters.size;
  }

  public has(providerId: string): boolean {
    if (typeof providerId !== "string" || providerId.trim().length === 0) {
      return false;
    }
    return this.adapters.has(providerId);
  }

  /** Registers an adapter once; duplicate IDs fail closed rather than replace. */
  public register(adapter: ProviderAdapter<Intent, unknown>): this {
    const providerId = readProviderId(adapter);
    validateAdapterConfiguration(adapter, providerId);
    if (this.adapters.has(providerId)) {
      throw new ProviderRegistryError({
        code: "DUPLICATE_PROVIDER",
        providerId,
        message: `provider ${providerId} is already registered`,
      });
    }
    this.adapters.set(providerId, adapter);
    return this;
  }

  /**
   * Resolves a provider for the complete Intent/chain/protocol/capability
   * query. Normal user selection cannot carry a provider override.
   */
  public resolve(
    query: ProviderSupportQuery<Intent>,
    options: ProviderSelectionOptions = {},
  ): ProviderAdapter<Intent, unknown> {
    const normalizedQuery = normalizeQuery(query);
    const override = normalizeOptions(options);
    if (override !== undefined) {
      return this.resolveOverride(override, normalizedQuery);
    }

    const matches: ProviderAdapter<Intent, unknown>[] = [];
    for (const [providerId, adapter] of this.adapters.entries()) {
      if (this.supportsProvider(providerId, adapter, normalizedQuery)) {
        matches.push(adapter);
      }
    }

    if (matches.length === 1) {
      return matches[0] as ProviderAdapter<Intent, unknown>;
    }
    if (matches.length > 1) {
      const providerIds = matches.map((adapter) => adapter.providerId);
      throw new ProviderRegistryError({
        code: "AMBIGUOUS_PROVIDER",
        providerIds,
        message: `multiple providers support the requested selection: ${providerIds.join(", ")}`,
        intent: normalizedQuery.intent,
        chainId: normalizedQuery.chainId,
        protocol: normalizedQuery.protocol,
        capability: normalizedQuery.capability,
      });
    }

    throw new ProviderRegistryError({
      code: "UNSUPPORTED_PROVIDER",
      message: "no registered provider supports the requested selection",
      intent: normalizedQuery.intent,
      chainId: normalizedQuery.chainId,
      protocol: normalizedQuery.protocol,
      capability: normalizedQuery.capability,
    });
  }

  /** Explicit alias for callers that use selection terminology. */
  public select(
    query: ProviderSupportQuery<Intent>,
    options: ProviderSelectionOptions = {},
  ): ProviderAdapter<Intent, unknown> {
    return this.resolve(query, options);
  }

  private resolveOverride(
    override: ProviderOverride,
    query: ProviderSupportQuery<Intent>,
  ): ProviderAdapter<Intent, unknown> {
    if (
      override.environment !== "development" &&
      override.environment !== "demo"
    ) {
      throw new ProviderRegistryError({
        code: "PROVIDER_OVERRIDE_FORBIDDEN",
        providerId: override.providerId,
        message:
          "provider overrides are restricted to development or demo configuration",
      });
    }
    const adapter = this.adapters.get(override.providerId);
    if (adapter === undefined) {
      throw new ProviderRegistryError({
        code: "PROVIDER_OVERRIDE_NOT_FOUND",
        providerId: override.providerId,
        message: `provider override ${override.providerId} is not registered`,
      });
    }
    if (!this.supportsProvider(override.providerId, adapter, query)) {
      throw new ProviderRegistryError({
        code: "UNSUPPORTED_PROVIDER",
        providerId: override.providerId,
        message: `provider ${override.providerId} does not support the requested selection`,
        intent: query.intent,
        chainId: query.chainId,
        protocol: query.protocol,
        capability: query.capability,
      });
    }
    return adapter;
  }

  private supportsProvider(
    providerId: string,
    adapter: ProviderAdapter<Intent, unknown>,
    query: ProviderSupportQuery<Intent>,
  ): boolean {
    let supported: unknown;
    try {
      supported = adapter.supports(query);
    } catch (cause) {
      throw new ProviderRegistryError({
        code: "PROVIDER_RUNTIME_ERROR",
        providerId,
        message: `provider ${providerId} support probe failed`,
        cause,
      });
    }
    if (typeof supported !== "boolean") {
      throw new ProviderRegistryError({
        code: "INVALID_PROVIDER_CONFIGURATION",
        providerId,
        message: `provider ${providerId} supports() must return a boolean`,
      });
    }
    let capabilities: readonly ProviderCapability[] | undefined;
    try {
      capabilities = normalizeCapabilities(adapter.capabilities, providerId);
    } catch (cause) {
      if (cause instanceof ProviderRegistryError) throw cause;
      throw new ProviderRegistryError({
        code: "PROVIDER_RUNTIME_ERROR",
        providerId,
        message: `provider ${providerId} capabilities could not be read`,
        cause,
      });
    }
    return (
      supported &&
      (query.capability === undefined ||
        capabilities?.includes(query.capability) === true)
    );
  }
}

function readProviderId(adapter: unknown): string {
  if (typeof adapter !== "object" || adapter === null) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message: "provider adapter must be an object",
    });
  }
  let providerId: unknown;
  try {
    providerId = (adapter as { providerId?: unknown }).providerId;
  } catch (cause) {
    throw new ProviderRegistryError({
      code: "PROVIDER_RUNTIME_ERROR",
      message: "provider adapter providerId could not be read",
      cause,
    });
  }
  if (
    typeof providerId !== "string" ||
    providerId.trim().length === 0 ||
    providerId !== providerId.trim()
  ) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message: "provider adapter providerId must be a non-empty exact string",
    });
  }
  return providerId;
}

function validateAdapterConfiguration(
  adapter: ProviderAdapter<unknown, unknown>,
  providerId: string,
): void {
  let supports: unknown;
  let capabilities: unknown;
  try {
    supports = adapter.supports;
    capabilities = adapter.capabilities;
  } catch (cause) {
    throw new ProviderRegistryError({
      code: "PROVIDER_RUNTIME_ERROR",
      providerId,
      message: `provider ${providerId} configuration could not be read`,
      cause,
    });
  }
  if (typeof supports !== "function") {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      providerId,
      message: `provider ${providerId} supports must be a function`,
    });
  }
  normalizeCapabilities(capabilities, providerId);
}

function normalizeCapabilities(
  capabilities: unknown,
  providerId: string,
): readonly ProviderCapability[] | undefined {
  if (capabilities === undefined) return undefined;
  if (!Array.isArray(capabilities)) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      providerId,
      message: `provider ${providerId} capabilities must be an array`,
    });
  }
  const length = capabilities.length;
  const names = Object.getOwnPropertyNames(capabilities);
  if (
    Object.getOwnPropertySymbols(capabilities).length > 0 ||
    names.length !== length + 1 ||
    !names.every(
      (name) =>
        name === "length" ||
        (/^(0|[1-9]\d*)$/.test(name) && Number(name) < length),
    )
  ) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      providerId,
      message: `provider ${providerId} capabilities must be a dense array`,
    });
  }
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(capabilities, index)) {
      throw new ProviderRegistryError({
        code: "INVALID_PROVIDER_CONFIGURATION",
        providerId,
        message: `provider ${providerId} capabilities must be a dense array`,
      });
    }
    const capability = capabilities[index];
    if (typeof capability !== "string" || capability.trim().length === 0) {
      throw new ProviderRegistryError({
        code: "INVALID_PROVIDER_CONFIGURATION",
        providerId,
        message: `provider ${providerId} capabilities must contain non-empty strings`,
      });
    }
  }
  return capabilities as readonly ProviderCapability[];
}

function normalizeQuery<Intent>(
  query: ProviderSupportQuery<Intent>,
): ProviderSupportQuery<Intent> {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message: "provider selection query must be an object",
    });
  }
  if (
    Object.hasOwn(query, "providerOverride") ||
    Object.hasOwn(query, "providerId") ||
    Object.hasOwn(query, "override")
  ) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message:
        "provider override must not be embedded in the ordinary selection query",
    });
  }
  const candidate = query as ProviderSupportQuery<Intent>;
  if (candidate.intent === undefined) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message: "provider selection query intent is required",
    });
  }
  if (!isChainId(candidate.chainId)) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message:
        "provider selection query chainId must be a non-negative safe integer",
    });
  }
  const protocol = validateIdentifier(candidate.protocol, "protocol");
  const capability =
    candidate.capability === undefined
      ? undefined
      : validateIdentifier(candidate.capability, "capability");
  return {
    intent: candidate.intent,
    chainId: candidate.chainId,
    protocol,
    capability,
  };
}

function normalizeOptions(
  options: ProviderSelectionOptions,
): ProviderOverride | undefined {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message: "provider selection options must be an object",
    });
  }
  if (
    options.override !== undefined &&
    options.providerOverride !== undefined
  ) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message:
        "provider selection options cannot contain two provider overrides",
    });
  }
  const override = options.override ?? options.providerOverride;
  if (override === undefined) {
    return undefined;
  }
  if (
    typeof override !== "object" ||
    override === null ||
    Array.isArray(override) ||
    typeof override.providerId !== "string" ||
    override.providerId.trim().length === 0 ||
    override.providerId !== override.providerId.trim() ||
    (override.environment !== "development" &&
      override.environment !== "demo" &&
      override.environment !== "production")
  ) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message:
        "provider override requires a providerId and an explicit environment",
    });
  }
  return override;
}

function validateIdentifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new ProviderRegistryError({
      code: "INVALID_PROVIDER_CONFIGURATION",
      message: `provider selection query ${name} must be a non-empty exact string`,
    });
  }
  return value;
}

function isChainId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
